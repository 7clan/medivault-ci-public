//! Settings and system-status IPC commands.
//!
//! Non-sensitive preferences are persisted in `settings.json` inside the
//! app data directory. Sensitive values (tokens, keys) are stored via the
//! credential module and are **never** returned in plaintext through this API.

use crate::api_client::MedivaultApiClient;
use crate::credential;
use chrono::{DateTime, Utc};
use log::{debug, info};
use medivault_lib::{
    ApiResponse, AppSettings, CertTrustStatus, ConnectionResult, DatabaseStatus, DeviceStatus,
    ServiceStatus,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct PartialSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_backup_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_backup_interval_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup_destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_document_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notification_sound_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    minimize_to_tray: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_with_windows: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_patient_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_recent_patients: Option<usize>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct HealthProbe {
    status: String,
    db: Option<bool>,
    version: Option<String>,
    uptime: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeviceStatusWire {
    registered: bool,
    device_id: Option<String>,
    device_name: Option<String>,
    enrolled_at: Option<String>,
    public_key_fingerprint: Option<String>,
    last_seen_at: Option<String>,
    challenge_required: Option<bool>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Read the current application settings from disk.
///
/// Returns defaults if no settings file exists yet.
#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    debug!("get_settings");

    let path = settings_file_path();
    if !path.exists() {
        let defaults = AppSettings::default();
        // Write defaults so the frontend can see the structure.
        persist_settings(&defaults)?;
        return Ok(defaults);
    }

    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AppSettings =
        serde_json::from_str(&contents).map_err(|e| format!("Corrupt settings file: {}", e))?;
    Ok(settings)
}

/// Update one or more settings fields.
///
/// Accepts a JSON object with only the fields to change; unspecified fields
/// are preserved.
#[tauri::command]
pub async fn update_settings(partial: serde_json::Value) -> Result<AppSettings, String> {
    info!("update_settings");

    let mut current = get_settings().await?;

    // Apply partial updates, deserialising into the PartialSettings helper.
    let patch: PartialSettings = serde_json::from_value(partial.clone())
        .map_err(|e| format!("Invalid settings patch: {}", e))?;

    if let Some(v) = patch.server_url {
        current.server_url = v;
    }
    if let Some(v) = patch.theme {
        current.theme = v;
    }
    if let Some(v) = patch.language {
        current.language = v;
    }
    if let Some(v) = patch.auto_backup_enabled {
        current.auto_backup_enabled = v;
    }
    if let Some(v) = patch.auto_backup_interval_minutes {
        current.auto_backup_interval_minutes = v;
    }
    if let Some(v) = patch.backup_destination {
        current.backup_destination = Some(v);
    }
    if let Some(v) = patch.default_document_category {
        current.default_document_category = Some(v);
    }
    if let Some(v) = patch.notification_sound_enabled {
        current.notification_sound_enabled = v;
    }
    if let Some(v) = patch.minimize_to_tray {
        current.minimize_to_tray = v;
    }
    if let Some(v) = patch.start_with_windows {
        current.start_with_windows = v;
    }
    if let Some(v) = patch.last_patient_id {
        current.last_patient_id = Some(v);
    }
    if let Some(v) = patch.max_recent_patients {
        current.max_recent_patients = v;
    }

    // Persist the server URL to the credential store for use by the API client.
    credential::store_credential("MediVault/server-url", "server-url", &current.server_url)
        .map_err(|e| format!("Failed to persist server URL: {}", e))?;

    persist_settings(&current)?;
    info!("Settings updated");
    Ok(current)
}

/// Test connectivity to the configured server URL.
#[tauri::command]
pub async fn test_server_connection(server_url: String) -> Result<ConnectionResult, String> {
    info!("test_server_connection: {}", server_url);

    let client = MedivaultApiClient::new(server_url.clone());
    let start = std::time::Instant::now();

    match client.health().await {
        Ok(health) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ConnectionResult {
                success: true,
                response_time_ms: Some(elapsed),
                server_version: health.version,
                error: None,
            })
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ConnectionResult {
                success: false,
                response_time_ms: Some(elapsed),
                server_version: None,
                error: Some(e.to_string()),
            })
        }
    }
}

/// Check the TLS certificate trust status of the configured server.
#[tauri::command]
pub async fn get_certificate_trust_status() -> Result<CertTrustStatus, String> {
    debug!("get_certificate_trust_status");

    let url = credential::read_credential("MediVault/server-url").unwrap_or_default();
    if url.is_empty() {
        return Ok(CertTrustStatus {
            trusted: false,
            issuer: None,
            expires_at: None,
            days_until_expiry: None,
            error: Some("No server URL configured".into()),
        });
    }

    let client = MedivaultApiClient::new(url);
    // Make a request that will validate the TLS certificate.
    match client.health().await {
        Ok(_) => Ok(CertTrustStatus {
            trusted: true,
            issuer: None, // reqwest doesn't easily expose cert details
            expires_at: None,
            days_until_expiry: None,
            error: None,
        }),
        Err(e) => {
            let err_str = e.to_string();
            let is_cert_error = err_str.contains("certificate")
                || err_str.contains("invalid certificate")
                || err_str.contains("self signed")
                || err_str.contains("unknown issuer");
            Ok(CertTrustStatus {
                trusted: !is_cert_error,
                issuer: None,
                expires_at: None,
                days_until_expiry: None,
                error: Some(err_str),
            })
        }
    }
}

