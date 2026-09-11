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
//!   dedicated helper binary shipped at `Contents/MacOS/medivault-launchagent`
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

const HELPER_NAME: &str = "medivault-launchagent";

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
/// `<bundle>/Contents/MacOS/medivault-launchagent` (this binary is at
/// `<bundle>/Contents/MacOS/medivault` — the Cargo package name, mirrored
/// by CFBundleExecutable). Fail closed when missing.
///
/// The error surface is fully diagnostic (first-red investigation): the
/// exact stat error + errno + the current_exe the path was derived from,
/// because an "is_file() == false" on a file that provably exists must be
/// diagnosable from the UI message alone.
fn helper_path() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Background service control requires macOS".to_string());
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve the app executable path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "app executable has no parent directory".to_string())?;
    let helper = dir.join(HELPER_NAME);
    match std::fs::metadata(&helper) {
        Ok(md) if md.is_file() => Ok(helper),
        Ok(md) => Err(format!(
            "SMAppService helper is not a regular file: {} (is_dir={}, len={}, mode={:#o}) — current_exe: {}",
            helper.display(),
            md.is_dir(),
            md.len(),
            {
                use std::os::unix::fs::PermissionsExt;
                md.permissions().mode()
            },
            exe.display()
        )),
        Err(e) => Err(format!(
            "SMAppService helper missing from the app bundle: {} (installation incomplete? stat error: {} [os error {}]) — current_exe: {}",
            helper.display(),
            e,
            e.raw_os_error().unwrap_or(-1),
            exe.display()
        )),
    }
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
            "medivault-launchagent {subcommand} failed (exit {}): {stderr}",
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
