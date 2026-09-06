//! MediVault Desktop — Shared type definitions.
//!
//! This module contains all request/response types used for IPC between
//! the Tauri frontend (JavaScript/TypeScript) and the Rust backend.
//! Every struct that crosses the IPC boundary must derive `Serialize`
//! and `Deserialize`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Generic API response wrapper
// ---------------------------------------------------------------------------

/// Standard envelope for all responses from the Fastify API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum ApiResponse<T> {
    #[serde(rename = "ok")]
    Ok { data: T },
    #[serde(rename = "error")]
    Error { error: ApiError },
}

/// Typed error payload returned by the Fastify API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub status: u16,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

// ---------------------------------------------------------------------------
// Authentication types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// Optional: override the server URL from settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub session_id: String,
    pub user_id: String,
    pub email: String,
    pub role: String,
    pub force_password_change: bool,
    pub csrf_token: Option<String>,
    pub expires_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Device enrollment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceEnrollmentRequest {
    pub pairing_code: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceEnrollmentResponse {
    pub device_id: String,
    pub device_name: String,
    pub enrolled_at: DateTime<Utc>,
    pub public_key_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeResponse {
    pub challenge_id: String,
    pub nonce: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeProofRequest {
    pub challenge_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceKeyPair {
    pub device_id: String,
    pub public_key_pem: String,
    /// Always empty / masked — the private key is stored in Credential Manager.
    pub private_key_stored: bool,
    pub public_key_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub registered: bool,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub enrolled_at: Option<DateTime<Utc>>,
    pub public_key_fingerprint: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub challenge_required: bool,
}

// ---------------------------------------------------------------------------
// Patient types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientSearchResult {
    pub id: String,
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub mrn: Option<String>,
    pub last_visit_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientDetail {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub mrn: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub allergies: Option<serde_json::Value>,
    pub insurance_info: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisitInfo {
    pub id: String,
    pub patient_id: String,
    pub visit_date: DateTime<Utc>,
    pub visit_type: Option<String>,
    pub provider_name: Option<String>,
    pub chief_complaint: Option<String>,
    pub diagnosis_codes: Option<serde_json::Value>,
    pub notes_count: i32,
    pub documents_count: i32,
    pub prescriptions_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteInfo {
    pub id: String,
    pub patient_id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub note_type: Option<String>,
    pub author_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrescriptionInfo {
    pub id: String,
    pub patient_id: String,
    pub medication_name: Option<String>,
    pub dosage: Option<String>,
    pub frequency: Option<String>,
    pub prescriber_name: Option<String>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportInfo {
    pub id: String,
    pub patient_id: String,
    pub title: Option<String>,
    pub report_type: Option<String>,
    pub status: Option<String>,
    pub ordered_by: Option<String>,
    pub result_date: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub id: String,
    pub entry_type: String,
    pub title: String,
    pub description: Option<String>,
    pub author_name: Option<String>,
    pub occurred_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub id: String,
    pub patient_id: String,
    pub title: Option<String>,
    pub category: Option<String>,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub checksum_sha256: Option<String>,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub upload_id: String,
    pub file_name: String,
    pub bytes_uploaded: i64,
    pub total_bytes: i64,
    pub percentage: f64,
    pub status: String,
}

// ---------------------------------------------------------------------------
// Backup types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: String,
    pub total_size_bytes: Option<i64>,
    pub file_count: Option<i32>,
    pub destination: String,
    pub checksum_algorithm: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorePreview {
    pub backup_id: String,
    pub file_count: i32,
    /// Total uncompressed size of files in the backup.
    pub total_size_bytes: i64,
    /// List of files that would be restored.
    pub files: Vec<RestoreFileEntry>,
    /// Warnings (e.g., files that would overwrite existing data).
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreFileEntry {
    pub path: String,
    pub size_bytes: i64,
    pub modified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    pub success: bool,
    pub restored_count: i32,
    pub failed_count: i32,
    pub errors: Vec<String>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupDriveStatus {
    pub available: bool,
    pub drive_label: Option<String>,
    pub free_space_bytes: Option<i64>,
    pub total_space_bytes: Option<i64>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
    pub backup_id: String,
    pub current_step: String,
    pub files_processed: i32,
    pub total_files: Option<i32>,
    pub bytes_processed: i64,
    pub total_bytes: Option<i64>,
    pub percentage: f64,
    pub started_at: DateTime<Utc>,
    pub estimated_remaining_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumResult {
    pub file_path: String,
    pub expected: String,
    pub actual: String,
    pub matches: bool,
}

// ---------------------------------------------------------------------------
// Scanner types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerDevice {
    pub id: String,
    pub name: String,
    pub scanner_type: ScannerType,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScannerType {
    #[serde(rename = "wia")]
    Wia,
    #[serde(rename = "twain")]
    Twain,
    #[serde(rename = "folder")]
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    pub resolution_dpi: u32,
    pub color_mode: ScanColorMode,
    pub paper_size: ScanPaperSize,
    pub duplex: bool,
    pub quality: ScanQuality,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScanColorMode {
    #[serde(rename = "color")]
    Color,
    #[serde(rename = "grayscale")]
    Grayscale,
    #[serde(rename = "monochrome")]
    Monochrome,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScanPaperSize {
    #[serde(rename = "a4")]
    A4,
    #[serde(rename = "letter")]
    Letter,
    #[serde(rename = "legal")]
    Legal,
    #[serde(rename = "auto")]
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScanQuality {
    #[serde(rename = "draft")]
    Draft,
    #[serde(rename = "normal")]
    Normal,
    #[serde(rename = "high")]
    High,
    #[serde(rename = "photo")]
    Photo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub page_path: String,
    pub width_px: u32,
    pub height_px: u32,
    pub file_size_bytes: u64,
    pub mime_type: String,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Non-sensitive desktop preferences persisted in `settings.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub server_url: String,
    pub theme: String,
    pub language: String,
    pub auto_backup_enabled: bool,
    pub auto_backup_interval_minutes: u32,
    pub backup_destination: Option<String>,
    pub scan_default_config: ScanConfig,
    pub default_document_category: Option<String>,
    pub notification_sound_enabled: bool,
    pub minimize_to_tray: bool,
    pub start_with_windows: bool,
    pub last_patient_id: Option<String>,
    pub recently_viewed_patients: Vec<String>,
    pub max_recent_patients: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            theme: "system".to_string(),
            language: "en".to_string(),
            auto_backup_enabled: false,
            auto_backup_interval_minutes: 480,
            backup_destination: None,
            scan_default_config: ScanConfig {
                resolution_dpi: 300,
                color_mode: ScanColorMode::Color,
                paper_size: ScanPaperSize::Auto,
                duplex: false,
                quality: ScanQuality::Normal,
            },
            default_document_category: None,
            notification_sound_enabled: true,
            minimize_to_tray: true,
            start_with_windows: false,
            last_patient_id: None,
            recently_viewed_patients: Vec::new(),
            max_recent_patients: 20,
        }
    }
}

// ---------------------------------------------------------------------------
// Service / system status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub reachable: bool,
    pub response_time_ms: Option<u64>,
    pub server_version: Option<String>,
    pub uptime_seconds: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseStatus {
    pub connected: bool,
    pub size_bytes: Option<i64>,
    pub total_patients: Option<i64>,
    pub total_documents: Option<i64>,
    pub last_backup: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionResult {
    pub success: bool,
    pub response_time_ms: Option<u64>,
    pub server_version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertTrustStatus {
    pub trusted: bool,
    pub issuer: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub days_until_expiry: Option<i64>,
    pub error: Option<String>,
}