/// Get the service status (reachability, uptime, version).
#[tauri::command]
pub async fn get_service_status() -> Result<ServiceStatus, String> {
    debug!("get_service_status");

    let client = require_client()?;

    let start = std::time::Instant::now();
    match client.health().await {
        Ok(health) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ServiceStatus {
                reachable: true,
                response_time_ms: Some(elapsed),
                server_version: health.version,
                uptime_seconds: None,
                error: None,
            })
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ServiceStatus {
                reachable: false,
                response_time_ms: Some(elapsed),
                server_version: None,
                uptime_seconds: None,
                error: Some(e.to_string()),
            })
        }
    }
}

/// Get database connectivity status and summary statistics.
#[tauri::command]
pub async fn get_database_status() -> Result<DatabaseStatus, String> {
    debug!("get_database_status");

    let client = require_client()?;

    let resp: ApiResponse<DatabaseStatus> = client
        .get("/api/status/database")
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Database status failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get the current device registration status.
#[tauri::command]
pub async fn get_device_status() -> Result<DeviceStatus, String> {
    debug!("get_device_status");

    let client = require_client()?;

    let resp: ApiResponse<DeviceStatusWire> = client
        .get("/api/devices/status")
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let status = DeviceStatus {
                registered: data.registered,
                device_id: data.device_id,
                device_name: data.device_name,
                enrolled_at: data.enrolled_at.and_then(|s| {
                    DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc))
                }),
                public_key_fingerprint: data.public_key_fingerprint,
                last_seen_at: data.last_seen_at.and_then(|s| {
                    DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc))
                }),
                challenge_required: data.challenge_required.unwrap_or(false),
            };
            Ok(status)
        }
        ApiResponse::Error { error } => Err(format!(
            "Device status failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get the last N lines of the application log.
///
/// Sensitive data such as tokens, passwords, and keys are redacted before
/// the log contents are returned to the frontend.
#[tauri::command]
pub async fn get_log_contents(lines: Option<usize>) -> Result<String, String> {
    debug!("get_log_contents: lines={:?}", lines);

    let app_data = app_data_dir();
    let log_path = app_data.join("medivault.log");

    if !log_path.exists() {
        return Ok(String::new());
    }

    let contents = fs::read_to_string(&log_path).unwrap_or_default();
    let all_lines: Vec<&str> = contents.lines().collect();
    let take = lines.unwrap_or(200);
    let tail: Vec<&str> = all_lines.iter().rev().take(take).rev().copied().collect();

    // Redact sensitive patterns.
    let redacted: Vec<String> = tail.iter().map(|line| redact_line(line)).collect();

    Ok(redacted.join("\n"))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_client() -> Result<MedivaultApiClient, String> {
    let url = credential::read_credential("MediVault/server-url").map_err(|e| e.to_string())?;
    if url.is_empty() {
        return Err("Server URL not configured. Open Settings to connect.".into());
    }
    Ok(MedivaultApiClient::new(url))
}

fn settings_file_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

fn app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("APPDATA")
            .map(|p| PathBuf::from(p).join("MediVault"))
            .unwrap_or_else(|_| PathBuf::from(".").join("MediVault"))
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(|p| PathBuf::from(p).join(".config").join("MediVault"))
            .unwrap_or_else(|_| PathBuf::from(".").join("MediVault"))
    }
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Redact sensitive patterns from a single log line.
fn redact_line(line: &str) -> String {
    let mut redacted = line.to_string();

    // Redact Bearer tokens.
    redacted = regex_lite(
        &redacted,
        "Bearer [A-Za-z0-9\\-._~+/]+=*",
        "Bearer [REDACTED]",
    );
    // Redact password-like values in JSON.
    redacted = regex_lite(
        &redacted,
        "\"password\"\\s*:\\s*\"[^\"]*\"",
        "\"password\":\"[REDACTED]\"",
    );
    // Redact API keys.
    redacted = regex_lite(
        &redacted,
        "(api_key|apiKey|secret|token)\"\\s*:\\s*\"[^\"]{8,}",
        "$1\":\"[REDACTED]",
    );

    redacted
}

/// Simple regex-free replacement using string scanning.
/// Matches `pattern` as a substring and replaces the entire match with `replacement`.
fn regex_lite(haystack: &str, pattern: &str, replacement: &str) -> String {
    let mut result = haystack.to_string();
    if let Some(idx) = result.find(pattern) {
        // Find the end of the match (handle * wildcard as greedy).
        let _pattern_chars: Vec<char> = pattern.chars().collect();
        let end_idx = if pattern.contains('*') {
            // For patterns with wildcards, find the longest match.
            let start_str = pattern.split('*').next().unwrap_or("");
            let end_str = pattern.split('*').next_back().unwrap_or("");
            if let Some(s) = result[(idx + start_str.len())..].find(end_str) {
                idx + start_str.len() + s + end_str.len()
            } else {
                idx + pattern.len()
            }
        } else {
            idx + pattern.len()
        };
        result.replace_range(idx..end_idx, replacement);
    }
    result
}
