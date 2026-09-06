//! Minimal file logger: epoch-timestamped, append-only, line-per-event.
//!
//! Discipline (mirrors the platform's log redaction contract):
//!   - callers log event NAMES and pids, never secret values;
//!   - the log file lives in `~/Library/Logs/MediVault/supervisor.log`;
//!   - lines are also echoed to stdout so a foreground run (CI, terminal)
//!     sees the same stream.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

pub struct Logger {
    file: Mutex<std::fs::File>,
}

impl Logger {
    pub fn new(path: &Path) -> Result<Logger, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create log dir {}: {e}", parent.display()))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("cannot open log file {}: {e}", path.display()))?;
        Ok(Logger {
            file: Mutex::new(file),
        })
    }

    pub fn log(&self, level: &str, message: &str) {
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let line = format!("{epoch}\t{level}\t{message}\n");
        {
            let mut guard = match self.file.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            let _ = guard.write_all(line.as_bytes());
            let _ = guard.flush();
        }
        print!("{line}");
        let _ = std::io::stdout().flush();
    }

    pub fn info(&self, message: &str) {
        self.log("INFO", message);
    }

    pub fn warn(&self, message: &str) {
        self.log("WARN", message);
    }

    pub fn error(&self, message: &str) {
        self.log("ERROR", message);
    }
}
