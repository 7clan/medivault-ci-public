//! Document management IPC commands.
//!
//! Handles uploading, downloading, viewing, moving, restoring, and deleting
//! documents. Supports single-file, multi-file, and folder imports.
//! Large file uploads use chunked streaming; downloads respect byte ranges
//! for partial content retrieval.

use crate::api_client::MedivaultApiClient;
use crate::credential;
use log::{debug, info, warn};
use medivault_lib::{ApiResponse, DocumentInfo};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct UploadSingleBody {
    patient_id: String,
    title: Option<String>,
    category: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MoveBody {
    new_patient_id: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct UploadResultWrapper {
    id: String,
    #[serde(flatten)]
    other: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Upload a single document for a patient.
///
/// The file is read from `file_path` and streamed to the Fastify API via
/// multipart form data.  The server handles storage encryption.
#[tauri::command]
pub async fn upload_document(
    patient_id: String,
    file_path: String,
    title: Option<String>,
    category: Option<String>,
    notes: Option<String>,
) -> Result<DocumentInfo, String> {
    info!(
        "upload_document: patient={}, file={}",
        patient_id, file_path
    );
    debug!(
        "upload params: title={:?}, category={:?}, notes={:?}",
        title, category, notes
    );

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let _file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let client = require_client()?;

    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone())
        .mime_str(&mime)
        .unwrap_or_else(|_| {
            reqwest::multipart::Part::bytes(Vec::new())
                .mime_str("application/octet-stream")
                .unwrap()
                .file_name(file_name.clone())
        });

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("patient_id", patient_id.clone())
        .text("title", title.clone().unwrap_or_default())
        .text("category", category.clone().unwrap_or_default())
        .text("notes", notes.clone().unwrap_or_default());

    let resp: ApiResponse<serde_json::Value> = client
        .upload_multipart("/api/documents", form)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let doc: DocumentInfo = serde_json::from_value(data)
                .map_err(|e| format!("Failed to parse upload response: {}", e))?;
            info!("Document uploaded: id={}", doc.id);
            Ok(doc)
        }
        ApiResponse::Error { error } => {
            Err(format!("Upload failed: {} — {}", error.code, error.message))
        }
    }
}

/// Upload multiple documents for a patient.
#[tauri::command]
pub async fn upload_multiple(
    patient_id: String,
    file_paths: Vec<String>,
    category: Option<String>,
) -> Result<Vec<DocumentInfo>, String> {
    info!(
        "upload_multiple: patient={}, count={}",
        patient_id,
        file_paths.len()
    );

    let _client = require_client()?;
    let mut results = Vec::new();

    for file_path in &file_paths {
        match upload_document(
            patient_id.clone(),
            file_path.clone(),
            None, // auto-title from filename
            category.clone(),
            None,
        )
        .await
        {
            Ok(doc) => results.push(doc),
            Err(e) => {
                warn!("Failed to upload {}: {}", file_path, e);
                // Continue with remaining files.
            }
        }
    }

    Ok(results)
}

/// Upload an entire folder of files for a patient.
///
/// Recursively discovers all files in `folder_path`, filtering for common
/// medical document extensions (PDF, JPG, PNG, DICOM, etc.).
#[tauri::command]
pub async fn upload_folder(
    patient_id: String,
    folder_path: String,
    category: Option<String>,
) -> Result<Vec<DocumentInfo>, String> {
    info!(
        "upload_folder: patient={}, folder={}",
        patient_id, folder_path
    );

    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!(
            "Folder not found or not a directory: {}",
            folder_path
        ));
    }

    let supported_extensions = [
        "pdf", "jpg", "jpeg", "png", "bmp", "tiff", "tif", "gif", "dcm", "dicom", "txt", "rtf",
        "doc", "docx", "xls", "xlsx",
    ];

    // Collect all supported files recursively.
    let mut file_paths = Vec::new();
    visit_dirs(folder, &mut file_paths, &supported_extensions);

    if file_paths.is_empty() {
        return Err("No supported files found in folder.".into());
    }

    info!("Found {} files to upload", file_paths.len());

    let _client = require_client()?;
    let mut results = Vec::new();

    for fp in &file_paths {
        match upload_document(patient_id.clone(), fp.clone(), None, category.clone(), None).await {
            Ok(doc) => results.push(doc),
            Err(e) => warn!("Folder upload failed for {}: {}", fp, e),
        }
    }

    Ok(results)
}

