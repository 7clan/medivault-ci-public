//! The supervisor's run loop: startup sequence, supervision, and the
//! graceful shutdown ladder.
//!
//! Startup (architecture audit, SUPERVISOR DESIGN):
//!   1. cluster sanity (fail closed if the cluster is not provisioned —
//!      provisioning itself belongs to the provisioner, a later stage);
//!   2. start `postgres` as a direct child (SCRAM-initialized cluster);
//!   3. bounded `pg_isready`;
//!   4. authenticated `SELECT 1` as the app role (SCRAM proof through
//!      libpq, password via env only);
//!   5. start the Node API with the injected env contract;
//!   6. bounded `GET /health` -> 200.
//!
//! Supervision: 250ms tick — reap children, restart with bounded
//! exponential backoff (max restarts per child, fail-closed beyond),
//! periodic pg_isready + /health re-checks with a failure threshold.
//!
//! Shutdown (SIGTERM/SIGINT):
//!   API: SIGTERM -> bounded -> SIGKILL;
//!   PG:  SIGINT (fast) -> bounded -> SIGQUIT (immediate) -> bounded ->
//!        SIGKILL. Never SIGKILL first. Exit code 0.

use std::time::{Duration, Instant};

use crate::config::Resolved;
use crate::health;
use crate::logging::Logger;
use crate::proc::{self, ChildHandle};
use crate::secrets::{self, Secrets};
use crate::status::{
    Status, STATE_DEGRADED, STATE_FAILED, STATE_HEALTHY, STATE_PROVISIONING, STATE_STARTING,
    STATE_STOPPED, STATE_STOPPING,
};

/// Exit codes — part of the supervisor's stable contract.
pub const EXIT_OK: i32 = 0;
pub const EXIT_FATAL: i32 = 1;
pub const EXIT_CLUSTER_NOT_PROVISIONED: i32 = 5;

const TICK: Duration = Duration::from_millis(250);

pub struct Supervisor {
    resolved: Resolved,
    secrets: Secrets,
    logger: Logger,
    status: Status,
    pg: Option<ChildHandle>,
    api: Option<ChildHandle>,
    /// Consecutive failed periodic health checks per child kind.
    pg_health_fails: u32,
    api_health_fails: u32,
    last_health_check: Option<Instant>,
}

impl Supervisor {
    pub fn new(resolved: Resolved, secrets: Secrets, logger: Logger) -> Supervisor {
        let status = Status::new(std::process::id());
        Supervisor {
            resolved,
            secrets,
            logger,
            status,
            pg: None,
            api: None,
            pg_health_fails: 0,
            api_health_fails: 0,
            last_health_check: None,
        }
    }

    // ------------------------------------------------------------------
    // Startup
    // ------------------------------------------------------------------

