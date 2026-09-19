//! Native print / PDF-export bridge (ff-2b — P2 PRINT_FAMILY_WKWEBVIEW_INOPERATIVE).
//!
//! The WKWebView `window.print()` family is proven inoperative on the
//! shipped app (no native print sheet ever appears — acceptance runs
//! 35438207330 / 35440378070). This module replaces that family with a
//! deterministic native macOS contract:
//!
//!   1. The FRONTEND generates a REAL PDF (pdf-lib) — or fetches the
//!      already-PDF document bytes — and base64-encodes them.
//!   2. `open_for_print` materializes the bytes as a temp file and hands
//!      it to the OS default viewer via `/usr/bin/open` (Preview for
//!      PDFs) — no shell, no terminal, no arbitrary paths from the page.
//!   3. `save_pdf_file` shows the NATIVE save panel (tauri-plugin-dialog)
//!      and writes the bytes to the user-chosen path only.
//!
//! ── PHI TEMP LIFECYCLE (directive §4) ─────────────────────────────────
//!
//! * CREATION: every temp file gets an UNPREDICTABLE, PHI-FREE name
//!   (`medivault-<uuid>.<ext>`) — no patient names, no document titles,
//!   no tokens or secrets in filenames. Files are created with 0600
//!   permissions inside a 0700 `medivault-print` directory under the OS
//!   temp dir (on macOS `$TMPDIR` is additionally per-user).
//! * LIFETIME: files are intentionally KEPT after `open_for_print`
//!   returns — Preview may (re)read them while the user reviews or
//!   prints, so nothing is deleted immediately after open.
//! * CLEANUP: a startup sweep (`cleanup_print_temp_at_start`, wired next
//!   to the scanner precedent in `main.rs` `.setup()`) removes entries
//!   older than 24 hours; per-entry failures are logged and skipped so a
//!   single locked file can never abort startup.
//! * USER EXPORTS ARE SEPARATE: `save_pdf_file` writes ONLY to the
//!   path the user picks in the native save panel — a user-chosen
//!   location, never the temp directory, and never a path supplied by
//!   the page.
//! * NO CONTENT LOGGING: log statements carry the opaque path only —
//!   never document bytes, never PHI.
//!
//! SECURITY: input is validated fail-closed by magic bytes — only
//! `%PDF-`, JPEG (`FF D8 FF`) and PNG (`89 50 4E 47`) are accepted, and
//! `save_pdf_file` accepts `%PDF-` only (images are wrapped into a PDF
//! upstream before reaching it). The remote-URL capability
//! (`src-tauri/capabilities/loopback-print-bridge.json`) grants ONLY the
//! loopback API origin access to these two commands.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

// ---------------------------------------------------------------------------
// Outcome wire types (serde tag = {"outcome":"opened"|"saved"|"cancelled"})
// ---------------------------------------------------------------------------

/// Result of [`open_for_print`].
#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum PrintOutcome {
    /// The document was materialized and opened in the OS default viewer.
    Opened { path: String },
}

/// Result of [`save_pdf_file`].
#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// The PDF was written to the user-chosen path.
    Saved { path: String },
    /// The user dismissed the native save panel.
    Cancelled,
}

// ---------------------------------------------------------------------------
// Magic-byte validation (fail-closed)
// ---------------------------------------------------------------------------

/// Supported print media, detected from the leading magic bytes only.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum PrintMagic {
    Pdf,
    Jpeg,
    Png,
}

/// Pure function — unit-tested below.
fn detect_magic(bytes: &[u8]) -> Option<PrintMagic> {
    if bytes.starts_with(b"%PDF-") {
        Some(PrintMagic::Pdf)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(PrintMagic::Jpeg)
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some(PrintMagic::Png)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

/// The dedicated print temp directory (NEVER the app-data scan dir).
fn print_temp_dir() -> PathBuf {
    std::env::temp_dir().join("medivault-print")
}

/// Create (if needed) the print temp dir with restrictive permissions.
fn ensure_print_temp_dir() -> Result<PathBuf, String> {
    let dir = print_temp_dir();
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create the print temp directory: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure the print temp directory: {e}"))?;
    }
    Ok(dir)
}

/// Base64-decode helper (base64 0.22, standard alphabet, no padding loss).
fn decode_b64(data_b64: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data_b64.as_bytes(),
    )
    .map_err(|_| "The document data could not be decoded.".to_string())
}

