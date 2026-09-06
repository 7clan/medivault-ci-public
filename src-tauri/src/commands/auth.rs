//! Authentication IPC commands.
//!
//! Handles login, logout, session refresh, password changes, and force-password
//! change detection. All sensitive tokens are persisted in Windows Credential
//! Manager via the `credential` module. Supports both browser-cookie and
//! mobile-token (Bearer) authentication flows.

use crate::api_client::{ApiClientError, MedivaultApiClient};
use crate::credential;
use log::info;
use medivault_lib::{ApiResponse, LoginResponse};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// Shared application state accessible to all commands.
/// Holds the lazily-initialised API client and settings.
pub struct AppState {
    pub api_client: Mutex<Option<MedivaultApiClient>>,
    pub server_url: Mutex<String>,
}

// ---------------------------------------------------------------------------
// Internal request/response types (wire format from Fastify API)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct LoginApiOk {
    session_id: String,
    user_id: String,
    email: String,
    role: String,
    force_password_change: bool,
    csrf_token: Option<String>,
    expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshResponse {
    session_id: String,
    expires_at: String,
    csrf_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChangePasswordBody {
    current_password: String,
    new_password: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ForcePasswordResponse {
    force_password_change: bool,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Authenticate against the Fastify API and store session tokens
/// in Windows Credential Manager.
///
/// Supports two flows:
/// 1. **Mobile-token**: the API returns `session_id` as a Bearer token.
/// 2. **Browser-cookie**: the API sets cookies; a `csrf_token` is returned
///    for subsequent state-changing requests.
#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    email: String,
    password: String,
    server_url: Option<String>,
) -> Result<LoginResponse, String> {
    info!("login requested for {}", email);

    let url = server_url.unwrap_or_else(|| {
        let guard = state.server_url.lock().unwrap();
        guard.clone()
    });

    if url.is_empty() {
        return Err("Server URL is not configured. Please set it in Settings first.".into());
    }

    let client = MedivaultApiClient::new(url.clone());

    let body = LoginBody { email, password };

    // Use a raw POST here because we need to inspect the response headers
    // for Set-Cookie and process the session token before storing it.
    let full_url = format!("{}/api/auth/login", client.base_url());
    let http_res = client::raw_login_post(&client, &full_url, &body)
        .await
        .map_err(|e| e.to_string())?;

    let status = http_res.status();
    if !status.is_success() {
        let body_text = http_res.text().await.unwrap_or_default();
        return Err(format!(
            "Login failed (HTTP {}): {}",
            status.as_u16(),
            body_text
        ));
    }

    // Try to extract cookies from the response (for browser-cookie flow).
    // reqwest handles Set-Cookie automatically if cookie store is enabled,
    // but we read them explicitly here for session storage.
    let cookies: Vec<String> = http_res
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
        .collect();

    let api_result: ApiResponse<LoginApiOk> = http_res
        .json()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;

    let login_data = match api_result {
        ApiResponse::Ok { data } => data,
        ApiResponse::Error { error } => {
            return Err(format!("API error: {} — {}", error.code, error.message));
        }
    };

    // Parse the ISO-8601 timestamp.
    let expires_at = chrono::DateTime::parse_from_rfc3339(&login_data.expires_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now() + chrono::Duration::hours(8));

    let response = LoginResponse {
        session_id: login_data.session_id.clone(),
        user_id: login_data.user_id.clone(),
        email: login_data.email.clone(),
        role: login_data.role.clone(),
        force_password_change: login_data.force_password_change,
        csrf_token: login_data.csrf_token.clone(),
        expires_at,
    };

    // ── Store credentials securely ──────────────────────────────────────

    // Store the session token (Bearer token for mobile-token flow).
    credential::store_credential(
        credential::TARGET_SESSION_TOKEN,
        &format!("session/{}", login_data.session_id),
        &login_data.session_id,
    )
    .map_err(|e| format!("Failed to store session token: {}", e))?;

    // Store CSRF token if present (browser-cookie flow).
    if let Some(ref csrf) = login_data.csrf_token {
        credential::store_credential("MediVault/csrf-token", "csrf", csrf)
            .map_err(|e| format!("Failed to store CSRF token: {}", e))?;
    }

    // Store cookies if present.
    if !cookies.is_empty() {
        let cookie_blob = cookies.join("; ");
        credential::store_credential("MediVault/session-cookies", "cookies", &cookie_blob)
            .map_err(|e| format!("Failed to store cookies: {}", e))?;
    }

    // Store user metadata for quick access.
    credential::store_credential("MediVault/user-id", "user-id", &login_data.user_id).ok(); // best-effort

    // Persist the server URL.
    {
        let mut guard = state.server_url.lock().unwrap();
        *guard = url;
    }

    // Cache the API client.
    {
        let mut guard = state.api_client.lock().unwrap();
        let cached = MedivaultApiClient::new(state.server_url.lock().unwrap().clone());
        *guard = Some(cached);
    }

    info!("Login successful for session {}", login_data.session_id);
    Ok(response)
}

/// Terminate the current session on the server and purge all stored credentials.
#[tauri::command]
pub async fn logout(session_id: String) -> Result<(), String> {
    info!("logout requested for session {}", session_id);

    // Best-effort server-side logout.
    let client = match get_api_client_from_creds() {
        Ok(Some(c)) => Some(c),
        Ok(None) => None,
        Err(e) => {
            log::warn!("Cannot build client for logout: {}", e);
            None
        }
    };

    if let Some(client) = client {
        let _: Result<serde_json::Value, _> = client
            .post(
                "/api/auth/logout",
                &serde_json::json!({
                    "session_id": &session_id
                }),
            )
            .await;
    }

    // Purge all stored credentials.
    let targets_to_delete = [
        credential::TARGET_SESSION_TOKEN.to_string(),
        "MediVault/csrf-token".into(),
        "MediVault/session-cookies".into(),
        "MediVault/user-id".into(),
        "MediVault/device-id".into(),
    ];
    for target in &targets_to_delete {
        let _ = credential::delete_credential(target);
    }

    info!("Session {} logged out, credentials purged", session_id);
    Ok(())
}

/// Refresh the current session to obtain new tokens.
#[tauri::command]
pub async fn refresh_session(session_id: String) -> Result<RefreshResponse, String> {
    info!("refresh_session requested for {}", session_id);

    let client = get_api_client_from_creds()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No server URL configured".to_string())?;

    let resp: ApiResponse<RefreshResponse> = client
        .post(
            "/api/auth/refresh",
            &serde_json::json!({ "session_id": session_id }),
        )
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            // Update stored token.
            credential::store_credential(
                credential::TARGET_SESSION_TOKEN,
                &format!("session/{}", data.session_id),
                &data.session_id,
            )
            .ok();
            if let Some(ref csrf) = data.csrf_token {
                credential::store_credential("MediVault/csrf-token", "csrf", csrf).ok();
            }
            Ok(data)
        }
        ApiResponse::Error { error } => Err(format!(
            "Refresh failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Change the current user's password.
#[tauri::command]
pub async fn change_password(
    session_id: String,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    info!("change_password requested for session {}", session_id);

    let client = get_api_client_from_creds()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No server URL configured".to_string())?;

    let body = ChangePasswordBody {
        current_password,
        new_password,
    };

    let resp: ApiResponse<serde_json::Value> = client
        .post("/api/auth/change-password", &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { .. } => Ok(()),
        ApiResponse::Error { error } => Err(format!(
            "Password change failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Query whether the current user must change their password before
/// continuing to use the application.
#[tauri::command]
pub async fn get_force_password_change_status(session_id: String) -> Result<bool, String> {
    info!(
        "get_force_password_change_status for session {}",
        session_id
    );

    let client = get_api_client_from_creds()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No server URL configured".to_string())?;

    let resp: ApiResponse<ForcePasswordResponse> = client
        .get(&format!("/api/auth/force-password-change/{}", session_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data.force_password_change),
        ApiResponse::Error { error } => Err(format!(
            "Failed to check force-password-change: {} — {}",
            error.code, error.message
        )),
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Build an API client from stored credentials (server URL + token).
fn get_api_client_from_creds() -> Result<Option<MedivaultApiClient>, ApiClientError> {
    // Try reading the server URL from the credential store (stored as "settings" fallback).
    // The primary source is AppState but commands may not always have access to it.
    let url = credential::read_credential("MediVault/server-url").unwrap_or_default();
    if url.is_empty() {
        return Ok(None);
    }
    Ok(Some(MedivaultApiClient::new(url)))
}

/// Sub-module with the raw login POST that reads cookies from headers.
mod client {
    use super::LoginBody;
    use crate::api_client::MedivaultApiClient;
    use reqwest::Response;

    pub async fn raw_login_post(
        api_client: &MedivaultApiClient,
        url: &str,
        body: &LoginBody,
    ) -> Result<Response, Box<dyn std::error::Error>> {
        // Build a basic POST with JSON body. We don't clone the full internal builder
        // here — instead we create a new request directly.
        let mut req = build_req(api_client, url, body)?;

        // Attach CSRF token if available.
        if let Ok(csrf) = crate::credential::read_credential("MediVault/csrf-token") {
            req = req.header("X-CSRF-Token", &csrf);
        }

        Ok(req.send().await?)
    }

    /// Use a technique that accesses the client's internals to build the request.
    /// For simplicity we just create a standalone reqwest call.
    fn build_req(
        _client: &MedivaultApiClient,
        url: &str,
        body: &LoginBody,
    ) -> Result<reqwest::RequestBuilder, Box<dyn std::error::Error>> {
        // We have to go through the unauthenticated path for login since there's no token yet.
        // The client's internal HTTP client is not directly accessible, so we use get_public
        // pattern — build a manual request.
        use reqwest::Client;
        let http = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(format!("MediVault-Desktop/{}", env!("CARGO_PKG_VERSION")))
            .no_proxy()
            .build()?;
        let req = http.post(url).json(body);
        Ok(req)
    }
}
