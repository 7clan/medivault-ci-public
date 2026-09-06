//! Device enrollment and management IPC commands.
//!
//! Implements the device enrollment flow:
//! 1. Generate an RSA keypair (public key sent to server, private key stored
//!    in Windows Credential Manager).
//! 2. Enroll using a pairing code.
//! 3. Respond to server-issued cryptographic challenges using the stored
//!    private key (proof-of-possession).

use crate::api_client::MedivaultApiClient;
use crate::credential;
use chrono::{DateTime, Utc};
use log::{debug, info};
use medivault_lib::{ApiResponse, DeviceEnrollmentResponse, DeviceKeyPair, DeviceStatus};
use rsa::pkcs8::{DecodePrivateKey, EncodePublicKey, LineEnding};
use rsa::{pkcs8::EncodePrivateKey, RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct EnrollmentResult {
    device_id: String,
    device_name: String,
    enrolled_at: String,
    public_key_fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RevokeResult {
    revoked: bool,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct ChallengeProofBody {
    challenge_id: String,
    signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceListEntry {
    id: String,
    name: String,
    enrolled_at: Option<String>,
    last_seen_at: Option<String>,
    is_current: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct EnrollmentBody {
    pairing_code: String,
    device_name: String,
    public_key: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Generate a new RSA-2048 device keypair.
///
/// The public key PEM is returned to the caller (for display / verification).
/// The private key is stored in Windows Credential Manager and is **never**
/// exposed through this interface.
#[tauri::command]
pub async fn generate_device_keypair() -> Result<DeviceKeyPair, String> {
    info!("generate_device_keypair");

    let mut rng = rand::rngs::OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| format!("RSA key generation failed: {}", e))?;
    let public_key = RsaPublicKey::from(&private_key);

    // Serialize public key to PEM.
    let public_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;

    // Serialize private key to PEM.
    let private_pem = private_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();

    // Compute SHA-256 fingerprint of the public key.
    let fingerprint = sha256_hex(public_pem.as_bytes());

    // Store the private key in Credential Manager.
    credential::store_credential(
        credential::TARGET_DEVICE_PRIVATE_KEY,
        "device-key",
        &private_pem,
    )
    .map_err(|e| format!("Failed to store private key: {}", e))?;

    // Generate a local device ID for tracking.
    let device_id = uuid::Uuid::new_v4().to_string();

    credential::store_credential("MediVault/device-id", "device-id", &device_id)
        .map_err(|e| format!("Failed to store device ID: {}", e))?;

    info!(
        "Device keypair generated: id={}, fingerprint={}",
        device_id, fingerprint
    );

    Ok(DeviceKeyPair {
        device_id,
        public_key_pem: public_pem,
        private_key_stored: true,
        public_key_fingerprint: fingerprint,
    })
}

/// Enroll this device with the server using a pairing code.
///
/// Sends the public key to the server for storage; the private key remains
/// local in the Credential Manager.
#[tauri::command]
pub async fn enroll_device(
    pairing_code: String,
    device_name: String,
) -> Result<DeviceEnrollmentResponse, String> {
    info!("enroll_device: name={}", device_name);

    let client = require_client()?;

    // Read the stored public key.
    let private_pem = credential::read_credential(credential::TARGET_DEVICE_PRIVATE_KEY)
        .map_err(|e| format!("No device key found. Generate one first: {}", e))?;

    // Reconstruct the public key from the private key for sending.
    let private_key = load_private_key(&private_pem)?;
    let public_key = RsaPublicKey::from(&private_key);
    let public_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;

    let body = EnrollmentBody {
        pairing_code,
        device_name: device_name.clone(),
        public_key: public_pem,
    };

    let resp: ApiResponse<EnrollmentResult> = client
        .post("/api/devices/enroll", &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            // Store the server-assigned device ID.
            credential::store_credential("MediVault/device-id", "device-id", &data.device_id)
                .map_err(|e| e.to_string())?;

            info!("Device enrolled: id={}", data.device_id);

            let enrolled_at = DateTime::parse_from_rfc3339(&data.enrolled_at)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            Ok(DeviceEnrollmentResponse {
                device_id: data.device_id,
                device_name,
                enrolled_at,
                public_key_fingerprint: data.public_key_fingerprint,
            })
        }
        ApiResponse::Error { error } => Err(format!(
            "Enrollment failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get the current device's registration status from the server.
#[tauri::command]
pub async fn get_device_registration_status() -> Result<DeviceStatus, String> {
    debug!("get_device_registration_status");

    let client = require_client()?;

    let device_id = credential::read_credential("MediVault/device-id").unwrap_or_default();

    let resp: ApiResponse<serde_json::Value> = client
        .get(&format!("/api/devices/{}", device_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let status = DeviceStatus {
                registered: data["registered"].as_bool().unwrap_or(false),
                device_id: data["device_id"].as_str().map(|s| s.to_string()),
                device_name: data["device_name"].as_str().map(|s| s.to_string()),
                enrolled_at: data["enrolled_at"]
                    .as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&Utc)),
                public_key_fingerprint: data["public_key_fingerprint"]
                    .as_str()
                    .map(|s| s.to_string()),
                last_seen_at: data["last_seen_at"]
                    .as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&Utc)),
                challenge_required: data["challenge_required"].as_bool().unwrap_or(false),
            };
            Ok(status)
        }
        ApiResponse::Error { error } => Err(format!(
            "Device status failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Revoke a device's registration on the server.
///
/// If revoking the current device, local credentials are also purged.
#[tauri::command]
pub async fn revoke_device(device_id: String) -> Result<bool, String> {
    info!("revoke_device: id={}", device_id);

    let client = require_client()?;

    let resp: ApiResponse<RevokeResult> = client
        .delete(&format!("/api/devices/{}", device_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            // If this is the current device, purge local credentials.
            let local_id = credential::read_credential("MediVault/device-id").unwrap_or_default();
            if local_id == device_id {
                let _ = credential::delete_credential(credential::TARGET_DEVICE_PRIVATE_KEY);
                let _ = credential::delete_credential("MediVault/device-id");
                info!("Revoked and purged local device credentials");
            }
            Ok(data.revoked)
        }
        ApiResponse::Error { error } => {
            Err(format!("Revoke failed: {} — {}", error.code, error.message))
        }
    }
}

/// Sign a challenge nonce using the stored device private key.
///
/// The server sends a challenge to verify device possession of the private key
/// that matches the registered public key.
#[tauri::command]
pub async fn sign_challenge(challenge_nonce: String) -> Result<String, String> {
    info!("sign_challenge (nonce redacted)");

    let private_pem = credential::read_credential(credential::TARGET_DEVICE_PRIVATE_KEY)
        .map_err(|e| format!("No device private key found: {}", e))?;

    let private_key = load_private_key(&private_pem)?;

    // Sign the nonce using RSASSA-PKCS1-v1_5 with SHA-256.
    use rsa::pkcs1v15::SigningKey;
    use rsa::signature::{SignatureEncoding, Signer};
    let signing_key = SigningKey::<sha2::Sha256>::new(private_key);
    let signature = signing_key.sign(challenge_nonce.as_bytes());
    let sig_bytes = signature.to_bytes();
    let sig_base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, sig_bytes);

    debug!("Challenge signed ({} bytes base64)", sig_base64.len());
    Ok(sig_base64)
}

/// List all devices registered for the current user.
#[tauri::command]
pub async fn list_devices() -> Result<Vec<DeviceListEntry>, String> {
    debug!("list_devices");

    let client = require_client()?;

    let resp: ApiResponse<Vec<DeviceListEntry>> = client
        .get("/api/devices")
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Device list failed: {} — {}",
            error.code, error.message
        )),
    }
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

/// Parse a PEM-encoded private key (PKCS#8 format).
fn load_private_key(pem: &str) -> Result<RsaPrivateKey, String> {
    RsaPrivateKey::from_pkcs8_pem(pem)
        .map_err(|e| format!("Failed to parse RSA private key: {}", e))
}

/// Compute SHA-256 hex digest of input bytes.
fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
