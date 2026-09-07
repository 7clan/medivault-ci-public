//! Backup and restore IPC commands.
//!
//! Provides manual backup creation to a user-selected destination, progress
//! tracking, checksum verification, restore preview, and execution.
//! Uses Tauri's dialog plugin for destination selection.

use crate::api_client::MedivaultApiClient;
use crate::credential;
use log::{debug, info};
use medivault_lib::{
    ApiResponse, BackupDriveStatus, BackupInfo, BackupProgress, ChecksumResult, RestorePreview,
    RestoreResult,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Shared backup state for tracking in-progress operations.
pub struct BackupState {
    pub current_backup_id: Mutex<Option<String>>,
    pub progress_map: Mutex<std::collections::HashMap<String, BackupProgress>>,
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct StartBackupBody {
    destination: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RestoreConfirmBody {
    confirmation: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check the status of the backup destination drive.
///
/// Inspects the configured backup path for free space and availability.
#[tauri::command]
pub async fn get_backup_drive_status() -> Result<BackupDriveStatus, String> {
    debug!("get_backup_drive_status");

    // Read the configured backup destination from settings.
    let settings_path = get_settings_file_path();
    let destination = if settings_path.exists() {
        let contents = fs::read_to_string(&settings_path).unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&contents)
            .ok()
            .and_then(|v| v["backup_destination"].as_str().map(|s| s.to_string()))
    } else {
        None
    };

    match destination {
        Some(ref dest) => {
            let path = Path::new(dest);
            if !path.exists() {
                return Ok(BackupDriveStatus {
                    available: false,
                    drive_label: None,
                    free_space_bytes: None,
                    total_space_bytes: None,
                    path: Some(dest.clone()),
                });
            }

            let _metadata = fs::metadata(path).ok();

            // On Windows, try to get volume information for free/total space.
            #[cfg(windows)]
            let (free, total) = get_volume_info(path);

            #[cfg(not(windows))]
            // macOS first-red run 34070052883: this not(windows) branch was
            // never compiled before — it referenced `metadata` while the
            // binding is `_metadata` (the underscore keeps it silent-unused
            // on the Windows path).
            let (free, total) = (_metadata.as_ref().map(|_| 0), _metadata.as_ref().map(|_| 0));

            Ok(BackupDriveStatus {
                available: true,
                drive_label: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string()),
                free_space_bytes: free,
                total_space_bytes: total,
                path: Some(dest.clone()),
            })
        }
        None => Ok(BackupDriveStatus {
            available: false,
            drive_label: None,
            free_space_bytes: None,
            total_space_bytes: None,
            path: None,
        }),
    }
}

/// Open a native folder picker dialog to select the backup destination.
#[tauri::command]
pub async fn select_backup_destination(app: tauri::AppHandle) -> Result<String, String> {
    info!("select_backup_destination (dialog)");

    let (sender, receiver) = tokio::sync::oneshot::channel();

    // Use the Tauri dialog plugin to pick a folder.
    use tauri_plugin_dialog::DialogExt;

    app.dialog()
        .file()
        .set_title("Select Backup Destination")
        .set_can_create_directories(true)
        .pick_folder(|folder_path| {
            let _ = sender.send(folder_path);
        });

    let result = receiver
        .await
        .map_err(|_| "Dialog channel closed".to_string())?;

    match result {
        Some(path) => {
            let path_str = path.to_string();
            info!("Backup destination selected: {}", path_str);
            Ok(path_str)
        }
        None => Err("No folder selected".into()),
    }
}

/// Start a manual backup to the specified destination.
///
/// Returns a backup ID that can be used to track progress.
#[tauri::command]
pub async fn start_manual_backup(
    backup_state: State<'_, BackupState>,
    destination: String,
) -> Result<BackupProgress, String> {
    info!("start_manual_backup: dest={}", destination);

    let client = require_client()?;

    let body = StartBackupBody {
        destination: destination.clone(),
        notes: None,
    };

    let resp: ApiResponse<serde_json::Value> = client
        .post("/api/backup/start", &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let backup_id = data["backup_id"].as_str().unwrap_or("unknown").to_string();

            let progress = BackupProgress {
                backup_id: backup_id.clone(),
                current_step: "initializing".to_string(),
                files_processed: 0,
                total_files: data["total_files"].as_i64().map(|v| v as i32),
                bytes_processed: 0,
                total_bytes: data["total_bytes"].as_i64(),
                percentage: 0.0,
                started_at: chrono::Utc::now(),
                estimated_remaining_seconds: None,
            };

            // Store the current backup ID.
            {
                let mut id_guard = backup_state.current_backup_id.lock().unwrap();
                *id_guard = Some(backup_id.clone());
            }
            {
                let mut map = backup_state.progress_map.lock().unwrap();
                map.insert(backup_id.clone(), progress.clone());
            }

            // Kick off a background task to poll progress.
            let bg_id = backup_id.clone();
            let bg_client = MedivaultApiClient::new(client.base_url().to_string());
            tokio::spawn(async move {
                poll_backup_progress(bg_client, &bg_id).await;
            });

            Ok(progress)
        }
        ApiResponse::Error { error } => Err(format!(
            "Backup start failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get the current progress of an in-progress backup.
#[tauri::command]
pub async fn get_backup_progress(
    backup_id: String,
    backup_state: State<'_, BackupState>,
) -> Result<BackupProgress, String> {
    debug!("get_backup_progress: id={}", backup_id);

    // Check the local cache first.
    {
        let map = backup_state.progress_map.lock().unwrap();
        if let Some(progress) = map.get(&backup_id) {
            return Ok(progress.clone());
        }
    }

    // Fallback: ask the server.
    let client = require_client()?;

    let resp: ApiResponse<BackupProgress> = client
        .get(&format!("/api/backup/{}/progress", backup_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let mut map = backup_state.progress_map.lock().unwrap();
            map.insert(backup_id.clone(), data.clone());
            Ok(data)
        }
        ApiResponse::Error { error } => Err(format!(
            "Progress fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Verify SHA-256 checksums of all files in a completed backup.
#[tauri::command]
pub async fn verify_backup_checksums(backup_id: String) -> Result<Vec<ChecksumResult>, String> {
    info!("verify_backup_checksums: id={}", backup_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<ChecksumResult>> = client
        .post(&format!("/api/backup/{}/verify", backup_id), &())
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Checksum verification failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Preview what a restore would contain (without actually restoring).
#[tauri::command]
pub async fn get_restore_preview(backup_id: String) -> Result<RestorePreview, String> {
    info!("get_restore_preview: id={}", backup_id);

    let client = require_client()?;

    let resp: ApiResponse<RestorePreview> = client
        .get(&format!("/api/backup/{}/restore-preview", backup_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Restore preview failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Execute a restore from a backup, with explicit user confirmation.
#[tauri::command]
pub async fn execute_restore(
    backup_id: String,
    confirmation: String,
) -> Result<RestoreResult, String> {
    info!("execute_restore: id={}", backup_id);

    let client = require_client()?;

    let body = RestoreConfirmBody { confirmation };

    let resp: ApiResponse<RestoreResult> = client
        .post(&format!("/api/backup/{}/restore", backup_id), &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            info!(
                "Restore completed: {} restored, {} failed",
                data.restored_count, data.failed_count
            );
            Ok(data)
        }
        ApiResponse::Error { error } => Err(format!(
            "Restore failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get the history of all backups.
#[tauri::command]
pub async fn get_backup_history() -> Result<Vec<BackupInfo>, String> {
    debug!("get_backup_history");

    let client = require_client()?;

    let resp: ApiResponse<Vec<BackupInfo>> = client
        .get("/api/backup/history")
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Backup history failed: {} — {}",
            error.code, error.message
        )),
    }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/// Poll backup progress from the server in a loop until the backup completes.
async fn poll_backup_progress(client: MedivaultApiClient, backup_id: &str) {
    let mut delay = std::time::Duration::from_secs(2);
    loop {
        tokio::time::sleep(delay).await;

        match client
            .get::<ApiResponse<BackupProgress>>(&format!("/api/backup/{}/progress", backup_id))
            .await
        {
            Ok(ApiResponse::Ok { data }) => {
                if data.current_step == "completed" || data.current_step == "failed" {
                    debug!("Backup {} finished: {}", backup_id, data.current_step);
                    break;
                }
                delay = std::time::Duration::from_secs(3);
            }
            Ok(ApiResponse::Error { error }) => {
                log::warn!("Backup progress error: {}", error.message);
                break;
            }
            Err(e) => {
                log::warn!("Backup progress poll error: {}", e);
                delay = std::time::Duration::from_secs(5);
            }
        }
    }
}

fn require_client() -> Result<MedivaultApiClient, String> {
    let url = credential::read_credential("MediVault/server-url").map_err(|e| e.to_string())?;
    if url.is_empty() {
        return Err("Server URL not configured. Open Settings to connect.".into());
    }
    Ok(MedivaultApiClient::new(url))
}

fn get_settings_file_path() -> PathBuf {
    let app_data = std::env::var("APPDATA")
        .map(|p| PathBuf::from(p).join("MediVault"))
        .unwrap_or_else(|_| PathBuf::from(".").join("MediVault"));
    app_data.join("settings.json")
}

/// Get volume free and total space (Windows implementation).
#[cfg(windows)]
fn get_volume_info(path: &Path) -> (Option<i64>, Option<i64>) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let path_str = path.to_str().unwrap_or("");
    let wide: Vec<u16> = OsStr::new(path_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_available: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;

    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_available,
            &mut total,
            &mut total_free,
        )
    };

    if ok != 0 {
        (Some(free_available as i64), Some(total as i64))
    } else {
        (None, None)
    }
}

#[cfg(not(windows))]
fn get_volume_info(_path: &Path) -> (Option<i64>, Option<i64>) {
    (None, None)
}
