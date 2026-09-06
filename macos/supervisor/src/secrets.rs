//! SecretsProvider — the seam between the supervisor and wherever long-lived
//! secrets live.
//!
//! Stage contract (architecture audit / pivot directive):
//!   - the supervisor reads secrets ONCE at startup and injects them into
//!     the Node child's environment only;
//!   - the Node process never touches the secret store (avoids Keychain ACL
//!     prompts in the API process entirely);
//!   - secret VALUES are never written to logs, status files, or argv.
//!
//! `Env` is the CI/first-stage source (values supplied by the environment).
//! `Keychain` is reserved for the Keychain/provisioning stage: it exists as
//! an explicit fail-closed branch so a production config cannot silently
//! fall back to env vars.

use crate::config::Resolved;

/// Required environment variables (names only — values never logged).
pub const ENV_PG_APP_PASSWORD: &str = "MV_PG_APP_PASSWORD";
pub const ENV_JWT_SECRET: &str = "MV_AUTH_JWT_SECRET";
pub const ENV_MASTER_KEY: &str = "MV_MEDIVAULT_MASTER_KEY";

#[derive(Debug)]
pub struct Secrets {
    /// PostgreSQL application-role password (SCRAM).
    pub pg_app_password: String,
    /// API `AUTH_JWT_SECRET`.
    pub jwt_secret: String,
    /// API `MEDIVAULT_MASTER_KEY` (hex key for the encrypted object store).
    pub master_key: String,
}

impl Secrets {
    /// Load via the configured source. Fails closed, listing variable
    /// NAMES only (never values).
    pub fn load(resolved: &Resolved) -> Result<Secrets, String> {
        match resolved.secrets_source.as_str() {
            "env" => Self::from_env(),
            "keychain" => Err(
                "keychain secret source is not wired yet (Keychain/provisioning stage); \
                 use \"env\""
                    .to_string(),
            ),
            other => Err(format!("unknown secrets source: {other}")),
        }
    }

    fn from_env() -> Result<Secrets, String> {
        let mut missing: Vec<&str> = Vec::new();
        let pg = std::env::var(ENV_PG_APP_PASSWORD).unwrap_or_default();
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
            jwt_secret: jwt,
            master_key: master,
        })
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

    #[test]
    fn database_url_shape() {
        let url = format!(
            "postgresql://{}:{}@{}:{}/{}",
            "medivault",
            percent_encode("MedivaultMacCI2026!"),
            "127.0.0.1",
            55434,
            "medivault"
        );
        assert_eq!(
            url,
            "postgresql://medivault:MedivaultMacCI2026%21@127.0.0.1:55434/medivault"
        );
    }
}
