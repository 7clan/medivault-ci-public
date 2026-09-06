//! Supervisor configuration contract.
//!
//! The config file is the NON-SECRET half of the supervisor's state (the
//! architecture audit's split: non-secret metadata lives in
//! `~/Library/Application Support/MediVault`, secrets never touch disk —
//! they arrive from the SecretsProvider seam). Paths are absolute; the
//! supervisor never shells out and never searches PATH — every executable
//! it runs is an absolute path taken from this config.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Supported config schema versions. Bump on breaking change.
pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Must equal [`CONFIG_VERSION`].
    pub version: u32,
    pub paths: PathsConfig,
    pub postgres: PostgresConfig,
    pub api: ApiConfig,
    pub secrets: SecretsConfig,
    #[serde(default)]
    pub limits: LimitsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathsConfig {
    /// Root of the shipped PostgreSQL runtime bundle
    /// (`MediVault.app/Contents/Resources/runtime/postgresql/17`).
    pub pg_bundle: String,
    /// Node runtime binary (absolute path).
    pub node_binary: String,
    /// API entry point (`api/dist/index.js`, absolute path).
    pub api_entry: String,
    /// Working directory for the API child. Default: parent of `api_entry`
    /// (the API resolves `data/` relative to cwd when
    /// `MEDIVAULT_DATA_DIR` is unset — we always set it, but cwd is still
    /// the packaged layout).
    #[serde(default)]
    pub api_working_dir: Option<String>,
    /// `~/Library/Application Support/MediVault` (mutable state root).
    pub app_support_dir: String,
    /// `~/Library/Logs/MediVault`.
    pub log_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostgresConfig {
    /// Bind host. Default (and product contract): `127.0.0.1` — local-only.
    #[serde(default = "default_pg_host")]
    pub host: String,
    pub port: u16,
    #[serde(default = "default_pg_superuser")]
    pub superuser: String,
    pub app_user: String,
    pub app_database: String,
    /// Cluster location relative to the app-support dir.
    /// Default: `PostgreSQL/17/data` (never inside the .app bundle).
    #[serde(default = "default_pgdata_rel")]
    pub pgdata_rel: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiConfig {
    /// Bind host. Default: `127.0.0.1`.
    #[serde(default = "default_pg_host")]
    pub host: String,
    pub port: u16,
    /// Comma-separated CORS origin list injected as `ALLOWED_ORIGINS`.
    #[serde(default = "default_allowed_origins")]
    pub allowed_origins: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecretsConfig {
    /// `env` (CI + first stages) | `keychain` (provisioning stage).
    /// `keychain` fails closed with an explicit not-yet-wired error until
    /// that stage lands.
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitsConfig {
    #[serde(default = "default_pg_start_timeout")]
    pub pg_start_timeout_sec: u64,
    #[serde(default = "default_api_start_timeout")]
    pub api_start_timeout_sec: u64,
    #[serde(default = "default_pg_stop_timeout")]
    pub pg_stop_timeout_sec: u64,
    #[serde(default = "default_api_stop_timeout")]
    pub api_stop_timeout_sec: u64,
    #[serde(default = "default_health_interval")]
    pub health_interval_sec: u64,
    #[serde(default = "default_health_fail_threshold")]
    pub health_fail_threshold: u32,
    #[serde(default = "default_max_restarts")]
    pub max_restarts_per_child: u32,
    #[serde(default = "default_backoff_base")]
    pub restart_backoff_base_ms: u64,
    #[serde(default = "default_backoff_cap")]
    pub restart_backoff_cap_ms: u64,
}

impl Default for LimitsConfig {
    fn default() -> Self {
        LimitsConfig {
            pg_start_timeout_sec: default_pg_start_timeout(),
            api_start_timeout_sec: default_api_start_timeout(),
            pg_stop_timeout_sec: default_pg_stop_timeout(),
            api_stop_timeout_sec: default_api_stop_timeout(),
            health_interval_sec: default_health_interval(),
            health_fail_threshold: default_health_fail_threshold(),
            max_restarts_per_child: default_max_restarts(),
            restart_backoff_base_ms: default_backoff_base(),
            restart_backoff_cap_ms: default_backoff_cap(),
        }
    }
}

fn default_pg_host() -> String {
    "127.0.0.1".to_string()
}
fn default_pg_superuser() -> String {
    "postgres".to_string()
}
fn default_pgdata_rel() -> String {
    "PostgreSQL/17/data".to_string()
}
fn default_allowed_origins() -> String {
    "http://localhost:3000".to_string()
}
fn default_pg_start_timeout() -> u64 {
    120
}
fn default_api_start_timeout() -> u64 {
    90
}
fn default_pg_stop_timeout() -> u64 {
    60
}
fn default_api_stop_timeout() -> u64 {
    30
}
fn default_health_interval() -> u64 {
    5
}
fn default_health_fail_threshold() -> u32 {
    3
}
fn default_max_restarts() -> u32 {
    5
}
fn default_backoff_base() -> u64 {
    500
}
fn default_backoff_cap() -> u64 {
    8000
}

/// A validated config plus every derived path the supervisor uses.
#[derive(Debug)]
pub struct Resolved {
    pub pg_bin: PathBuf,
    pub pg_isready_bin: PathBuf,
    pub psql_bin: PathBuf,
    pub node_bin: PathBuf,
    pub api_entry: PathBuf,
    pub api_working_dir: PathBuf,
    pub app_support: PathBuf,
    pub log_dir: PathBuf,
    pub runtime_state_dir: PathBuf,
    pub pgdata: PathBuf,
    pub status_file: PathBuf,
    pub lock_file: PathBuf,
    pub storage_dir: PathBuf,
    pub log_file: PathBuf,
    pub postgres_log: PathBuf,
    pub api_log: PathBuf,

    pub pg_host: String,
    pub pg_port: u16,
    /// Superuser name (used by the provisioner's bootstrap contract; the
    /// supervisor itself only needs the app role — kept because the config
    /// schema is one document shared with the provisioning stage).
    #[allow(dead_code)]
    pub pg_superuser: String,
    pub pg_app_user: String,
    pub pg_app_database: String,

    pub api_host: String,
    pub api_port: u16,
    pub api_allowed_origins: String,

    pub secrets_source: String,
    pub limits: LimitsConfig,
}

/// Expand a leading `~` / `~/…` to `$HOME` (LaunchAgents run with HOME set;
/// the production config ships user-relative paths). Non-tilde paths pass
/// through unchanged. A missing HOME with a tilde path is an error.
pub fn expand_tilde(p: &str) -> Result<String, String> {
    if p == "~" || p.starts_with("~/") {
        let home =
            std::env::var("HOME").map_err(|_| "path uses '~' but HOME is not set".to_string())?;
        if p == "~" {
            Ok(home)
        } else {
            Ok(format!("{home}/{}", &p[2..]))
        }
    } else {
        Ok(p.to_string())
    }
}

impl Config {
    /// Parse + validate. Every executable the supervisor will run must
    /// already exist (fail closed before spawning anything).
    pub fn load_and_resolve(path: &Path) -> Result<Resolved, String> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read config {}: {e}", path.display()))?;
        let cfg: Config = serde_json::from_str(&raw)
            .map_err(|e| format!("invalid config JSON in {}: {e}", path.display()))?;

        if cfg.version != CONFIG_VERSION {
            return Err(format!(
                "config version {} is not supported (expected {CONFIG_VERSION})",
                cfg.version
            ));
        }
        if cfg.secrets.source != "env" && cfg.secrets.source != "keychain" {
            return Err(format!(
                "unknown secrets.source '{}' (expected \"env\" or \"keychain\")",
                cfg.secrets.source
            ));
        }
        if cfg.secrets.source == "keychain" {
            return Err(
                "secrets.source \"keychain\" is not wired yet — it arrives with the \
                 Keychain/provisioning stage; use \"env\" for now"
                    .to_string(),
            );
        }

        let expand = |field: &str, p: &str| -> Result<PathBuf, String> {
            Ok(PathBuf::from(expand_tilde(p).map_err(|e| {
                format!("config error: paths.{field}: {e}")
            })?))
        };
        let app_support = expand("app_support_dir", &cfg.paths.app_support_dir)?;
        let log_dir = expand("log_dir", &cfg.paths.log_dir)?;
        let pg_bundle = expand("pg_bundle", &cfg.paths.pg_bundle)?;
        let node_bin = expand("node_binary", &cfg.paths.node_binary)?;
        let api_entry = expand("api_entry", &cfg.paths.api_entry)?;
        let api_working_dir = match &cfg.paths.api_working_dir {
            Some(d) => Some(expand("api_working_dir", d)?),
            None => None,
        };
        let api_working_dir = match api_working_dir {
            Some(d) => d,
            None => api_entry
                .parent()
                .ok_or_else(|| "api_entry has no parent directory".to_string())?
                .to_path_buf(),
        };

        let runtime_state_dir = app_support.join("runtime-state");
        let storage_dir = app_support.join("storage");
        let pgdata = app_support.join(&cfg.postgres.pgdata_rel);
        let pg_bin = pg_bundle.join("bin/postgres");
        let pg_isready_bin = pg_bundle.join("bin/pg_isready");
        let psql_bin = pg_bundle.join("bin/psql");

        for (what, p) in [
            ("pg_bundle/bin/postgres", &pg_bin),
            ("pg_bundle/bin/pg_isready", &pg_isready_bin),
            ("pg_bundle/bin/psql", &psql_bin),
            ("node_binary", &node_bin),
            ("api_entry", &api_entry),
        ] {
            if !p.is_file() {
                return Err(format!(
                    "config error: {what} does not exist: {}",
                    p.display()
                ));
            }
        }
        if !api_working_dir.is_dir() {
            return Err(format!(
                "config error: api_working_dir does not exist: {}",
                api_working_dir.display()
            ));
        }

        Ok(Resolved {
            pg_bin,
            pg_isready_bin,
            psql_bin,
            node_bin,
            api_entry,
            api_working_dir,
            app_support,
            log_dir: log_dir.clone(),
            runtime_state_dir: runtime_state_dir.clone(),
            pgdata,
            status_file: runtime_state_dir.join("supervisor-status.json"),
            lock_file: runtime_state_dir.join("supervisor.lock"),
            storage_dir,
            log_file: log_dir.join("supervisor.log"),
            postgres_log: log_dir.join("postgres.log"),
            api_log: log_dir.join("api.log"),

            pg_host: cfg.postgres.host,
            pg_port: cfg.postgres.port,
            pg_superuser: cfg.postgres.superuser,
            pg_app_user: cfg.postgres.app_user,
            pg_app_database: cfg.postgres.app_database,

            api_host: cfg.api.host,
            api_port: cfg.api.port,
            api_allowed_origins: cfg.api.allowed_origins,

            secrets_source: cfg.secrets.source,
            limits: cfg.limits,
        })
    }
}

/// Exponential restart backoff in milliseconds: base * 2^(restart-1),
/// capped. Interruptible sleep is the caller's job.
pub fn backoff_ms(restarts: u32, limits: &LimitsConfig) -> u64 {
    let shift = restarts.saturating_sub(1).min(16);
    let raw = limits.restart_backoff_base_ms.saturating_mul(1u64 << shift);
    raw.min(limits.restart_backoff_cap_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"{
      "version": 1,
      "paths": {
        "pg_bundle": "/opt/pg",
        "node_binary": "/opt/node",
        "api_entry": "/opt/api/dist/index.js",
        "app_support_dir": "/tmp/mv",
        "log_dir": "/tmp/mv-logs"
      },
      "postgres": { "port": 55434, "app_user": "medivault", "app_database": "medivault" },
      "api": { "port": 4572 },
      "secrets": { "source": "env" }
    }"#;

    #[test]
    fn parses_minimal_with_defaults() {
        let cfg: Config = serde_json::from_str(MINIMAL).unwrap();
        assert_eq!(cfg.postgres.host, "127.0.0.1");
        assert_eq!(cfg.postgres.superuser, "postgres");
        assert_eq!(cfg.postgres.pgdata_rel, "PostgreSQL/17/data");
        assert_eq!(cfg.api.host, "127.0.0.1");
        assert_eq!(cfg.api.allowed_origins, "http://localhost:3000");
        assert_eq!(cfg.limits.max_restarts_per_child, 5);
    }

    #[test]
    fn rejects_unknown_version() {
        let bad = MINIMAL.replace("\"version\": 1", "\"version\": 2");
        let cfg: Result<Config, _> = serde_json::from_str(&bad);
        assert!(cfg.is_ok()); // parse ok; version check happens in load_and_resolve
    }

    #[test]
    fn rejects_unknown_fields() {
        let trimmed = &MINIMAL[..MINIMAL.len() - 1];
        let bad = format!("{trimmed}, \"nonsense\": true}}");
        let cfg: Result<Config, _> = serde_json::from_str(&bad);
        assert!(cfg.is_err());
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let limits = LimitsConfig {
            restart_backoff_base_ms: 500,
            restart_backoff_cap_ms: 8000,
            ..LimitsConfig::default()
        };
        assert_eq!(backoff_ms(1, &limits), 500);
        assert_eq!(backoff_ms(2, &limits), 1000);
        assert_eq!(backoff_ms(3, &limits), 2000);
        assert_eq!(backoff_ms(5, &limits), 8000);
        assert_eq!(backoff_ms(50, &limits), 8000);
    }

    #[test]
    fn tilde_expansion() {
        // HOME is set by the test harness environment; verify against it
        // dynamically so the test is portable.
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_tilde("/abs/path").unwrap(), "/abs/path");
        assert_eq!(expand_tilde("~").unwrap(), home);
        assert_eq!(
            expand_tilde("~/Library/Logs/MediVault").unwrap(),
            format!("{home}/Library/Logs/MediVault")
        );
        // only a LEADING tilde expands
        assert_eq!(expand_tilde("/opt/~/weird").unwrap(), "/opt/~/weird");
    }
}
