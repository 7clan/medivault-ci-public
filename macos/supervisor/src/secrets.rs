//! SecretsProvider — the seam between the supervisor and wherever long-lived
//! secrets live.
//!
//! Stage contract (architecture audit / pivot directive):
//!   - the supervisor reads secrets ONCE at startup and injects them into
//!     child environments only (Node API child AND the provisioner child);
//!   - the Node processes never touch the secret store (avoids Keychain ACL
//!     prompts entirely);
//!   - secret VALUES are never written to logs, status files, or argv.
//!
//! Sources:
//!   - `env` — CI + first stages (values from the environment).
//!   - `keychain` — production (macOS): generic-password items under
//!     service `dev.medivault` (see keychain.rs). Fails closed listing
//!     the missing ACCOUNT NAMES.

use crate::config::Resolved;

/// Required environment variables (names only — values never logged).
pub const ENV_PG_APP_PASSWORD: &str = "MV_PG_APP_PASSWORD";
pub const ENV_PG_SUPER_PASSWORD: &str = "MV_PG_SUPER_PASSWORD";
pub const ENV_JWT_SECRET: &str = "MV_AUTH_JWT_SECRET";
pub const ENV_MASTER_KEY: &str = "MV_MEDIVAULT_MASTER_KEY";

#[derive(Debug)]
pub struct Secrets {
    /// PostgreSQL application-role password (SCRAM).
    pub pg_app_password: String,
    /// PostgreSQL superuser (bootstrap) password — required only when the
    /// provisioner needs to create the role/database (CLEAN / recovery).
    pub pg_super_password: Option<String>,
    /// API `AUTH_JWT_SECRET`.
    pub jwt_secret: String,
    /// API `MEDIVAULT_MASTER_KEY` (hex key for the encrypted object store).
    pub master_key: String,
}

impl Secrets {
    /// Load via the configured source. Fails closed, listing variable /
    /// account NAMES only (never values).
    pub fn load(resolved: &Resolved) -> Result<Secrets, String> {
        match resolved.secrets_source.as_str() {
            "env" => Self::from_env(),
            "keychain" => Self::from_keychain(),
            other => Err(format!("unknown secrets source: {other}")),
        }
    }

    fn from_env() -> Result<Secrets, String> {
        let mut missing: Vec<&str> = Vec::new();
        let pg = std::env::var(ENV_PG_APP_PASSWORD).unwrap_or_default();
        let super_pw = std::env::var(ENV_PG_SUPER_PASSWORD).unwrap_or_default();
        let jwt = std::env::var(ENV_JWT_SECRET).unwrap_or_default();
        let master = std::env::var(ENV_MASTER_KEY).unwrap_or_default();
        if pg.is_empty() {
            missing.push(ENV_PG_APP_PASSWORD);
        }
        if jwt.is_empty() {
            missing.push(ENV_JWT_SECRET);
        }
        if master.is_empty() {
            missing.push(ENV_MASTER_KEY);
        }
        if !missing.is_empty() {
            return Err(format!(
                "missing required secret environment variables: {}",
                missing.join(", ")
            ));
        }
        Ok(Secrets {
            pg_app_password: pg,
            pg_super_password: if super_pw.is_empty() {
                None
            } else {
                Some(super_pw)
            },
            jwt_secret: jwt,
            master_key: master,
        })
    }

    #[cfg(target_os = "macos")]
    fn from_keychain() -> Result<Secrets, String> {
        let mut missing: Vec<&str> = Vec::new();
        let pg = crate::keychain::read_item(crate::keychain::ACCOUNT_PG_APP_PASSWORD)?;
        let bootstrap = crate::keychain::read_item(crate::keychain::ACCOUNT_PG_BOOTSTRAP)?;
        let jwt = crate::keychain::read_item(crate::keychain::ACCOUNT_JWT_SECRET)?;
        let master = crate::keychain::read_item(crate::keychain::ACCOUNT_MASTER_KEY)?;
        if pg.is_none() {
            missing.push(crate::keychain::ACCOUNT_PG_APP_PASSWORD);
        }
        if jwt.is_none() {
            missing.push(crate::keychain::ACCOUNT_JWT_SECRET);
        }
        if master.is_none() {
            missing.push(crate::keychain::ACCOUNT_MASTER_KEY);
        }
        if !missing.is_empty() {
            return Err(format!(
                "missing keychain items (service '{}') — run 'mediavault-supervisor bootstrap-secrets' \
                 or the desktop first-run setup: {}",
                crate::keychain::SERVICE,
                missing.join(", ")
            ));
        }
        Ok(Secrets {
            pg_app_password: pg.expect("checked"),
            pg_super_password: bootstrap, // optional at load; required by provisioning
            jwt_secret: jwt.expect("checked"),
            master_key: master.expect("checked"),
        })
    }

    #[cfg(not(target_os = "macos"))]
    fn from_keychain() -> Result<Secrets, String> {
        Err(
            "secrets.source \"keychain\" requires macOS (this build targets another OS)"
                .to_string(),
        )
    }
}

/// Percent-encode the password fragment of a PostgreSQL connection URL.
/// Everything outside the unreserved set is escaped — always safe, and the
/// frozen CI password (`!`) round-trips exactly.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Build the API child's `DATABASE_URL`.
pub fn database_url(resolved: &Resolved, secrets: &Secrets) -> String {
    format!(
        "postgresql://{}:{}@{}:{}/{}",
        resolved.pg_app_user,
        percent_encode(&secrets.pg_app_password),
        resolved.pg_host,
        resolved.pg_port,
        resolved.pg_app_database
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encodes_specials() {
        assert_eq!(percent_encode("abcXYZ018._~-"), "abcXYZ018._~-");
        assert_eq!(
            percent_encode("MedivaultMacCI2026!"),
            "MedivaultMacCI2026%21"
        );
        assert_eq!(percent_encode("p@ss:w/ x"), "p%40ss%3Aw%2F%20x");
    }
}
