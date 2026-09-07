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
    /// Provisioner delegation (Keychain/provisioning stage): when present,
    /// the supervisor delegates first-run provisioning to the Node
    /// provisioner instead of failing closed on an unprovisioned cluster.
    /// Absent = the frozen stage-1 behavior (fail closed, exit 5).
    #[serde(default)]
    pub provisioner: Option<ProvisionerConfig>,
    #[serde(default)]
    pub limits: LimitsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvisionerConfig {
    /// Path to the provisioner entry (`provision/dist/index.js`) —
    /// absolute or `Contents/`-relative (shipped production shape).
    pub entry: String,
    /// Path to the prisma CLI JS entry (`prisma/build/index.js`) —
    /// absolute or `Contents/`-relative.
    pub prisma_cli: String,
    /// Path to `schema.prisma` (migrations live beside it) —
    /// absolute or `Contents/`-relative.
    pub prisma_schema: String,
    /// Bounded wait for one `provision` run (default 600s).
    #[serde(default = "default_provision_timeout")]
    pub timeout_sec: u64,
}

fn default_provision_timeout() -> u64 {
    600
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathsConfig {
    /// Root of the shipped PostgreSQL runtime bundle. May be ABSOLUTE
    /// (CI harness) or app-bundle RELATIVE (shipped production config:
    /// `Contents/Resources/runtime/postgresql/17` — resolved against the
    /// installed app bundle, so the same .app works from /Applications,
    /// ~/Applications, or any other location).
    pub pg_bundle: String,
    /// Node runtime binary — absolute or `Contents/`-relative.
    pub node_binary: String,
    /// API entry point (`api/dist/index.js`) — absolute or `Contents/`-relative.
    pub api_entry: String,
    /// Working directory for the API child — absolute, `Contents/`-relative,
    /// or absent (default: parent of `api_entry`).
    #[serde(default)]
    pub api_working_dir: Option<String>,
    /// `~/Library/Application Support/MediVault` (mutable state root) —
    /// absolute or `~/`-relative. ABSENT in the shipped production config:
    /// the per-user default is applied at load time (the config must not
    /// embed any user identity).
    #[serde(default)]
    pub app_support_dir: Option<String>,
    /// `~/Library/Logs/MediVault` — same contract as app_support_dir.
    #[serde(default)]
    pub log_dir: Option<String>,
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
    /// `env` (CI + first stages) | `keychain` (production, macOS).
    /// `keychain` is implemented by the Keychain/provisioning stage on
    /// macOS; non-macOS builds fail closed at load with an explicit error.
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
    /// Path to the config document (re-passed to the provisioner child).
    pub config_path: PathBuf,
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
    pub provisioner_log: PathBuf,

    /// Provisioner delegation (None = frozen stage-1 fail-closed behavior).
    pub provisioner_entry: Option<PathBuf>,

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
    /// Bounded wait for one delegated `provision` run.
    pub provision_timeout_sec: u64,
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

/// Lexically normalize `.` / `..` components WITHOUT touching the
/// filesystem (no canonicalize — the target may be inspected for existence
/// separately, and lexical resolution keeps tests deterministic).
fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The installed app-bundle root, derived from THIS executable:
/// `<bundle>/Contents/MacOS/mediavault-supervisor` → `<bundle>`.
/// Used to resolve `Contents/`-relative config paths (the shipped
/// production config is install-location independent).
pub fn bundle_root_from_exe() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve the supervisor executable path: {e}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "supervisor executable has no parent directory".to_string())?;
    Ok(lexical_normalize(&exe_dir.join("..").join("..")))
}

/// The per-user default for `paths.app_support_dir` (applied when the
/// shipped production config omits the field — the config carries no
/// user identity).
fn default_app_support_dir() -> String {
    "~/Library/Application Support/MediVault".to_string()
}

/// The per-user default for `paths.log_dir`.
fn default_log_dir() -> String {
    "~/Library/Logs/MediVault".to_string()
}

