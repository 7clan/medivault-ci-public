//! Background Service (SMAppService) control commands — the production
//! registration path for the MediVault supervisor LaunchAgent on macOS 13+.
//!
//! Apple's CURRENT ServiceManagement architecture (the ONLY supported
//! registration path — no legacy `launchctl load/unload`, no
//! SMLoginItemSetEnabled):
//!
//!   * USER-SCOPED LaunchAgent (`SMAppService.agent`), NO root, NO
//!     LaunchDaemon. The plist ships inside the app bundle at
//!     `Contents/Library/LaunchAgents/dev.medivault.supervisor.plist`
//!     with a bundle-relative `BundleProgram`.
//!   * The real status model is surfaced EXACTLY (no invented values):
//!     `notRegistered | enabled | requiresApproval | notFound`
//!     (SMAppService.Status). `requiresApproval` is handled by calling
//!     `SMAppService.openSystemSettingsLoginItems()`.
//!
//! IMPLEMENTATION
//!   SMAppService is an Objective-C/Swift API; the Rust shell invokes the
//!   dedicated helper binary shipped at `Contents/MacOS/mediavault-launchagent`
//!   (macos/smappservice/medivault-launchagent.swift). The helper runs from
//!   inside MediVault.app, so its `Bundle.main` is the app bundle and
//!   `SMAppService.agent(plistName:)` resolves the shipped plist.
//!
//!   The helper prints one of the four status strings on stdout; this
//!   module maps them to the IPC enum. Any other output is an error
//!   (fail-closed — never guessed, never defaulted).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// The Apple SMAppService status model — exactly the four documented
/// values, camelCase for the IPC boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackgroundServiceStatus {
    /// The service hasn't been registered with the Service Management
    /// framework (fresh install) — the UI offers registration.
    NotRegistered,
    /// Successfully registered and eligible to run (Login Item active).
    Enabled,
    /// Registered but the user must approve it in System Settings →
    /// Login Items — the UI must offer the
    /// `openSystemSettingsLoginItems()` action.
    RequiresApproval,
    /// The framework couldn't find the service (installation or
    /// configuration error) — the UI reports a setup problem.
    NotFound,
}

const HELPER_NAME: &str = "mediavault-launchagent";

/// Map the helper's exact status line to the IPC enum. Private string
/// mapping is unit-tested below; anything unknown is an error.
fn map_status(raw: &str) -> Result<BackgroundServiceStatus, String> {
    match raw.trim() {
        "notRegistered" => Ok(BackgroundServiceStatus::NotRegistered),
        "enabled" => Ok(BackgroundServiceStatus::Enabled),
        "requiresApproval" => Ok(BackgroundServiceStatus::RequiresApproval),
        "notFound" => Ok(BackgroundServiceStatus::NotFound),
        other => Err(format!(
            "unexpected SMAppService status from helper: {other:?} \
             (expected one of notRegistered|enabled|requiresApproval|notFound)"
        )),
    }
}

