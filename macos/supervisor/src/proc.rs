//! Child-process plumbing.
//!
//! Design (architecture audit, "SUPERVISOR DESIGN"):
//!   - children are DIRECT child processes of the supervisor (no pg_ctl
//!     daemonization indirection, no shell, absolute paths only);
//!   - every child is reaped by the supervisor (try_wait) — no zombies;
//!   - PostgreSQL shutdown maps to PostgreSQL's own signal semantics:
//!     SIGINT = fast shutdown, SIGQUIT = immediate; SIGKILL only as the
//!     final bounded escalation, never first;
//!   - the API (Node/Fastify) stops with SIGTERM first for its proven
//!     graceful close path.

use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use crate::logging::Logger;

/// Poll granularity for every bounded wait: small enough that SIGTERM
/// shutdown latency stays snappy, large enough to be cheap.
const TICK: Duration = Duration::from_millis(100);

pub struct ChildHandle {
    pub kind: &'static str,
    pub child: Child,
}

impl ChildHandle {
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Non-blocking check: reaps and returns `Some(status)` if the child
    /// has terminated. IMPORTANT: `Some` is returned for BOTH normal exits
    /// AND signal deaths (SIGKILL etc. — `status.code()` is `None` there,
    /// which must never be confused with "still running").
    pub fn try_reap(&mut self) -> Result<Option<ExitStatus>, String> {
        match self.child.try_wait() {
            Ok(status_opt) => Ok(status_opt),
            Err(e) => Err(format!("try_wait({}) failed: {e}", self.kind)),
        }
    }

    /// Describe an exit status for logs: code, or signal death.
    pub fn describe_exit(status: &ExitStatus) -> String {
        use std::os::unix::process::ExitStatusExt;
        match status.code() {
            Some(c) => format!("exit code {c}"),
            None => match status.signal() {
                Some(sig) => format!("killed by signal {sig}"),
                None => "unknown exit".to_string(),
            },
        }
    }

    /// Blocking wait with deadline. Returns `Some(status)` when the child
    /// was reaped, `None` on timeout (the child is NOT killed by this
    /// function).
    pub fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<ExitStatus>, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.try_reap()? {
                return Ok(Some(status));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(TICK);
        }
    }
}

/// Send a signal to a child. Safe on dead pids (kill(2) just errors).
pub fn signal_child(child: &Child, sig: i32, what: &str) -> Result<(), String> {
    let pid = child.id() as libc::pid_t;
    // SAFETY: kill(2) with a checked pid; no pointers.
    let rc = unsafe { libc::kill(pid, sig) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH = process already gone — the good outcome during shutdown.
        if err.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        return Err(format!("kill({what}, pid {pid}, sig {sig}) failed: {err}"));
    }
    Ok(())
}

/// Spawn the PostgreSQL server as a direct child, logs appended to
/// `postgres.log` (the server's own stderr — its native log stream).
pub fn spawn_postgres(
    postgres_bin: &std::path::Path,
    pgdata: &std::path::Path,
    log_file: &std::path::Path,
    logger: &Logger,
) -> Result<ChildHandle, String> {
    let out = open_append(log_file, "postgres.log")?;
    let child = Command::new(postgres_bin)
        .arg("-D")
        .arg(pgdata)
        .stdout(Stdio::from(
            out.try_clone()
                .map_err(|e| format!("postgres.log clone: {e}"))?,
        ))
        .stderr(Stdio::from(out))
        .spawn()
        .map_err(|e| format!("cannot spawn {}: {e}", postgres_bin.display()))?;
    let handle = ChildHandle {
        kind: "postgres",
        child,
    };
    logger.info(&format!("postgres started (pid {})", handle.pid()));
    Ok(handle)
}

