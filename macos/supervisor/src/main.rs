//! mediavault-supervisor — the MediVault macOS background supervisor.
//!
//! Runs as the LaunchAgent foreground process (SMAppService.agent contract:
//! RunAtLoad + KeepAlive). One instance per machine user, enforced by an
//! advisory flock on `<app-support>/runtime-state/supervisor.lock`.
//!
//! Usage:
//!   mediavault-supervisor run    --config <path>
//!   mediavault-supervisor status --config <path>
//!   mediavault-supervisor version
//!
//! Exit codes:
//!   0  clean shutdown (SIGTERM/SIGINT graceful path)
//!   1  fatal error (fail-closed; see supervisor.log / status last_error)
//!   2  `status` requested but no status file exists / unreadable
//!   3  another supervisor instance already holds the lock
//!   4  config missing or invalid
//!   5  cluster not provisioned (run the provisioner first)

mod config;
mod health;
#[cfg(target_os = "macos")]
mod keychain;
mod logging;
mod proc;
mod secrets;
mod status;
mod supervise;

use std::sync::atomic::{AtomicBool, Ordering};

use config::Config;
use logging::Logger;
use supervise::Supervisor;

/// Set by the SIGTERM/SIGINT handler (async-signal-safe: one atomic store).
static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn shutdown_requested() -> bool {
    SHUTDOWN_REQUESTED.load(Ordering::SeqCst)
}

extern "C" fn on_signal(_sig: libc::c_int) {
    SHUTDOWN_REQUESTED.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    // SAFETY: installing plain signal(2) handlers whose bodies perform a
    // single atomic store — async-signal-safe by construction.
    unsafe {
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        // Never die from a child-exit signal we didn't ask for.
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
}

/// Advisory single-instance lock (flock). The kernel releases it when the
/// process dies, so a crashed supervisor never leaves a stale lock.
struct InstanceLock {
    _file: std::fs::File,
}

impl InstanceLock {
    fn acquire(path: &std::path::Path, pid: u32) -> Result<InstanceLock, String> {
        use std::fs::OpenOptions;
        use std::io::Write;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("cannot create lock dir: {e}"))?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .truncate(false)
            .open(path)
            .map_err(|e| format!("cannot open lock file {}: {e}", path.display()))?;
        // SAFETY: flock(2) on a owned fd, non-blocking.
        let rc = unsafe {
            libc::flock(
                file.as_raw_fd() as libc::c_int,
                libc::LOCK_EX | libc::LOCK_NB,
            )
        };
        if rc != 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EWOULDBLOCK) {
                let holder = std::fs::read_to_string(path)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                return Err(format!(
                    "another supervisor instance is running (lock held; lock file records pid '{holder}')"
                ));
            }
            return Err(format!("flock failed: {err}"));
        }
        // Informational only — the flock is authoritative.
        let _ = file.set_len(0);
        let _ = file.write_all(format!("{pid}\n").as_bytes());
        Ok(InstanceLock { _file: file })
    }
}

use std::os::fd::AsRawFd;