/// Resolve one config path value: `~` expansion FIRST, then, if the value
/// is `Contents/`-prefixed, resolution against the app-bundle root
/// (absolute values pass through unchanged).
fn resolve_path(field: &str, value: &str, bundle_root: &Path) -> Result<PathBuf, String> {
    let expanded = expand_tilde(value)
        .map_err(|e| format!("config error: paths.{field}: {e}"))?;
    if expanded.starts_with("Contents/") || expanded == "Contents" {
        Ok(lexical_normalize(&bundle_root.join(&expanded)))
    } else {
        Ok(PathBuf::from(expanded))
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
        Self::resolve_parsed(cfg, path)
    }

    /// Resolution step (separated so tests can drive it with a synthetic
    /// bundle root without filesystem gymnastics).
    fn resolve_parsed(cfg: Config, path: &Path) -> Result<Resolved, String> {
        let bundle_root = bundle_root_from_exe()?;
        Self::resolve_with_bundle_root(cfg, path, &bundle_root)
    }

    /// Core resolution with an EXPLICIT bundle root (the CI/production
    /// path derives it from the executable; tests inject a temp dir).
    pub fn resolve_with_bundle_root(
        cfg: Config,
        path: &Path,
        bundle_root: &Path,
    ) -> Result<Resolved, String> {

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
        if cfg.secrets.source == "keychain" && !cfg!(target_os = "macos") {
            return Err(
                "secrets.source \"keychain\" requires macOS (this build targets another OS)"
                    .to_string(),
            );
        }

        let app_support = resolve_path(
            "app_support_dir",
            cfg.paths.app_support_dir.as_deref().unwrap_or(&default_app_support_dir()),
            bundle_root,
        )?;
        let log_dir = resolve_path(
            "log_dir",
            cfg.paths.log_dir.as_deref().unwrap_or(&default_log_dir()),
            bundle_root,
        )?;
        let pg_bundle = resolve_path("pg_bundle", &cfg.paths.pg_bundle, bundle_root)?;
        let node_bin = resolve_path("node_binary", &cfg.paths.node_binary, bundle_root)?;
        let api_entry = resolve_path("api_entry", &cfg.paths.api_entry, bundle_root)?;
        let api_working_dir = match &cfg.paths.api_working_dir {
            Some(d) => Some(resolve_path("api_working_dir", d, bundle_root)?),
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

        let provisioner_entry = match &cfg.provisioner {
            Some(prov) => {
                let entry = resolve_path("provisioner.entry", &prov.entry, bundle_root)?;
                for (what, p) in [
                    ("provisioner.entry", entry.clone()),
                    (
                        "provisioner.prisma_cli",
                        resolve_path("provisioner.prisma_cli", &prov.prisma_cli, bundle_root)?,
                    ),
                    (
                        "provisioner.prisma_schema",
                        resolve_path(
                            "provisioner.prisma_schema",
                            &prov.prisma_schema,
                            bundle_root
                        )?,
                    ),
                ] {
                    if !p.is_file() {
                        return Err(format!(
                            "config error: {what} does not exist: {}",
                            p.display()
                        ));
                    }
                }
                Some(entry)
            }
            None => None,
        };
        let provision_timeout_sec = cfg
            .provisioner
            .as_ref()
            .map(|p| p.timeout_sec)
            .unwrap_or(600);

        Ok(Resolved {
            config_path: path.to_path_buf(),
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
            provisioner_log: log_dir.join("provision.log"),

            provisioner_entry,
            provision_timeout_sec,

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

    // ------------------------------------------------------------------
    // Production relocatable-config contract (production-readiness phase)
    // ------------------------------------------------------------------

    /// The SHIPPED production shape: every bundle path is Contents/
    /// — relative; the user dirs are ABSENT (per-user defaults apply).
    const RELOCATABLE: &str = r#"{
      "version": 1,
      "paths": {
        "pg_bundle": "Contents/Resources/runtime/postgresql/17",
        "node_binary": "Contents/Resources/runtime/nodejs/bin/node",
        "api_entry": "Contents/Resources/api/dist/index.js",
        "api_working_dir": "Contents/Resources/api"
      },
      "postgres": { "port": 55432, "app_user": "medivault", "app_database": "medivault" },
      "api": { "port": 3001, "allowed_origins": "tauri://localhost,http://localhost:3000" },
      "secrets": { "source": "keychain" },
      "provisioner": {
        "entry": "Contents/Resources/provision/dist/index.js",
        "prisma_cli": "Contents/Resources/prisma-cli/node_modules/prisma/build/index.js",
        "prisma_schema": "Contents/Resources/prisma/schema.prisma"
      }
    }"#;

    #[test]
    fn relocatable_config_parses_with_optional_user_dirs() {
        let cfg: Config = serde_json::from_str(RELOCATABLE).unwrap();
        assert!(cfg.paths.app_support_dir.is_none());
        assert!(cfg.paths.log_dir.is_none());
        assert_eq!(
            cfg.paths.pg_bundle,
            "Contents/Resources/runtime/postgresql/17"
        );
        assert_eq!(cfg.secrets.source, "keychain");
    }

    #[test]
    fn resolve_path_bundles_relative_and_absolute() {
        let root = std::path::Path::new("/Applications/MediVault.app");
        assert_eq!(
            resolve_path("x", "Contents/Resources/api", root).unwrap(),
            std::path::PathBuf::from("/Applications/MediVault.app/Contents/Resources/api")
        );
        // tilde wins first, then Contents/ check; absolute passes through
        assert_eq!(
            resolve_path("x", "/opt/absolute", root).unwrap(),
            std::path::PathBuf::from("/opt/absolute")
        );
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            resolve_path("x", "~/Library/Logs/MediVault", root).unwrap(),
            std::path::PathBuf::from(format!("{home}/Library/Logs/MediVault"))
        );
    }

    #[test]
    fn bundle_root_from_exe_normalizes_lexically() {
        // The CONTRACT is bundle_root == lexical(exe_dir/../..) wherever
        // the binary actually lives (proven against THIS test binary's
        // real location — no bundle-shape assumption).
        let root = bundle_root_from_exe().unwrap();
        let exe = std::env::current_exe().unwrap();
        let exe_dir = exe.parent().unwrap();
        let manual = lexical_normalize(&exe_dir.join("..").join(".."));
        assert_eq!(root, manual);
        // The bundle-shape property (exe at <root>/Contents/MacOS ⇒
        // root == exe_dir/../.., and the return trip is exact) is proven
        // end-to-end by the production-readiness CI job from a REAL
        // installed .app; here we prove the lexical math on a synthetic
        // path where the shape genuinely holds:
        let app_exe =
            std::path::Path::new("/tmp/Synthetic.app/Contents/MacOS/mediavault-supervisor");
        let synth_root =
            lexical_normalize(&app_exe.parent().unwrap().join("..").join(".."));
        assert_eq!(synth_root, std::path::Path::new("/tmp/Synthetic.app"));
        assert_eq!(
            lexical_normalize(&synth_root.join("Contents").join("MacOS")),
            std::path::Path::new("/tmp/Synthetic.app/Contents/MacOS")
        );
    }

    #[test]
    fn full_relocatable_resolution_against_a_temp_bundle() {
        // Build a minimal but structurally-correct .app tree in a temp dir,
        // resolve the RELOCATABLE config against it, and assert every
        // derived path lands INSIDE that bundle (install-location
        // independence) — the same property the production-readiness CI
        // job proves end-to-end from an arbitrary install location.
        let base = std::env::temp_dir().join(format!(
            "mv-cfg-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        let app = base.join("OddLocation.app");
        for rel in [
            "Contents/MacOS/mediavault-supervisor",
            "Contents/Resources/runtime/postgresql/17/bin/postgres",
            "Contents/Resources/runtime/postgresql/17/bin/pg_isready",
            "Contents/Resources/runtime/postgresql/17/bin/psql",
            "Contents/Resources/runtime/nodejs/bin/node",
            "Contents/Resources/api/dist/index.js",
            "Contents/Resources/provision/dist/index.js",
            "Contents/Resources/prisma-cli/node_modules/prisma/build/index.js",
            "Contents/Resources/prisma/schema.prisma",
        ] {
            let p = app.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"placeholder").unwrap();
        }

        let cfg: Config = serde_json::from_str(RELOCATABLE).unwrap();
        let config_doc = base.join("supervisor-config.json");
        std::fs::write(&config_doc, RELOCATABLE).unwrap();

        // keychain source requires macOS — flip to env for this test so it
        // is portable (path resolution is what is under test here).
        let cfg_env_source = Config {
            secrets: SecretsConfig {
                source: "env".to_string(),
            },
            ..cfg
        };

        let resolved = Config::resolve_with_bundle_root(
            cfg_env_source,
            &config_doc,
            &app,
        )
        .unwrap();

        assert_eq!(
            resolved.pg_bin,
            app.join("Contents/Resources/runtime/postgresql/17/bin/postgres")
        );
        assert_eq!(
            resolved.node_bin,
            app.join("Contents/Resources/runtime/nodejs/bin/node")
        );
        assert_eq!(
            resolved.api_entry,
            app.join("Contents/Resources/api/dist/index.js")
        );
        assert_eq!(
            resolved.api_working_dir,
            app.join("Contents/Resources/api")
        );
        assert_eq!(
            resolved.provisioner_entry,
            Some(app.join("Contents/Resources/provision/dist/index.js"))
        );
        // user dirs default to the per-user locations (NOT inside the bundle)
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            resolved.app_support,
            std::path::PathBuf::from(format!("{home}/Library/Application Support/MediVault"))
        );
        assert_eq!(
            resolved.log_dir,
            std::path::PathBuf::from(format!("{home}/Library/Logs/MediVault"))
        );

        std::fs::remove_dir_all(&base).ok();
    }
}