/// Download a document to `save_path`, streaming the response body to disk.
#[tauri::command]
pub async fn download_document(document_id: String, save_path: String) -> Result<u64, String> {
    info!("download_document: id={}, save={}", document_id, save_path);

    let client = require_client()?;
    let path = Path::new(&save_path);

    let bytes = client
        .download_to_file(
            &format!("/api/documents/{}/download", document_id),
            path,
            None,
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}

/// Download a byte range of a document (partial download / resume).
#[tauri::command]
pub async fn download_range(
    document_id: String,
    start_byte: u64,
    end_byte: u64,
    save_path: String,
) -> Result<u64, String> {
    info!(
        "download_range: id={}, range={}-{}, save={}",
        document_id, start_byte, end_byte, save_path
    );

    let client = require_client()?;
    let path = Path::new(&save_path);

    let bytes = client
        .download_to_file(
            &format!("/api/documents/{}/download", document_id),
            path,
            Some(start_byte),
            Some(end_byte),
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}

/// View a document by downloading it to a temporary file and returning the path.
#[tauri::command]
pub async fn view_document(document_id: String) -> Result<String, String> {
    info!("view_document: id={}", document_id);

    let client = require_client()?;

    // Create a temp directory for viewing.
    let temp_dir = std::env::temp_dir().join("medivault_view");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let temp_path = temp_dir.join(format!("{}_view_{}", document_id, uuid::Uuid::new_v4()));

    let bytes = client
        .download_to_file(
            &format!("/api/documents/{}/download", document_id),
            &temp_path,
            None,
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

    info!(
        "Document downloaded for viewing: {} ({} bytes)",
        temp_path.display(),
        bytes
    );

    Ok(temp_path.to_string_lossy().to_string())
}

/// Move a document from one patient to another.
#[tauri::command]
pub async fn move_document(
    document_id: String,
    new_patient_id: String,
) -> Result<DocumentInfo, String> {
    info!(
        "move_document: doc={}, new_patient={}",
        document_id, new_patient_id
    );

    let client = require_client()?;

    let body = MoveBody { new_patient_id };

    let resp: ApiResponse<DocumentInfo> = client
        .post(&format!("/api/documents/{}/move", document_id), &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => {
            Err(format!("Move failed: {} — {}", error.code, error.message))
        }
    }
}

/// Restore a soft-deleted document.
#[tauri::command]
pub async fn restore_document(document_id: String) -> Result<DocumentInfo, String> {
    info!("restore_document: id={}", document_id);

    let client = require_client()?;

    let resp: ApiResponse<DocumentInfo> = client
        .post(&format!("/api/documents/{}/restore", document_id), &())
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Restore failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Soft-delete a document.
#[tauri::command]
pub async fn delete_document(document_id: String) -> Result<(), String> {
    info!("delete_document: id={}", document_id);

    let client = require_client()?;

    let resp: ApiResponse<serde_json::Value> = client
        .delete(&format!("/api/documents/{}", document_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { .. } => {
            info!("Document soft-deleted: {}", document_id);
            Ok(())
        }
        ApiResponse::Error { error } => {
            Err(format!("Delete failed: {} — {}", error.code, error.message))
        }
    }
}

/// Get metadata for a single document without downloading its contents.
#[tauri::command]
pub async fn get_document_info(document_id: String) -> Result<DocumentInfo, String> {
    info!("get_document_info: id={}", document_id);

    let client = require_client()?;

    let resp: ApiResponse<DocumentInfo> = client
        .get(&format!("/api/documents/{}", document_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Document info failed: {} — {}",
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

/// Recursively visit directories, collecting file paths that match
/// any of the `supported_extensions`.
fn visit_dirs(dir: &Path, files: &mut Vec<String>, extensions: &[&str]) {
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs(&path, files, extensions);
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if extensions.iter().any(|&sup| sup.eq_ignore_ascii_case(ext)) {
                        if let Some(p) = path.to_str() {
                            files.push(p.to_string());
                        }
                    }
                }
            }
        }
    }
}
