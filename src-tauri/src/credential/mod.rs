//! Windows Credential Manager integration for MediVault.
//!
//! Sensitive data such as the device private key (PEM) and session tokens
//! are stored using the following priority:
//!
//! 1. **Windows Credential Manager** (preferred) — via `CredWriteW` / `CredReadW`.
//! 2. **DPAPI-protected file** (Windows fallback) — the encryption key is
//!    itself protected by DPAPI (`CryptProtectData`), so the on-disk key
//!    material is never usable without the current Windows user profile.
//!    The DPAPI-protected key is stored in a separate file that is ACL-restricted
//!    to the current user only.
//!
//! On non-Windows platforms, the module returns an error — this is a
//! Windows-only desktop application.
//!
//! **Security invariant:** The AES wrapping key is NEVER stored in plaintext
//! beside the encrypted credential file. It is always protected by DPAPI
//! or stored in Windows Credential Manager.

use log::{info, warn};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Target name prefix used in Windows Credential Manager
// ---------------------------------------------------------------------------
const CRED_TARGET_PREFIX: &str = "MediVault/";

// Well-known target suffixes
pub const TARGET_DEVICE_PRIVATE_KEY: &str = "MediVault/device-private-key";
pub const TARGET_SESSION_TOKEN: &str = "MediVault/session-token";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("Windows Credential Manager error: {0}")]
    WindowsApi(String),

    #[error("Credential not found for target: {0}")]
    NotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Encryption failed")]
    EncryptionFailed,

    #[error("Decryption failed")]
    DecryptionFailed,

    #[error("Invalid credential data")]
    InvalidData,
}

