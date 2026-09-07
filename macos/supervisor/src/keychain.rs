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
//! CI harness seeding (reinstall/26-smoke stages): when an optional
//! `MV_KEYCHAIN_SEED_<ACCOUNT>` env var is set, `bootstrap-secrets` CREATES
//! the (still absent) item with that value instead of a generated one, so
//! hosted CI can prove end-to-end flows that need the SAME credentials in
//! the keychain AND in the harness (e.g. the reinstall sentinel SQL).
//! Seeded values must match the generated-value SHAPE for the account
//! (fail closed otherwise — the API requires the 64-hex master-key shape);
//! a doctor machine never sets these vars, so production behavior is
//! byte-identical (random generation).
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

/// Optional CI-harness seed env var for an account (name only — never the
/// value). None for unknown accounts (generate_for already fails those).
fn seed_env_name(account: &str) -> Option<&'static str> {
    match account {
        ACCOUNT_PG_APP_PASSWORD => Some("MV_KEYCHAIN_SEED_PG_APP_PASSWORD"),
        ACCOUNT_PG_BOOTSTRAP => Some("MV_KEYCHAIN_SEED_PG_BOOTSTRAP"),
        ACCOUNT_MASTER_KEY => Some("MV_KEYCHAIN_SEED_MASTER_KEY"),
        ACCOUNT_JWT_SECRET => Some("MV_KEYCHAIN_SEED_JWT_SECRET"),
        ACCOUNT_CSRF_SECRET => Some("MV_KEYCHAIN_SEED_CSRF_SECRET"),
        _ => None,
    }
}

/// Validate a seeded value against the account's value SHAPE (same shapes
/// as `generate_for` — the API depends on the 64-hex master key; PG
/// passwords must be URL/shell-safe). Account name only in errors.
fn seed_value_valid(account: &str, value: &str) -> bool {
    let hex = |v: &str| !v.is_empty() && v.chars().all(|c| c.is_ascii_hexdigit());
    match account {
        ACCOUNT_PG_APP_PASSWORD | ACCOUNT_PG_BOOTSTRAP => {
            value.len() == 24 && hex(value)
        }
        ACCOUNT_MASTER_KEY | ACCOUNT_JWT_SECRET | ACCOUNT_CSRF_SECRET => {
            value.len() == 64 && hex(value)
        }
        _ => false,
    }
}

pub enum BootstrapOutcome {
    Created,
    AlreadyPresent,
}

/// Create the item if (and only if) absent; never overwrite. When the
/// CI-harness seed env var is set (and the item is absent), the item is
/// created with the seeded value — shape-validated, never logged.
pub fn bootstrap_item(account: &str) -> Result<BootstrapOutcome, String> {
    if read_item(account)?.is_some() {
        return Ok(BootstrapOutcome::AlreadyPresent);
    }
    let value = match seed_env_name(account).and_then(|n| std::env::var(n).ok()) {
        Some(v) => {
            if !seed_value_valid(account, &v) {
                return Err(format!(
                    "keychain seed for account '{account}' has the wrong value shape \
                     (expected the generated-value shape for this account)"
                ));
            }
            v
        }
        None => generate_for(account)?,
    };
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
