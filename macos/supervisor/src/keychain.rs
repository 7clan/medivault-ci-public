//! Keychain secret store — the production `secrets.source: "keychain"`.
//!
//! Contract (architecture audit, KEYCHAIN PLAN):
//!   - generic-password items under service `dev.medivault`;
//!   - accounts: `pg-app-password`, `pg-bootstrap` (superuser),
//!     `master-key`, `jwt-secret`, `csrf-secret`;
//!   - first-run creation is EXPLICIT (`bootstrap-secrets` subcommand /
//!     desktop first-run setup) — `run` never auto-creates items (a new
//!     master key after accidental deletion would silently orphan every
//!     encrypted object; missing items fail closed instead);
//!   - bootstrap NEVER overwrites an existing item;
//!   - values are never logged.
//!
//! macOS-only: compiled out elsewhere (the seam reports "requires macOS").

#![cfg(target_os = "macos")]

use security_framework::passwords::{get_generic_password, set_generic_password};

pub const SERVICE: &str = "dev.medivault";
pub const ACCOUNT_PG_APP_PASSWORD: &str = "pg-app-password";
pub const ACCOUNT_PG_BOOTSTRAP: &str = "pg-bootstrap";
pub const ACCOUNT_MASTER_KEY: &str = "master-key";
pub const ACCOUNT_JWT_SECRET: &str = "jwt-secret";
pub const ACCOUNT_CSRF_SECRET: &str = "csrf-secret";

/// errSecItemNotFound — the only "absent" signal we treat specially.
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// Read one item. `Ok(None)` = not present; `Err` = anything else.
pub fn read_item(account: &str) -> Result<Option<String>, String> {
    match get_generic_password(SERVICE, account) {
        Ok(bytes) => Ok(Some(String::from_utf8(bytes).map_err(|e| {
            format!("keychain item '{account}' is not valid UTF-8: {e}")
        })?)),
        Err(e) => {
            if e.code() == ERR_SEC_ITEM_NOT_FOUND {
                Ok(None)
            } else {
                Err(format!("cannot read keychain item '{account}': {e}"))
            }
        }
    }
}

fn write_item(account: &str, value: &str) -> Result<(), String> {
    set_generic_password(SERVICE, account, value.as_bytes())
        .map_err(|e| format!("cannot write keychain item '{account}': {e}"))
}

/// Cryptographically random hex (bytes from /dev/urandom).
fn random_hex(n_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let mut buf = vec![0u8; n_bytes];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| format!("cannot read /dev/urandom: {e}"))?;
    let mut out = String::with_capacity(n_bytes * 2);
    for b in buf {
        out.push_str(&format!("{b:02x}"));
    }
    Ok(out)
}

/// Shape of each item's generated value.
fn generate_for(account: &str) -> Result<String, String> {
    match account {
        // 24 hex chars = 96 bits — passwords (URL-safe, shell-safe).
        ACCOUNT_PG_APP_PASSWORD | ACCOUNT_PG_BOOTSTRAP => random_hex(12),
        // 64 hex chars = 256 bits (master key matches the 32-byte hex
        // contract; jwt/csrf secrets get the same strength).
        ACCOUNT_MASTER_KEY | ACCOUNT_JWT_SECRET | ACCOUNT_CSRF_SECRET => random_hex(32),
        _ => return Err(format!("unknown account: {account}")),
    }
}

pub enum BootstrapOutcome {
    Created,
    AlreadyPresent,
}

/// Create the item if (and only if) absent; never overwrite.
pub fn bootstrap_item(account: &str) -> Result<BootstrapOutcome, String> {
    if read_item(account)?.is_some() {
        return Ok(BootstrapOutcome::AlreadyPresent);
    }
    let value = generate_for(account)?;
    write_item(account, &value)?;
    Ok(BootstrapOutcome::Created)
}

/// The full item list (bootstrap order = account contract order).
pub const ALL_ACCOUNTS: &[&str] = &[
    ACCOUNT_PG_APP_PASSWORD,
    ACCOUNT_PG_BOOTSTRAP,
    ACCOUNT_MASTER_KEY,
    ACCOUNT_JWT_SECRET,
    ACCOUNT_CSRF_SECRET,
];