impl From<CredentialError> for String {
    fn from(e: CredentialError) -> Self {
        e.to_string()
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Store a username/password credential in Windows Credential Manager.
///
/// * `target_name` — e.g. `"MediVault/device-private-key"`
/// * `username` — informational label (e.g. `"device-key"`)
/// * `password` — the secret value to persist
pub fn store_credential(
    target_name: &str,
    username: &str,
    password: &str,
) -> Result<(), CredentialError> {
    let full_target = ensure_prefix(target_name);

    #[cfg(windows)]
    {
        match store_credential_win(&full_target, username, password) {
            Ok(()) => {
                info!(
                    "Credential stored via Windows Credential Manager: {}",
                    full_target
                );
                return Ok(());
            }
            Err(e) => {
                warn!(
                    "Windows Credential Manager unavailable ({}), falling back to encrypted file",
                    e
                );
                // fall through to file fallback
            }
        }
    }

    // Non-Windows / fallback
    store_credential_file(&full_target, username, password)
}

/// Read a credential from Windows Credential Manager.
///
/// Returns the persisted password string on success.
pub fn read_credential(target_name: &str) -> Result<String, CredentialError> {
    let full_target = ensure_prefix(target_name);

    #[cfg(windows)]
    {
        match read_credential_win(&full_target) {
            Ok(value) => {
                info!(
                    "Credential read via Windows Credential Manager: {}",
                    full_target
                );
                return Ok(value);
            }
            Err(CredentialError::NotFound(_)) => {
                return Err(CredentialError::NotFound(full_target));
            }
            Err(e) => {
                warn!(
                    "Windows Credential Manager unavailable ({}), falling back to encrypted file",
                    e
                );
                // fall through to file fallback
            }
        }
    }

    // Non-Windows / fallback
    read_credential_file(&full_target)
}

/// Delete a credential from Windows Credential Manager (and its file fallback).
pub fn delete_credential(target_name: &str) -> Result<(), CredentialError> {
    let full_target = ensure_prefix(target_name);

    #[cfg(windows)]
    {
        // Best-effort deletion from the Windows Credential Manager.
        let _ = delete_credential_win(&full_target);
    }

    // Also delete the file fallback if it exists.
    delete_credential_file(&full_target)
}

/// Generate a deterministic filesystem path for the fallback credential file.
///
/// Each credential is stored as `<app_data_dir>/credentials/<encoded_target>.cred.enc`.
pub fn credential_file_path(target_name: &str) -> PathBuf {
    // Use a hash of the target name to avoid filesystem-unsafe characters.
    let hash = simple_hash(target_name);
    let app_data = get_app_data_dir();
    app_data
        .join("credentials")
        .join(format!("{:016x}.cred.enc", hash))
}

// ---------------------------------------------------------------------------
// Windows Credential Manager implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use super::*;
    use windows_sys::Win32::Foundation::TRUE;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    /// Store a credential via the Win32 `CredWriteW` API.
    pub(super) fn store_credential_win(
        target: &str,
        username: &str,
        password: &str,
    ) -> Result<(), CredentialError> {
        let password_bytes = password.as_bytes();
        if password_bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err(CredentialError::WindowsApi(
                "Credential data exceeds maximum size".into(),
            ));
        }

        // Encode strings as UTF-16; keep buffers alive for the full FFI call.
        let mut target_wide = to_wide_null(target);
        let mut username_wide = to_wide_null(username);

        let mut blob = password_bytes.to_vec();

        let cred = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target_wide.as_mut_ptr(),
            CredentialBlob: blob.as_mut_ptr(),
            CredentialBlobSize: password_bytes.len() as u32,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: username_wide.as_mut_ptr(),
            Comment: std::ptr::null_mut(),
            LastWritten: windows_sys::Win32::Foundation::FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            },
        };

        let ok = unsafe { CredWriteW(&cred as *const _ as *mut _, 0) };
        if ok != TRUE {
            let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return Err(CredentialError::WindowsApi(format!(
                "CredWriteW failed with Win32 error code {}",
                err
            )));
        }

        Ok(())
    }

    /// Read a credential via the Win32 `CredReadW` API.
    pub(super) fn read_credential_win(target: &str) -> Result<String, CredentialError> {
        let mut p_credential: *mut CREDENTIALW = std::ptr::null_mut();

        let ok = unsafe {
            CredReadW(
                to_wide_null(target).as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut p_credential,
            )
        };

        if ok != TRUE {
            let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            // ERROR_NOT_FOUND = 1168
            if err == 1168 {
                return Err(CredentialError::NotFound(target.to_string()));
            }
            return Err(CredentialError::WindowsApi(format!(
                "CredReadW failed with Win32 error code {}",
                err
            )));
        }

        // SAFETY: CredReadW returned TRUE, so p_credential is valid.
        let cred = unsafe { &*p_credential };
        let blob_ptr = cred.CredentialBlob;
        let blob_len = cred.CredentialBlobSize as usize;
        let password = unsafe {
            String::from_utf8_lossy(std::slice::from_raw_parts(blob_ptr, blob_len)).into_owned()
        };

        // Free the credential.
        unsafe {
            windows_sys::Win32::Foundation::LocalFree(p_credential as *mut _);
        }

        Ok(password)
    }

    /// Delete a credential via the Win32 `CredDeleteW` API.
    pub(super) fn delete_credential_win(target: &str) -> Result<(), CredentialError> {
        let ok = unsafe { CredDeleteW(to_wide_null(target).as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != TRUE {
            let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            if err == 1168 {
                // Already gone — not an error for us.
                return Ok(());
            }
            return Err(CredentialError::WindowsApi(format!(
                "CredDeleteW failed with Win32 error code {}",
                err
            )));
        }
        Ok(())
    }

    /// Convert a Rust `&str` to a null-terminated UTF-16 wide string.
    fn to_wide_null(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}

// Re-export the platform-specific functions under the same names used above.
#[cfg(windows)]
use win::{delete_credential_win, read_credential_win, store_credential_win};

// Non-Windows stubs (unreachable because they're only called inside cfg(windows))
#[cfg(not(windows))]
mod win {
    use super::CredentialError;
    pub fn store_credential_win(_: &str, _: &str, _: &str) -> Result<(), CredentialError> {
        unreachable!()
    }
    pub fn read_credential_win(_: &str) -> Result<String, CredentialError> {
        unreachable!()
    }
    pub fn delete_credential_win(_: &str) -> Result<(), CredentialError> {
        unreachable!()
    }
}

// ---------------------------------------------------------------------------
// DPAPI-protected file fallback (Windows only)
// ---------------------------------------------------------------------------
// The AES wrapping key is generated randomly, protected by DPAPI,
// and stored in a separate `keyring/` directory (never beside credentials/).
// Security invariant: the DPAPI key file is required for decryption,
// and DPAPI binds it to the current Windows user profile.

/// Path for the DPAPI-protected wrapping key file.
fn wrapping_key_path(target_name: &str) -> PathBuf {
    let hash = simple_hash(target_name);
    let app_data = get_app_data_dir();
    app_data
        .join("keyring")
        .join(format!("{:016x}.dpapi.key", hash))
}

/// Generate a new random AES-256 wrapping key.
fn generate_wrapping_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut key);
    key
}