    fn ensure_dirs(&self) -> Result<(), String> {
        for (what, dir) in [
            ("app_support", &self.resolved.app_support),
            ("log_dir", &self.resolved.log_dir),
            ("runtime_state", &self.resolved.runtime_state_dir),
            ("storage", &self.resolved.storage_dir),
            ("pgdata", &self.resolved.pgdata),
        ] {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("cannot create {what} dir {}: {e}", dir.display()))?;
        }
        Ok(())
    }

    /// The cluster must already be provisioned (initdb + role/database +
    /// migrations are the provisioner's job). We require the canonical
    /// cluster marker: `PG_VERSION` inside PGDATA. When provisioner
    /// delegation is configured, an unprovisioned cluster triggers the
    /// delegate-and-wait path instead (Keychain/provisioning stage);
    /// otherwise the frozen stage-1 fail-closed behavior applies.
    fn cluster_provisioned(&self) -> bool {
        self.resolved.pgdata.join("PG_VERSION").is_file()
    }

    /// Delegate first-run provisioning to the Node provisioner:
    /// `<node> <provisioner_entry> provision --config <same config>` with
    /// env-injected secrets (names only in logs). Bounded wait; the
    /// provisioner's own logs land in provision.log (it also mirrors its
    /// stdout there).
    fn delegate_provisioning(&mut self) -> Result<bool, String> {
        let entry = match &self.resolved.provisioner_entry {
            Some(e) => e.clone(),
            None => return Ok(false),
        };
        self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_PROVISIONING.to_string();
        })?;
        self.logger
            .info("cluster not provisioned — delegating to the provisioner (bounded, fail-closed)");

        // The provisioner performs its own file logging (provision.log);
        // its stdout/stderr inherit ours so the foreground stream shows the
        // full bootstrap timeline (no double-write into provision.log).
        let mut cmd = std::process::Command::new(&self.resolved.node_bin);
        cmd.arg(&entry)
            .arg("provision")
            .arg("--config")
            .arg(&self.resolved.config_path)
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit());
        // Env: the provisioner's documented secret contract, values never logged.
        cmd.env("MV_PG_APP_PASSWORD", &self.secrets.pg_app_password);
        if let Some(super_pw) = &self.secrets.pg_super_password {
            cmd.env("MV_PG_SUPER_PASSWORD", super_pw);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("cannot spawn provisioner {}: {e}", entry.display()))?;
        self.logger.info(&format!(
            "provisioner started (pid {}) with env: MV_PG_APP_PASSWORD{}",
            child.id(),
            if self.secrets.pg_super_password.is_some() {
                ",MV_PG_SUPER_PASSWORD"
            } else {
                ""
            }
        ));

        let deadline = Instant::now() + Duration::from_secs(self.resolved.provision_timeout_sec);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let code = status.code();
                    self.logger
                        .info(&format!("provisioner exited (code {code:?})"));
                    if status.success() && self.cluster_provisioned() {
                        return Ok(true);
                    }
                    return Err(format!(
                        "provisioner failed (exit {code:?}) — cluster not provisioned; see provision.log"
                    ));
                }
                Ok(None) => {}
                Err(e) => return Err(format!("provisioner wait failed: {e}")),
            }
            if Instant::now() >= deadline {
                self.logger
                    .error("provisioner exceeded its bounded timeout — terminating it");
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "provisioner did not finish within {}s — fail closed",
                    self.resolved.provision_timeout_sec
                ));
            }
            std::thread::sleep(TICK);
        }
    }

    fn spawn_pg(&mut self) -> Result<(), String> {
        let handle = proc::spawn_postgres(
            &self.resolved.pg_bin,
            &self.resolved.pgdata,
            &self.resolved.postgres_log,
            &self.logger,
        )?;
        let pid = handle.pid();
        self.pg = Some(handle);
        self.status.update(&self.resolved.status_file, |s| {
            s.pg_pid = Some(pid);
            s.state = STATE_STARTING.to_string();
        })?;
        Ok(())
    }

    fn spawn_api(&mut self) -> Result<(), String> {
        let database_url = secrets::database_url(&self.resolved, &self.secrets);
        let envs: Vec<(String, String)> = vec![
            ("PORT".into(), self.resolved.api_port.to_string()),
            ("HOST".into(), self.resolved.api_host.clone()),
            ("DATABASE_URL".into(), database_url),
            ("AUTH_JWT_SECRET".into(), self.secrets.jwt_secret.clone()),
            (
                "MEDIVAULT_MASTER_KEY".into(),
                self.secrets.master_key.clone(),
            ),
            (
                "MEDIVAULT_DATA_DIR".into(),
                self.resolved.storage_dir.display().to_string(),
            ),
            (
                "ALLOWED_ORIGINS".into(),
                self.resolved.api_allowed_origins.clone(),
            ),
            ("TRUSTED_LOCAL_TLS_TERMINATION".into(), "true".into()),
            ("NODE_ENV".into(), "production".into()),
        ];
        let handle = proc::spawn_api(
            &self.resolved.node_bin,
            &self.resolved.api_entry,
            &self.resolved.api_working_dir,
            &envs,
            &self.resolved.api_log,
            &self.logger,
        )?;
        let pid = handle.pid();
        self.api = Some(handle);
        self.status.update(&self.resolved.status_file, |s| {
            s.api_pid = Some(pid);
        })?;
        Ok(())
    }

    /// Authenticated SELECT 1 as the app role — proves SCRAM auth works
    /// through the bundled libpq BEFORE the API is started.
    fn prove_select_one(&self) -> Result<(), String> {
        let out = proc::run_helper(
            &self.resolved.psql_bin,
            &[
                "-h",
                &self.resolved.pg_host,
                "-p",
                &self.resolved.pg_port.to_string(),
                "-U",
                &self.resolved.pg_app_user,
                "-d",
                &self.resolved.pg_app_database,
                "-t",
                "-A",
                "-c",
                "SELECT 1",
            ],
            &[(
                "PGPASSWORD".to_string(),
                self.secrets.pg_app_password.clone(),
            )],
        )?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!(
                "authenticated SELECT 1 as app role failed: psql exit {:?}: {}",
                out.status.code(),
                stderr.trim()
            ));
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        if stdout.trim() != "1" {
            return Err(format!(
                "authenticated SELECT 1 returned unexpected output: {:?}",
                stdout.trim()
            ));
        }
        self.logger
            .info("authenticated SELECT 1 as app role: ok (SCRAM)");
        Ok(())
    }

    fn wait_pg_ready(&self) -> Result<bool, String> {
        proc::wait_pg_ready(
            &self.resolved.pg_isready_bin,
            &self.resolved.pg_host,
            self.resolved.pg_port,
            Duration::from_secs(self.resolved.limits.pg_start_timeout_sec),
            &self.logger,
        )
    }

    fn wait_api_healthy(&self) -> Result<bool, String> {
        health::wait_api_healthy(
            &self.resolved.api_host,
            self.resolved.api_port,
            Duration::from_secs(self.resolved.limits.api_start_timeout_sec),
        )
    }

    // ------------------------------------------------------------------
    // Main entry: run until SIGTERM/SIGINT, then shut down gracefully.
    // Returns the process exit code.
    // ------------------------------------------------------------------

    pub fn run(mut self) -> i32 {
        if let Err(e) = self.status.write(&self.resolved.status_file) {
            // Status writing is part of the observable contract; if it
            // fails we still run (the doctor's logs are the fallback) but
            // we say so loudly.
            self.logger
                .error(&format!("initial status write failed: {e}"));
        }

        macro_rules! fail_closed {
            ($code:expr, $msg:expr) => {{
                let msg: String = $msg;
                self.logger.error(&msg);
                let _ = self.status.update(&self.resolved.status_file, |s| {
                    s.state = STATE_FAILED.to_string();
                    s.last_error = Some(msg.clone());
                });
                self.best_effort_stop_all();
                return $code;
            }};
        }

        if let Err(e) = self.ensure_dirs() {
            fail_closed!(EXIT_FATAL, e);
        }
        if !self.cluster_provisioned() {
            match self.delegate_provisioning() {
                Ok(true) => {
                    self.logger
                        .info("provisioning delegated and completed — cluster is ready");
                }
                Ok(false) => {
                    fail_closed!(
                        EXIT_CLUSTER_NOT_PROVISIONED,
                        format!(
                            "cluster is not provisioned ({} missing) — run the MediVault provisioner first; \
                             the supervisor never initializes or re-initializes a cluster",
                            self.resolved.pgdata.join("PG_VERSION").display()
                        )
                    );
                }
                Err(e) => fail_closed!(EXIT_FATAL, e),
            }
        }

        // --- PostgreSQL -------------------------------------------------
        if let Err(e) = self.spawn_pg() {
            fail_closed!(EXIT_FATAL, e);
        }
        match self.wait_pg_ready() {
            Ok(true) => {}
            Ok(false) => {
                fail_closed!(
                    EXIT_FATAL,
                    format!(
                        "PostgreSQL did not accept connections within {}s (pg_isready)",
                        self.resolved.limits.pg_start_timeout_sec
                    )
                );
            }
            Err(e) => fail_closed!(EXIT_FATAL, e),
        }
        if let Err(e) = self.prove_select_one() {
            fail_closed!(EXIT_FATAL, e);
        }

        // --- API --------------------------------------------------------
        if let Err(e) = self.spawn_api() {
            fail_closed!(EXIT_FATAL, e);
        }
        match self.wait_api_healthy() {
            Ok(true) => {
                self.logger.info("GET /health -> 200: API healthy");
            }
            Ok(false) => {
                fail_closed!(
                    EXIT_FATAL,
                    format!(
                        "API did not become healthy within {}s",
                        self.resolved.limits.api_start_timeout_sec
                    )
                );
            }
            Err(e) => fail_closed!(EXIT_FATAL, e),
        }

        if let Err(e) = self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_HEALTHY.to_string();
        }) {
            self.logger.error(&format!("status write failed: {e}"));
        }
        self.logger.info("supervisor state: healthy");

        // --- Supervision loop -------------------------------------------
        loop {
            if crate::shutdown_requested() {
                self.logger.info("shutdown requested (signal)");
                break;
            }

            // Reap + react.
            match self.check_children() {
                Ok(ChildrenProbe::AllAlive) => {}
                Ok(ChildrenProbe::Restarted) => {}
                Ok(ChildrenProbe::Fatal(msg)) => fail_closed!(EXIT_FATAL, msg),
                Err(e) => fail_closed!(EXIT_FATAL, e),
            }

            // Periodic health re-check.
            if self.health_check_due() {
                if let Err(msg) = self.run_periodic_health_check() {
                    fail_closed!(EXIT_FATAL, msg);
                }
            }

            // Heartbeat the status file so "is it fresh?" is answerable.
            if let Err(e) = self.status.update(&self.resolved.status_file, |_s| {}) {
                self.logger.warn(&format!("status heartbeat failed: {e}"));
            }

            std::thread::sleep(TICK);
        }

        // --- Graceful shutdown ------------------------------------------
        if let Err(e) = self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_STOPPING.to_string();
        }) {
            self.logger.warn(&format!("status write failed: {e}"));
        }
        self.graceful_stop_all();
        let _ = self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_STOPPED.to_string();
            s.pg_pid = None;
            s.api_pid = None;
        });
        self.logger.info("supervisor stopped cleanly (exit 0)");
        EXIT_OK
    }

    // ------------------------------------------------------------------
    // Supervision internals
    // ------------------------------------------------------------------

    fn check_children(&mut self) -> Result<ChildrenProbe, String> {
        // PostgreSQL first: if PG is down the API has no database.
        if let Some(pg) = self.pg.as_mut() {
            if let Some(status) = pg.try_reap()? {
                self.logger.warn(&format!(
                    "postgres exited unexpectedly ({}) — restart path",
                    crate::proc::ChildHandle::describe_exit(&status)
                ));
                let probe = self.restart_child(ChildKind::Pg)?;
                return Ok(probe);
            }
        }
        if let Some(api) = self.api.as_mut() {
            if let Some(status) = api.try_reap()? {
                self.logger.warn(&format!(
                    "api exited unexpectedly ({}) — restart path",
                    crate::proc::ChildHandle::describe_exit(&status)
                ));
                let probe = self.restart_child(ChildKind::Api)?;
                return Ok(probe);
            }
        }
        Ok(ChildrenProbe::AllAlive)
    }

    /// Restart a dead child with bounded backoff, then re-prove readiness.
    fn restart_child(&mut self, kind: ChildKind) -> Result<ChildrenProbe, String> {
        let (restarts, max) = match kind {
            ChildKind::Pg => (
                self.status.pg_restarts + 1,
                self.resolved.limits.max_restarts_per_child,
            ),
            ChildKind::Api => (
                self.status.api_restarts + 1,
                self.resolved.limits.max_restarts_per_child,
            ),
        };
        if restarts > max {
            return Err(format!(
                "{} exceeded max restarts ({max}) — failing closed",
                kind.label()
            ));
        }
        let backoff = crate::config::backoff_ms(restarts, &self.resolved.limits);
        self.logger.info(&format!(
            "restarting {} (restart {restarts}/{max}) after {backoff}ms backoff",
            kind.label()
        ));
        let _ = self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_DEGRADED.to_string();
            match kind {
                ChildKind::Pg => {
                    s.pg_restarts = restarts;
                    s.pg_pid = None;
                }
                ChildKind::Api => {
                    s.api_restarts = restarts;
                    s.api_pid = None;
                }
            }
        });

        // Interruptible backoff.
        let deadline = Instant::now() + Duration::from_millis(backoff);
        while Instant::now() < deadline {
            if crate::shutdown_requested() {
                self.logger.info("shutdown requested during backoff");
                return Ok(ChildrenProbe::Restarted);
            }
            std::thread::sleep(TICK);
        }
        if crate::shutdown_requested() {
            return Ok(ChildrenProbe::Restarted);
        }

        match kind {
            ChildKind::Pg => {
                self.spawn_pg()?;
                if !self.wait_pg_ready()? {
                    return Err(format!(
                        "PostgreSQL did not become ready again within {}s",
                        self.resolved.limits.pg_start_timeout_sec
                    ));
                }
                self.logger.info("PostgreSQL recovered");
            }
            ChildKind::Api => {
                self.spawn_api()?;
                if !self.wait_api_healthy()? {
                    return Err(format!(
                        "API did not become healthy again within {}s",
                        self.resolved.limits.api_start_timeout_sec
                    ));
                }
                self.logger.info("API recovered");
            }
        }
        let _ = self.status.update(&self.resolved.status_file, |s| {
            s.state = STATE_HEALTHY.to_string();
        });
        Ok(ChildrenProbe::Restarted)
    }

    fn health_check_due(&mut self) -> bool {
        let interval = Duration::from_secs(self.resolved.limits.health_interval_sec);
        match self.last_health_check {
            None => {
                self.last_health_check = Some(Instant::now());
                false
            }
            Some(last) => {
                if last.elapsed() >= interval {
                    self.last_health_check = Some(Instant::now());
                    true
                } else {
                    false
                }
            }
        }
    }

    /// Periodic probes: pg_isready + GET /health. A failure streak at or
    /// above the threshold triggers a restart of the offending child.
    fn run_periodic_health_check(&mut self) -> Result<(), String> {
        let pg_ok = proc::run_helper(
            &self.resolved.pg_isready_bin,
            &[
                "-h",
                &self.resolved.pg_host,
                "-p",
                &self.resolved.pg_port.to_string(),
            ],
            &[],
        )
        .map(|o| o.status.success())
        .unwrap_or(false);

        let api_ok = health::get_health(&self.resolved.api_host, self.resolved.api_port)
            .map(|c| c == 200)
            .unwrap_or(false);

        if pg_ok {
            self.pg_health_fails = 0;
        } else {
            self.pg_health_fails += 1;
            self.logger.warn(&format!(
                "periodic health: pg_isready failing ({}/{})",
                self.pg_health_fails, self.resolved.limits.health_fail_threshold
            ));
        }
        if api_ok {
            self.api_health_fails = 0;
        } else {
            self.api_health_fails += 1;
            self.logger.warn(&format!(
                "periodic health: /health failing ({}/{})",
                self.api_health_fails, self.resolved.limits.health_fail_threshold
            ));
        }

        let threshold = self.resolved.limits.health_fail_threshold;
        if self.api_health_fails >= threshold {
            self.logger
                .warn("/health failure threshold reached — restarting API");
            self.api_health_fails = 0;
            // Kill the (hung) API child so the restart path owns it. A
            // dead-but-unreaped child is reaped by the wait here as well.
            if let Some(api) = self.api.as_mut() {
                proc::signal_child(&api.child, libc::SIGTERM, "node-api")?;
                if api.wait_timeout(Duration::from_secs(5))?.is_none() {
                    proc::signal_child(&api.child, libc::SIGKILL, "node-api")?;
                    let _ = api.wait_timeout(Duration::from_secs(5));
                }
            }
            self.restart_child(ChildKind::Api)?;
        }
        if self.pg_health_fails >= threshold {
            self.logger
                .warn("pg_isready failure threshold reached — restarting PostgreSQL");
            self.pg_health_fails = 0;
            // SIGQUIT = immediate shutdown so the cluster comes back fast
            // (crash recovery on next start); fast mode may hang on stuck
            // backends, immediate is the correct escalation here.
            if let Some(pg) = self.pg.as_mut() {
                proc::signal_child(&pg.child, libc::SIGINT, "postgres")?;
                if pg.wait_timeout(Duration::from_secs(10))?.is_none() {
                    proc::signal_child(&pg.child, libc::SIGQUIT, "postgres")?;
                    let _ = pg.wait_timeout(Duration::from_secs(10));
                }
            }
            self.restart_child(ChildKind::Pg)?;
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Shutdown
    // ------------------------------------------------------------------

    /// Ordered graceful shutdown: API first (SIGTERM -> bounded -> KILL),
    /// then PostgreSQL (SIGINT fast -> SIGQUIT -> KILL).
    fn graceful_stop_all(&mut self) {
        if let Some(mut api) = self.api.take() {
            if let Err(e) = proc::stop_child(
                &mut api,
                &[libc::SIGTERM],
                Duration::from_secs(self.resolved.limits.api_stop_timeout_sec),
                Duration::from_secs(10),
                &self.logger,
            ) {
                self.logger.error(&format!("API shutdown problem: {e}"));
            }
        }
        if let Some(mut pg) = self.pg.take() {
            if let Err(e) = proc::stop_child(
                &mut pg,
                &[libc::SIGINT, libc::SIGQUIT],
                Duration::from_secs(self.resolved.limits.pg_stop_timeout_sec),
                Duration::from_secs(10),
                &self.logger,
            ) {
                self.logger
                    .error(&format!("PostgreSQL shutdown problem: {e}"));
            }
        }
    }

    /// Best-effort teardown for fail-closed paths (children may be broken;
    /// every step is tolerated).
    fn best_effort_stop_all(&mut self) {
        if let Some(mut api) = self.api.take() {
            let _ = proc::stop_child(
                &mut api,
                &[libc::SIGTERM],
                Duration::from_secs(10),
                Duration::from_secs(5),
                &self.logger,
            );
        }
        if let Some(mut pg) = self.pg.take() {
            let _ = proc::stop_child(
                &mut pg,
                &[libc::SIGINT, libc::SIGQUIT],
                Duration::from_secs(15),
                Duration::from_secs(5),
                &self.logger,
            );
        }
    }
}

enum ChildrenProbe {
    AllAlive,
    Restarted,
    /// Reserved for future fatal-but-typed probes; today every fatal
    /// path goes through the fail_closed! macro instead.
    #[allow(dead_code)]
    Fatal(String),
}

enum ChildKind {
    Pg,
    Api,
}

impl ChildKind {
    fn label(&self) -> &'static str {
        match self {
            ChildKind::Pg => "postgres",
            ChildKind::Api => "node-api",
        }
    }
}