fn usage() -> ! {
    eprintln!(
        "mediavault-supervisor {} — MediVault macOS background supervisor\n\
         \n\
         usage:\n\
         \x20 mediavault-supervisor [run]    [--config <supervisor-config.json>]\n\
         \x20 mediavault-supervisor status   [--config <supervisor-config.json>]\n\
         \x20 mediavault-supervisor bootstrap-secrets [--config <supervisor-config.json>]\n\
         \x20 mediavault-supervisor version\n\
         \n\
         LaunchAgent shape (no arguments at all): run + the bundle-relative\n\
         default config at <exe>/../Resources/supervisor-config.json —\n\
         install-location independent (SMAppService BundleProgram contract).\n\
         --config stays available for the CI foreground harness and explicit\n\
         operator runs.",
        env!("CARGO_PKG_VERSION")
    );
    std::process::exit(64);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // LaunchAgent shape: BundleProgram starts the supervisor with NO
    // arguments at all — default to `run` (production contract). Explicit
    // subcommands keep working for operators and the CI harness.
    let cmd = args.first().map(String::as_str).unwrap_or("run");

    // `version` answers without touching any config.
    if cmd == "version" {
        println!(
            "mediavault-supervisor {} (config schema v{})",
            env!("CARGO_PKG_VERSION"),
            config::CONFIG_VERSION
        );
        return;
    }

    let config_path = extract_config(&args).unwrap_or_else(|msg| {
        eprintln!("error: {msg}");
        usage();
    });

    match cmd {
        "version" => unreachable!(),
        "bootstrap-secrets" => {
            // Explicit first-run Keychain item creation (never run, never
            // auto): create each missing item with a random value; existing
            // items are NEVER overwritten. Account names only in output.
            #[cfg(target_os = "macos")]
            {
                match Config::load_and_resolve(&config_path) {
                    Ok(_) => {
                        for account in keychain::ALL_ACCOUNTS {
                            match keychain::bootstrap_item(account) {
                                Ok(keychain::BootstrapOutcome::Created) => {
                                    println!("created keychain item: {account}");
                                }
                                Ok(keychain::BootstrapOutcome::AlreadyPresent) => {
                                    println!("already present (left untouched): {account}");
                                }
                                Err(e) => {
                                    eprintln!("error: {e}");
                                    std::process::exit(1);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("error: {e}");
                        std::process::exit(4);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                eprintln!(
                    "error: bootstrap-secrets requires macOS (this build targets another OS)"
                );
                std::process::exit(1);
            }
        }
        "status" => match Config::load_and_resolve(&config_path) {
            Ok(resolved) => match status::Status::read(&resolved.status_file) {
                Ok(st) => {
                    println!("{}", serde_json::to_string_pretty(&st).unwrap_or_default());
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(2);
                }
            },
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(4);
            }
        },
        "run" => {
            let resolved = match Config::load_and_resolve(&config_path) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(4);
                }
            };
            let logger = match Logger::new(&resolved.log_file) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            };
            logger.info(&format!(
                "mediavault-supervisor {} starting (pid {}, config {})",
                env!("CARGO_PKG_VERSION"),
                std::process::id(),
                config_path.display()
            ));

            let _lock = match InstanceLock::acquire(&resolved.lock_file, std::process::id()) {
                Ok(l) => l,
                Err(e) => {
                    logger.error(&format!("cannot acquire instance lock: {e}"));
                    std::process::exit(3);
                }
            };
            logger.info("single-instance lock acquired");

            let secrets = match secrets::Secrets::load(&resolved) {
                Ok(s) => s,
                Err(e) => {
                    logger.error(&e);
                    std::process::exit(1);
                }
            };
            logger.info("secrets loaded (source: env; values never logged)");

            install_signal_handlers();

            let supervisor = Supervisor::new(resolved, secrets, logger);
            let code = supervisor.run();
            std::process::exit(code);
        }
        _ => usage(),
    }
}

fn extract_config(args: &[String]) -> Result<std::path::PathBuf, String> {
    let mut path: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--config" => {
                path = Some(
                    args.get(i + 1)
                        .ok_or_else(|| "--config requires a path".to_string())?
                        .clone(),
                );
                i += 2;
            }
            "run" | "status" | "version" | "bootstrap-secrets" => i += 1,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    match path {
        Some(p) => {
            let pb = std::path::PathBuf::from(p);
            if !pb.is_file() {
                return Err(format!("config file does not exist: {}", pb.display()));
            }
            Ok(pb)
        }
        // LaunchAgent / production default (SMAppService BundleProgram starts
        // this process with no arguments): the config ships INSIDE the app
        // bundle at Contents/Resources/supervisor-config.json, resolved
        // relative to THIS executable (Contents/MacOS/mediavault-supervisor).
        // The shipped config's bundle paths are themselves Contents/
        // — the whole chain is install-location independent.
        None => {
            let default = default_config_path()?;
            if !default.is_file() {
                return Err(format!(
                    "no --config given and the default bundle config does not exist: {}",
                    default.display()
                ));
            }
            Ok(default)
        }
    }
}

/// <exe-dir>/../Resources/supervisor-config.json — the shipped production
/// config location (exe is Contents/MacOS/mediavault-supervisor inside the
/// installed MediVault.app; CI staging trees share the same shape).
pub fn default_config_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve the supervisor executable path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "supervisor executable has no parent directory".to_string())?;
    let default = dir.join("..").join("Resources").join("supervisor-config.json");
    Ok(std::path::PathBuf::from(
        std::fs::canonicalize(&default)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| default.to_string_lossy().into_owned()),
    ))
}
