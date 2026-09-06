//! The supervisor status file — the observable contract for everything
//! outside the process (CI assertions, the `status` subcommand, later the
//! desktop Settings panel).
//!
//! Writes are atomic (tmp + rename) so readers never observe a torn JSON
//! document. Timestamps are epoch seconds: unambiguous, jq-friendly, and
//! no timezone machinery in the binary.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const STATE_STARTING: &str = "starting";
pub const STATE_HEALTHY: &str = "healthy";
pub const STATE_DEGRADED: &str = "degraded";
pub const STATE_STOPPING: &str = "stopping";
pub const STATE_STOPPED: &str = "stopped";
pub const STATE_FAILED: &str = "failed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Status {
    pub state: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pg_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_pid: Option<u32>,
    pub pg_restarts: u32,
    pub api_restarts: u32,
    pub started_at_epoch: u64,
    pub updated_at_epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

pub fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Status {
    pub fn new(pid: u32) -> Status {
        let t = now_epoch();
        Status {
            state: STATE_STARTING.to_string(),
            pid,
            pg_pid: None,
            api_pid: None,
            pg_restarts: 0,
            api_restarts: 0,
            started_at_epoch: t,
            updated_at_epoch: t,
            last_error: None,
        }
    }

    /// Atomic write to `path`.
    pub fn write(&self, path: &Path) -> Result<(), String> {
        let tmp = path.with_extension("json.tmp");
        let body =
            serde_json::to_string_pretty(self).map_err(|e| format!("status serialize: {e}"))?;
        fs::write(&tmp, body)
            .map_err(|e| format!("cannot write status file {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path)
            .map_err(|e| format!("cannot finalize status file {}: {e}", path.display()))
    }

    pub fn read(path: &Path) -> Result<Status, String> {
        let raw = fs::read_to_string(path)
            .map_err(|e| format!("cannot read status file {}: {e}", path.display()))?;
        serde_json::from_str(&raw).map_err(|e| format!("invalid status JSON: {e}"))
    }

    /// Mutate + persist in one step.
    pub fn update<F: FnOnce(&mut Status)>(&mut self, path: &Path, f: F) -> Result<(), String> {
        f(self);
        self.updated_at_epoch = now_epoch();
        self.write(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let mut st = Status::new(4242);
        st.state = STATE_HEALTHY.to_string();
        st.pg_pid = Some(100);
        st.api_pid = Some(200);
        let dir = std::env::temp_dir().join("mv-supervisor-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("status.json");
        st.write(&path).unwrap();
        let back = Status::read(&path).unwrap();
        assert_eq!(back.state, STATE_HEALTHY);
        assert_eq!(back.pid, 4242);
        assert_eq!(back.pg_pid, Some(100));
        assert_eq!(back.api_pid, Some(200));
        assert!(back.last_error.is_none());
    }
}