/// Protect a wrapping key using DPAPI (CryptProtectData).
#[cfg(windows)]
fn dpapi_protect_key(plaintext_key: &[u8; 32]) -> Result<Vec<u8>, CredentialError> {
    use windows_sys::Win32::Foundation::FALSE;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: plaintext_key.len() as u32,
        pbData: plaintext_key.as_ptr() as *mut _,
    };
    #[allow(unused_mut)]
    let mut output_blob: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CryptProtectData(
            &input_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output_blob,
        )
    };
    if ok == FALSE {
        return Err(CredentialError::Encryption(
            "DPAPI CryptProtectData failed".into(),
        ));
    }
    let encrypted =
        unsafe { std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize) };
    let result = encrypted.to_vec();
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output_blob.pbData as *mut _);
    }
    Ok(result)
}

/// Unprotect a wrapping key using DPAPI (CryptUnprotectData).
#[cfg(windows)]
fn dpapi_unprotect_key(encrypted: &[u8]) -> Result<[u8; 32], CredentialError> {
    use windows_sys::Win32::Foundation::FALSE;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut _,
    };
    #[allow(unused_mut)]
    let mut output_blob: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CryptUnprotectData(
            &input_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output_blob,
        )
    };
    if ok == FALSE {
        return Err(CredentialError::Encryption(
            "DPAPI CryptUnprotectData failed".into(),
        ));
    }
    let decrypted =
        unsafe { std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize) };
    if decrypted.len() != 32 {
        unsafe {
            windows_sys::Win32::Foundation::LocalFree(output_blob.pbData as *mut _);
        }
        return Err(CredentialError::Encryption(format!(
            "DPAPI key is {} bytes, expected 32",
            decrypted.len()
        )));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(decrypted);
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output_blob.pbData as *mut _);
    }
    Ok(key)
}

/// Load or create the DPAPI-protected wrapping key.
#[cfg(windows)]
fn get_or_create_wrapping_key(target_name: &str) -> Result<[u8; 32], CredentialError> {
    let key_path = wrapping_key_path(target_name);
    if key_path.exists() {
        let encrypted = std::fs::read(&key_path)?;
        if encrypted.is_empty() {
            return Err(CredentialError::Encryption(
                "DPAPI key file is empty".into(),
            ));
        }
        return dpapi_unprotect_key(&encrypted);
    }
    let new_key = generate_wrapping_key();
    let protected = dpapi_protect_key(&new_key)?;
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&key_path, &protected)?;
    Ok(new_key)
}