// ---------------------------------------------------------------------------
// IPC commands
// ---------------------------------------------------------------------------

/// Materialize validated document bytes as a temp file and open it in the
/// OS default viewer (macOS Preview for PDFs) for printing.
///
/// The frontend generates/fetches the real bytes (pdf-lib for reports and
/// prescriptions; the stored bytes for existing documents). This command
/// NEVER deletes the file after opening — Preview may still need it (see
/// the module-level PHI lifecycle notes).
#[tauri::command]
pub async fn open_for_print(data_b64: String) -> Result<PrintOutcome, String> {
    let bytes = decode_b64(&data_b64)?;

    // Fail-closed magic validation: only PDF / JPEG / PNG are printable.
    let magic = detect_magic(&bytes)
        .ok_or_else(|| "Unsupported file type for printing.".to_string())?;
    let ext = match magic {
        PrintMagic::Pdf => "pdf",
        PrintMagic::Jpeg => "jpg",
        PrintMagic::Png => "png",
    };

    let dir = ensure_print_temp_dir()?;

    // Unpredictable, PHI-free name — a random UUID and the extension only.
    let path = dir.join(format!("medivault-{}.{}", uuid::Uuid::new_v4(), ext));

    fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write the print document: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to secure the print document: {e}"))?;
    }

    // Open with the OS default handler — a FIXED binary path with a single
    // argument. No shell string is ever built; a failure is a friendly Err.
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&path)
        .status()
        .map_err(|_| "Could not open the document for printing.".to_string())?;
    if !status.success() {
        return Err("Could not open the document for printing.".to_string());
    }

    // Log the opaque path only — never the contents.
    log::info!("print bridge: opened {} for printing", path.display());
    Ok(PrintOutcome::Opened {
        path: path.to_string_lossy().to_string(),
    })
}

/// Show the NATIVE save panel and write PDF bytes to the user-chosen path.
///
/// `blocking_save_file` must run off the main thread (the plugin requires
/// it), so the dialog runs inside `tokio::task::spawn_blocking`. The
/// suggested name is sanitized (no path separators, ≤200 chars, forced
/// `.pdf`); the destination is ALWAYS the user's own selection.
#[tauri::command]
pub async fn save_pdf_file(
    app: tauri::AppHandle,
    data_b64: String,
    suggested_name: String,
) -> Result<SaveOutcome, String> {
    let bytes = decode_b64(&data_b64)?;

    // PDF magic only — images are wrapped into a PDF upstream.
    if !bytes.starts_with(b"%PDF-") {
        return Err("Unsupported file type — only PDF documents can be saved here.".to_string());
    }

    let name = sanitize_suggested_name(&suggested_name);

    // Run the blocking native save panel on a dedicated thread.
    let chosen = tokio::task::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        app.dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("The save dialog could not be shown: {e}"))?;

    let Some(file_path) = chosen else {
        return Ok(SaveOutcome::Cancelled);
    };

    // FilePath -> PathBuf (handles both the Url and Path variants).
    let dest: PathBuf = file_path
        .into_path()
        .map_err(|e| format!("The selected location is not a valid filesystem path: {e}"))?;

    // Create/truncate + write in one step.
    fs::write(&dest, &bytes)
        .map_err(|e| format!("Could not save the PDF to the selected location: {e}"))?;

    log::info!("print bridge: PDF saved to {}", dest.display());
    Ok(SaveOutcome::Saved {
        path: dest.to_string_lossy().to_string(),
    })
}

