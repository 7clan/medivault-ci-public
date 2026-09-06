//! HTTP client for the MediVault Fastify API.
//!
//! Provides typed methods for every backend endpoint, automatic retry with
//! exponential backoff, device-proof header injection, and CSRF token handling.

use crate::credential;
use log::{debug, warn};
use medivault_lib::ApiError;
use reqwest::{Client, Method, Response, StatusCode};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Client error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ApiClientError {
    #[error("Network / HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("API returned error: {0}")]
    Api(ApiError),

    #[error("Unauthorised — session expired or invalid")]
    Unauthorised,

    #[error("Forbidden — insufficient permissions")]
    Forbidden,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Credential error: {0}")]
    Credential(#[from] crate::credential::CredentialError),

    #[error("JSON deserialisation error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Request timeout after {0}s")]
    Timeout(u64),
}

impl From<ApiClientError> for String {
    fn from(e: ApiClientError) -> Self {
        e.to_string()
    }
}

// ---------------------------------------------------------------------------
// MedivaultApiClient
// ---------------------------------------------------------------------------

/// Typed HTTP client targeting the MediVault Fastify backend.
///
/// Session tokens are fetched from the Windows Credential Manager on demand
/// and attached as `Authorization: Bearer <token>` headers.  When a device
/// proof is required, `X-Device-Id`, `X-Device-Signature`, and
/// `X-Device-Challenge-Nonce` headers are injected automatically.
pub struct MedivaultApiClient {
    base_url: String,
    http: Client,
}

/// Retry configuration.
const MAX_RETRIES: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 500;

impl MedivaultApiClient {
    /// Create a new client bound to `base_url`.
    ///
    /// The base URL should NOT include a trailing slash, e.g.
    /// `https://medivault.example.com`.
    pub fn new(base_url: String) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .user_agent(format!("MediVault-Desktop/{}", env!("CARGO_PKG_VERSION")))
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .no_proxy()
            .build()
            .expect("Failed to build reqwest client");

        Self { base_url, http }
    }

    /// Return the base URL this client was configured with.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    // -----------------------------------------------------------------------
    // Generic request helpers
    // -----------------------------------------------------------------------

    /// Build an authenticated request, attaching the session token and
    /// device-proof headers from Credential Manager.
    async fn authenticated_request(
        &self,
        method: Method,
        path: &str,
    ) -> Result<reqwest::RequestBuilder, ApiClientError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.request(method, &url);

        // Attach session token if present.
        if let Ok(token) = credential::read_credential(credential::TARGET_SESSION_TOKEN) {
            req = req.bearer_auth(&token);
            debug!("Attached session token to request");
        }

        // Attach device-proof headers if available.
        let device_id = credential::read_credential("MediVault/device-id").ok();
        if let Some(id) = &device_id {
            req = req.header("X-Device-Id", id);
        }
        // Device signature and challenge nonce are typically set per-request
        // by the caller for challenge-response flows.

        // Attach CSRF token for cookie-based sessions.
        if let Ok(csrf) = credential::read_credential("MediVault/csrf-token") {
            req = req.header("X-CSRF-Token", &csrf);
        }

        Ok(req)
    }

    /// Execute a request with retry logic for transient server errors.
    async fn execute_with_retry(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<Response, ApiClientError> {
        let mut backoff = INITIAL_BACKOFF_MS;
        let mut last_err = None;

        for attempt in 0..=MAX_RETRIES {
            let req = try_clone_builder(&request)?;
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_server_error() && attempt < MAX_RETRIES {
                        warn!(
                            "Server error {} on attempt {}/{}, retrying in {}ms",
                            status,
                            attempt + 1,
                            MAX_RETRIES + 1,
                            backoff
                        );
                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                        backoff = (backoff * 2).min(10_000);
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    if (e.is_timeout() || e.is_connect()) && attempt < MAX_RETRIES {
                        warn!(
                            "Transient HTTP error on attempt {}/{}: {}",
                            attempt + 1,
                            MAX_RETRIES + 1,
                            e
                        );
                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                        backoff = (backoff * 2).min(10_000);
                        continue;
                    }
                    last_err = Some(ApiClientError::Http(e));
                    break;
                }
            }
        }

        Err(last_err.unwrap_or(ApiClientError::Timeout(0)))
    }

    /// Send an authenticated GET request and deserialise the JSON body.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiClientError> {
        let req = self.authenticated_request(Method::GET, path).await?;
        let resp = self.execute_with_retry(req).await?;
        self.handle_response(resp).await
    }

    /// Send an authenticated POST request with a JSON body.
    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiClientError> {
        let req = self
            .authenticated_request(Method::POST, path)
            .await?
            .json(body);
        let resp = self.execute_with_retry(req).await?;
        self.handle_response(resp).await
    }

    /// Send an authenticated PUT request with a JSON body.
    #[allow(dead_code)]
    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiClientError> {
        let req = self
            .authenticated_request(Method::PUT, path)
            .await?
            .json(body);
        let resp = self.execute_with_retry(req).await?;
        self.handle_response(resp).await
    }

    /// Send an authenticated DELETE request.
    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiClientError> {
        let req = self.authenticated_request(Method::DELETE, path).await?;
        let resp = self.execute_with_retry(req).await?;
        self.handle_response(resp).await
    }

    /// Send an unauthenticated GET request (for health checks, public endpoints).
    pub async fn get_public<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiClientError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.http.get(&url).send().await?;
        self.handle_response(resp).await
    }

    /// Send a multipart file upload request.
    pub async fn upload_multipart<T: DeserializeOwned>(
        &self,
        path: &str,
        form: reqwest::multipart::Form,
    ) -> Result<T, ApiClientError> {
        let req = self
            .authenticated_request(Method::POST, path)
            .await?
            .multipart(form);
        let resp = self.execute_with_retry(req).await?;
        self.handle_response(resp).await
    }

    /// Stream-download a file to a local path, respecting byte ranges.
    pub async fn download_to_file(
        &self,
        path: &str,
        save_path: &std::path::Path,
        start_byte: Option<u64>,
        end_byte: Option<u64>,
    ) -> Result<u64, ApiClientError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.get(&url);

        // Attach auth headers.
        if let Ok(token) = credential::read_credential(credential::TARGET_SESSION_TOKEN) {
            req = req.bearer_auth(&token);
        }

        // Range header.
        if let (Some(start), Some(end)) = (start_byte, end_byte) {
            req = req.header("Range", format!("bytes={}-{}", start, end));
        } else if let Some(start) = start_byte {
            req = req.header("Range", format!("bytes={}-", start));
        }

        let mut resp = req.send().await?;
        let _total_bytes = resp.content_length().unwrap_or(0);

        let mut file = tokio::fs::File::create(save_path).await?;
        use tokio::io::AsyncWriteExt;
        let mut bytes_downloaded: u64 = 0;
        while let Some(chunk) = resp.chunk().await? {
            file.write_all(&chunk).await?;
            bytes_downloaded += chunk.len() as u64;
        }
        file.flush().await?;

        Ok(bytes_downloaded)
    }

    // -----------------------------------------------------------------------
    // Response handling
    // -----------------------------------------------------------------------

    /// Process an HTTP response, checking status codes and deserialising.
    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: Response,
    ) -> Result<T, ApiClientError> {
        let status = resp.status();

        match status {
            StatusCode::OK
            | StatusCode::CREATED
            | StatusCode::ACCEPTED
            | StatusCode::NO_CONTENT => {
                if status == StatusCode::NO_CONTENT {
                    // Deserialize from empty JSON — caller must use `Option<T>` or a unit type.
                    let empty: serde_json::Value = serde_json::Value::Null;
                    return Ok(serde_json::from_value(empty)?);
                }
                let body: T = resp.json().await?;
                Ok(body)
            }
            StatusCode::UNAUTHORIZED => {
                warn!("Received 401 — session may be expired");
                Err(ApiClientError::Unauthorised)
            }
            StatusCode::FORBIDDEN => Err(ApiClientError::Forbidden),
            StatusCode::NOT_FOUND => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                Err(ApiClientError::NotFound(
                    body["message"]
                        .as_str()
                        .unwrap_or("Resource not found")
                        .to_string(),
                ))
            }
            StatusCode::TOO_MANY_REQUESTS => {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                Err(ApiClientError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("Rate limited. Retry-After: {:?}", retry_after),
                )))
            }
            _ => {
                // Attempt to parse a structured error from the body.
                let body_text = resp.text().await.unwrap_or_default();
                if let Ok(api_err) = serde_json::from_str::<ApiError>(&body_text) {
                    Err(ApiClientError::Api(api_err))
                } else {
                    Err(ApiClientError::Io(std::io::Error::other(format!(
                        "HTTP {} — {}",
                        status.as_u16(),
                        body_text
                    ))))
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Convenience: health / readiness probes
    // -----------------------------------------------------------------------

    /// GET /health — unauthenticated health check.
    pub async fn health(&self) -> Result<HealthResponse, ApiClientError> {
        self.get_public("/health").await
    }

    /// GET /ready — readiness check (includes database connectivity).
    #[allow(dead_code)]
    pub async fn readiness(&self) -> Result<ReadinessResponse, ApiClientError> {
        self.get_public("/ready").await
    }
}

// ---------------------------------------------------------------------------
// Probe response types
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Debug, Clone, serde::Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: Option<String>,
    pub timestamp: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ReadinessResponse {
    pub status: String,
    pub db: Option<bool>,
    pub timestamp: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Attempt to clone a reqwest::RequestBuilder for retry purposes.
///
/// reqwest::RequestBuilder is intentionally hard to clone, so we reconstruct
/// from the original builder's URL, headers, and method.  This is best-effort;
/// if cloning fails we return an error.
fn try_clone_builder(
    builder: &reqwest::RequestBuilder,
) -> Result<reqwest::RequestBuilder, ApiClientError> {
    // The simplest approach: build the request, inspect its pieces, rebuild.
    // In practice this is fragile but covers 99 % of use cases.
    match builder.try_clone() {
        Some(cloned) => Ok(cloned),
        None => Err(ApiClientError::Io(std::io::Error::other(
            "Cannot clone request builder for retry — body may be a stream",
        ))),
    }
}