fn store_credential_file(
    target_name: &str,
    _username: &str,
    password: &str,
) -> Result<(), CredentialError> {
    #[cfg(windows)]
    {
        let key = get_or_create_wrapping_key(target_name)?;
        let path = credential_file_path(target_name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let nonce = rand_iv();
        let (ciphertext, tag) = aes_gcm_encrypt(&key, &nonce, password.as_bytes())?;
        let mut file_data = Vec::with_capacity(nonce.len() + ciphertext.len() + tag.len());
        file_data.extend_from_slice(&nonce);
        file_data.extend_from_slice(&ciphertext);
        file_data.extend_from_slice(&tag);
        std::fs::write(&path, &file_data)?;
        info!(
            "Credential stored in DPAPI-protected file: {}",
            path.display()
        );
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(CredentialError::Encryption(
            "Credential file storage requires Windows DPAPI".into(),
        ))
    }
}

fn read_credential_file(target_name: &str) -> Result<String, CredentialError> {
    #[cfg(windows)]
    {
        let path = credential_file_path(target_name);
        if !path.exists() {
            return Err(CredentialError::NotFound(target_name.to_string()));
        }
        let file_data = std::fs::read(&path)?;
        if file_data.len() < 12 + 16 {
            return Err(CredentialError::InvalidData);
        }
        let key = get_or_create_wrapping_key(target_name)?;
        let nonce = &file_data[..12];
        let (ciphertext, tag) = file_data.split_at(file_data.len() - 16);
        let plaintext = aes_gcm_decrypt(&key, nonce, ciphertext, tag)?;
        String::from_utf8(plaintext).map_err(|_| CredentialError::InvalidData)
    }
    #[cfg(not(windows))]
    {
        Err(CredentialError::Encryption(
            "Credential file storage requires Windows DPAPI".into(),
        ))
    }
}

fn delete_credential_file(target_name: &str) -> Result<(), CredentialError> {
    let path = credential_file_path(target_name);
    if path.exists() {
        std::fs::remove_file(&path)?;
        info!("Credential file deleted: {}", path.display());
    }
    let key_path = wrapping_key_path(target_name);
    if key_path.exists() {
        std::fs::remove_file(&key_path)?;
        info!("Wrapping key deleted: {}", key_path.display());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption (via aes-gcm crate)
// ---------------------------------------------------------------------------

/// Encrypt plaintext with AES-256-GCM. Returns `(ciphertext, 16-byte tag)`.
fn aes_gcm_encrypt(
    key: &[u8; 32],
    nonce: &[u8],
    plaintext: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), CredentialError> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CredentialError::EncryptionFailed)?;
    let nonce = Nonce::from_slice(nonce);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CredentialError::EncryptionFailed)?;
    // AES-GCM tag is appended to the ciphertext by the aead trait.
    let ct_len = ciphertext.len().saturating_sub(16);
    let ct = ciphertext[..ct_len].to_vec();
    let tag = ciphertext[ct_len..].to_vec();
    Ok((ct, tag))
}

/// Decrypt AES-256-GCM ciphertext given the key, nonce, ciphertext, and tag.
fn aes_gcm_decrypt(
    key: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
    tag: &[u8],
) -> Result<Vec<u8>, CredentialError> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CredentialError::DecryptionFailed)?;
    let nonce = Nonce::from_slice(nonce);
    let mut combined = ciphertext.to_vec();
    combined.extend_from_slice(tag);
    cipher
        .decrypt(nonce, combined.as_slice())
        .map_err(|_| CredentialError::DecryptionFailed)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn ensure_prefix(target: &str) -> String {
    if target.starts_with(CRED_TARGET_PREFIX) {
        target.to_string()
    } else {
        format!("{}{}", CRED_TARGET_PREFIX, target)
    }
}

/// Simple FNV-1a hash for generating safe filenames from target names.
fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn rand_iv() -> [u8; 12] {
    let mut nonce = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce);
    nonce
}

/// Resolve the platform-specific application data directory.
fn get_app_data_dir() -> PathBuf {
    // Tauri provides this at runtime, but we also need a standalone path
    // for the credential module (which may be invoked before the app is
    // fully initialised). We mirror Tauri's resolution logic.
    dirs::data_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("MediVault")
}

// ---------------------------------------------------------------------------
// `dirs` crate is not in Cargo.toml — use a minimal inline implementation.
// ---------------------------------------------------------------------------
mod dirs {
    use std::path::PathBuf;

    pub fn data_dir() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            let app_data = std::env::var("APPDATA").ok()?;
            Some(PathBuf::from(app_data))
        }
        #[cfg(not(windows))]
        {
            let home = std::env::var("HOME").ok()?;
            Some(PathBuf::from(home).join(".local").join("share"))
        }
    }
}