/// Spawn the Node API as a direct child with the injected environment,
/// logs appended to `api.log`.
pub fn spawn_api(
    node_bin: &std::path::Path,
    api_entry: &std::path::Path,
    working_dir: &std::path::Path,
    envs: &[(String, String)],
    log_file: &std::path::Path,
    logger: &Logger,
) -> Result<ChildHandle, String> {
    let out = open_append(log_file, "api.log")?;
    let mut cmd = Command::new(node_bin);
    cmd.arg(api_entry)
        .current_dir(working_dir)
        .stdout(Stdio::from(
            out.try_clone().map_err(|e| format!("api.log clone: {e}"))?,
        ))
        .stderr(Stdio::from(out));
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("cannot spawn {}: {e}", node_bin.display()))?;
    let handle = ChildHandle {
        kind: "node-api",
        child,
    };
    // Log env NAMES only — never values.
    let names: Vec<&str> = envs.iter().map(|(k, _)| k.as_str()).collect();
    logger.info(&format!(
        "api started (pid {}) with env: {}",
        handle.pid(),
        names.join(",")
    ));
    Ok(handle)
}

/// Run a short-lived helper to completion, capturing output. Used for
/// `pg_isready` and the authenticated `SELECT 1` probe. PGPASSWORD (when
/// needed) is passed via `.env()` — environment only, never argv.
pub fn run_helper(
    bin: &std::path::Path,
    args: &[&str],
    envs: &[(String, String)],
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("cannot spawn {}: {e}", bin.display()))
}

/// Bounded poll of `pg_isready`. `Ok(true)` = accepting connections.
pub fn wait_pg_ready(
    pg_isready_bin: &std::path::Path,
    host: &str,
    port: u16,
    timeout: Duration,
    logger: &Logger,
) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    let mut attempt: u64 = 0;
    loop {
        attempt += 1;
        let out = run_helper(pg_isready_bin, &["-h", host, "-p", &port.to_string()], &[])?;
        if out.status.success() {
            logger.info(&format!(
                "pg_isready: accepting connections (attempt {attempt})"
            ));
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// Shutdown one child with an escalation ladder. `first_sigs` is the ordered
/// signal list for that child kind (e.g. [SIGTERM] for the API,
/// [SIGINT, SIGQUIT] for postgres); SIGKILL is the final, always-present
/// rung. Each rung gets `rung_timeout`; a rung "succeeds" when the child
/// is reaped (any exit code or signal death) within its budget.
pub fn stop_child(
    handle: &mut ChildHandle,
    first_sigs: &[i32],
    rung_timeout: Duration,
    kill_timeout: Duration,
    logger: &Logger,
) -> Result<Option<ExitStatus>, String> {
    for &sig in first_sigs {
        signal_child(&handle.child, sig, handle.kind)?;
        match handle.wait_timeout(rung_timeout) {
            Ok(Some(status)) => {
                logger.info(&format!(
                    "{} stopped by signal {sig} ({})",
                    handle.kind,
                    ChildHandle::describe_exit(&status)
                ));
                return Ok(Some(status));
            }
            Ok(None) => {
                logger.warn(&format!(
                    "{} did not exit within {}s after signal {sig} — escalating",
                    handle.kind,
                    rung_timeout.as_secs_f64()
                ));
            }
            Err(e) => return Err(e),
        }
    }
    // Final rung: SIGKILL.
    signal_child(&handle.child, libc::SIGKILL, handle.kind)?;
    match handle.wait_timeout(kill_timeout) {
        Ok(Some(status)) => {
            logger.warn(&format!(
                "{} stopped by SIGKILL ({}) — bounded escalation exhausted",
                handle.kind,
                ChildHandle::describe_exit(&status)
            ));
            Ok(Some(status))
        }
        Ok(None) => Err(format!(
            "{} survived SIGKILL (unreapable) — this is an OS-level failure",
            handle.kind
        )),
        Err(e) => Err(e),
    }
}

fn open_append(path: &std::path::Path, what: &str) -> Result<std::fs::File, String> {
    use std::fs::OpenOptions;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create parent of {what}: {e}"))?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("cannot open {what} {}: {e}", path.display()))
}