/// Resolve the helper shipped beside this executable:
/// `<bundle>/Contents/MacOS/mediavault-launchagent` (this binary is at
/// `<bundle>/Contents/MacOS/medivault` — the Cargo package name, mirrored
/// by CFBundleExecutable). Fail closed when missing.
///
/// LOOKUP NOTE (first-red, runs 34650350460 + 34652537170): a plain
/// `stat()` of the joined path returned ENOENT **while the app's own
/// readdir of the SAME directory listed the helper as a regular file**
/// (and bash could stat AND execute it). The lookup therefore uses the
/// directory entry itself — `read_dir` + exact-name match — and the
/// command uses the ENTRY's own path (the on-disk name is ground truth,
/// immune to stat-path divergence). The stat diagnostic is preserved.
fn helper_path() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Background service control requires macOS".to_string());
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve the app executable path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "app executable has no parent directory".to_string())?
        .to_path_buf();
    let joined = dir.join(HELPER_NAME);

    // Ground truth: the directory's own entries.
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries.filter_map(|en| en.ok()).collect::<Vec<_>>(),
        Err(e) => {
            return Err(format!(
                "SMAppService helper lookup failed: cannot read the app bundle directory {} (readdir error: {} [os error {}]) — current_exe: {}",
                dir.display(),
                e,
                e.raw_os_error().unwrap_or(-1),
                exe.display()
            ))
        }
    };
    // DEBUG-formatted names: Rust's OsStr Debug ESCAPES every non-printable
    // byte, so invisible characters become visible escape sequences on
    // screen - the listing becomes self-describing ground truth.
    let listing = entries
        .iter()
        .map(|en| {
            let name = format!("{:?}", en.file_name());
            let kind = match en.file_type() {
                Ok(t) if t.is_dir() => "d",
                Ok(t) if t.is_symlink() => "l",
                Ok(_) => "f",
                Err(_) => "?",
            };
            format!("{name}[{kind}]")
        })
        .collect::<Vec<_>>()
        .join(" ");

    // Name matching: APFS is case-insensitive AND normalization-insensitive
    // (execve from bash matches the on-disk name regardless of case or
    // Unicode decomposition), but a BYTE comparison does not. First-red
    // evidence (runs 34650350460..34654268262): the entry's rendered name
    // equals the constant, yet the exact comparison fails — the on-disk
    // name carries a non-ASCII/normalization artifact. Match on the
    // ASCII-printable, case-folded projection; ALWAYS use the ENTRY's own
    // path (the true on-disk name) for the stat/spawn.
    fn ascii_fold(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .flat_map(|c| c.to_lowercase())
            .collect()
    }
    let wanted = ascii_fold(HELPER_NAME);

    let mut helper: Option<PathBuf> = None;
    let mut entry_is_regular = false;
    for en in &entries {
        if ascii_fold(&en.file_name().to_string_lossy()) == wanted {
            helper = Some(en.path());
            entry_is_regular = en
                .file_type()
                .map(|t| t.is_file())
                .unwrap_or(false);
            break;
        }
    }
    let helper = match helper {
        Some(h) => h,
        None => {
            return Err(format!(
                "SMAppService helper missing from the app bundle: {} (installation incomplete?) — current_exe: {} — wanted: {:?} — app-view of {}: {}",
                joined.display(),
                exe.display(),
                HELPER_NAME,
                dir.display(),
                listing
            ))
        }
    };

    // The entry must be a regular file (entry metadata; NOT a plain stat of
    // the joined path — see the lookup note).
    if !entry_is_regular {
        return Err(format!(
            "SMAppService helper is not a regular file: {} — app-view of {}: {}",
            helper.display(),
            dir.display(),
            listing
        ));
    }
    let _ = joined;
    Ok(helper)
}

/// Run the helper with one subcommand and return its stdout. Bounded wait —
/// a hung helper must never hang the UI.
fn run_helper(subcommand: &str) -> Result<String, String> {
    let helper = helper_path()?;
    let output = std::process::Command::new(&helper)
        .arg(subcommand)
        .output()
        .map_err(|e| format!("failed to launch {}: {e}", helper.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "mediavault-launchagent {subcommand} failed (exit {}): {stderr}",
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Current SMAppService status of the supervisor LaunchAgent.
#[tauri::command]
pub async fn background_service_status() -> Result<BackgroundServiceStatus, String> {
    let raw = tauri::async_runtime::spawn_blocking(move || run_helper("status"))
        .await
        .map_err(|e| format!("status task join error: {e}"))??;
    map_status(&raw)
}

/// Register the background service (SMAppService.register). After success,
/// macOS may still require user approval in Login Items (status becomes
/// `requiresApproval`) — the UI follows up with a status poll.
#[tauri::command]
pub async fn background_service_register() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_helper("register"))
        .await
        .map_err(|e| format!("register task join error: {e}"))??;
    Ok(())
}

/// Unregister the background service (SMAppService.unregister). The user
/// can also disable the item in System Settings; this is the explicit
/// in-app control.
#[tauri::command]
pub async fn background_service_unregister() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_helper("unregister"))
        .await
        .map_err(|e| format!("unregister task join error: {e}"))??;
    Ok(())
}

/// Open System Settings → Login Items (Apple's required action for the
/// `requiresApproval` state — the user, not the app, grants approval).
#[tauri::command]
pub async fn background_service_open_login_items_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_helper("open-settings"))
        .await
        .map_err(|e| format!("open-settings task join error: {e}"))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_four_documented_statuses() {
        assert_eq!(
            map_status("notRegistered").unwrap(),
            BackgroundServiceStatus::NotRegistered
        );
        assert_eq!(
            map_status("enabled").unwrap(),
            BackgroundServiceStatus::Enabled
        );
        assert_eq!(
            map_status("requiresApproval").unwrap(),
            BackgroundServiceStatus::RequiresApproval
        );
        assert_eq!(
            map_status("notFound").unwrap(),
            BackgroundServiceStatus::NotFound
        );
        // tolerant of surrounding whitespace only — nothing else
        assert_eq!(
            map_status("  enabled\n").unwrap(),
            BackgroundServiceStatus::Enabled
        );
    }

    #[test]
    fn rejects_any_invented_or_future_status_fail_closed() {
        for bad in [
            "unknown(99)",
            "Unknown",
            "ENABLED",
            "registered",
            "approved",
            "",
            "notregistered",
        ] {
            assert!(map_status(bad).is_err(), "must reject {bad:?}");
        }
    }
}