/// Sanitize a frontend-suggested file name for the save panel.
///
/// Pure function — unit-tested below: strips path separators, trims
/// whitespace AND any leading/trailing dots (a lone `..` prefix is still
/// path-shaped even after its separators are stripped), caps the length,
/// falls back to `MediVault.pdf`, and forces the `.pdf` extension.
fn sanitize_suggested_name(raw: &str) -> String {
    let mut name: String = raw.replace('/', "").replace('\\', "");
    name = name
        .trim()
        .trim_matches('.')
        .trim()
        .chars()
        .take(200)
        .collect();
    if name.is_empty() {
        name = "MediVault.pdf".to_string();
    }
    if !name.to_ascii_lowercase().ends_with(".pdf") {
        name.push_str(".pdf");
    }
    name
}

// ---------------------------------------------------------------------------
// Startup cleanup (stale temp sweep)
// ---------------------------------------------------------------------------

/// Remove print temp files older than 24 hours; ensure the dir exists.
///
/// Mirrors the `scanner::cleanup_temp_files_at` startup precedent — a
/// per-entry failure is logged and skipped (never panics, never aborts
/// startup). Returns how many entries were removed.
pub fn cleanup_print_temp_at_start() -> Result<usize, String> {
    let dir = ensure_print_temp_dir()?;

    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Failed to read the print temp directory: {e}")),
    };

    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        // Keep entries younger than 24h (and anything whose age cannot be
        // determined — conservative).
        let stale = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|age| age.as_secs() > 24 * 60 * 60)
            .unwrap_or(false);
        if !stale {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(e) => log::warn!(
                "print bridge: failed to remove stale temp file {}: {}",
                path.display(),
                e
            ),
        }
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Unit tests (pure functions only — no IPC, no dialogs)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{detect_magic, sanitize_suggested_name, PrintMagic};

    #[test]
    fn accepts_exactly_the_three_printable_magics() {
        assert_eq!(detect_magic(b"%PDF-1.7\n..."), Some(PrintMagic::Pdf));
        assert_eq!(detect_magic(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(PrintMagic::Jpeg));
        assert_eq!(
            detect_magic(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]),
            Some(PrintMagic::Png)
        );
    }

    #[test]
    fn rejects_everything_else_fail_closed() {
        assert_eq!(detect_magic(b"<html>"), None);
        assert_eq!(detect_magic(&[0x89, 0x50, 0x4E]), None); // truncated PNG
        assert_eq!(detect_magic(&[0xFF, 0xD8]), None); // truncated JPEG
        assert_eq!(detect_magic(b"pdf-"), None); // case matters
        assert_eq!(detect_magic(b""), None);
    }

    #[test]
    fn sanitizes_suggested_names() {
        // Path separators stripped, extension enforced.
        assert_eq!(
            sanitize_suggested_name("../../etc/passwd"),
            "etcpasswd.pdf"
        );
        assert_eq!(sanitize_suggested_name("report.PDF"), "report.PDF");
        assert_eq!(sanitize_suggested_name("report"), "report.pdf");
        // Empty / blank falls back.
        assert_eq!(sanitize_suggested_name("   "), "MediVault.pdf");
        assert_eq!(sanitize_suggested_name(""), "MediVault.pdf");
        // Backslashes stripped too (no Windows path shapes).
        assert_eq!(sanitize_suggested_name("a\\b\\c"), "abc.pdf");
        // Dot-only / dot-wrapped shapes fall back or lose the path-ish dots.
        assert_eq!(sanitize_suggested_name("..."), "MediVault.pdf");
        assert_eq!(sanitize_suggested_name(".hidden."), "hidden.pdf");
    }

    #[test]
    fn caps_the_name_length() {
        let long = "x".repeat(500);
        let out = sanitize_suggested_name(&long);
        assert!(out.len() <= 204); // 200 chars + ".pdf"
        assert!(out.ends_with(".pdf"));
    }
}
