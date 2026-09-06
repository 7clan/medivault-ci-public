//! Patient-related IPC commands.
//!
//! Provides search, detail, timeline, visit, note, prescription, and report
//! retrieval.  All commands delegate to the Fastify API and respect RBAC
//! permissions enforced server-side.

use crate::api_client::MedivaultApiClient;
use crate::credential;
use log::debug;
use medivault_lib::{
    ApiResponse, NoteInfo, PaginatedResponse, PatientDetail, PatientSearchResult, PrescriptionInfo,
    ReportInfo, TimelineEntry, VisitInfo,
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Internal wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct SearchQuery {
    q: String,
    page: Option<i32>,
    per_page: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PatientListResponse {
    items: Vec<serde_json::Value>,
    total: i64,
    page: i32,
    per_page: i32,
    total_pages: i32,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Search patients by query string. Returns a paginated result set.
#[tauri::command]
pub async fn search_patients(
    query: String,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<PaginatedResponse<PatientSearchResult>, String> {
    debug!("search_patients: query={}", query);

    let client = require_client()?;

    let body = SearchQuery {
        q: query,
        page,
        per_page,
    };

    let resp: ApiResponse<PatientListResponse> = client
        .post("/api/patients/search", &body)
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let items: Vec<PatientSearchResult> = data
                .items
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();

            Ok(PaginatedResponse {
                items,
                total: data.total,
                page: data.page,
                per_page: data.per_page,
                total_pages: data.total_pages,
            })
        }
        ApiResponse::Error { error } => Err(format!(
            "Patient search failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Retrieve the most recently viewed or modified patients.
#[tauri::command]
pub async fn get_recent_patients(limit: Option<i32>) -> Result<Vec<PatientSearchResult>, String> {
    debug!("get_recent_patients: limit={:?}", limit);

    let client = require_client()?;
    let limit_val = limit.unwrap_or(20);

    let resp: ApiResponse<Vec<serde_json::Value>> = client
        .get(&format!("/api/patients/recent?limit={}", limit_val))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => {
            let patients: Vec<PatientSearchResult> = data
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            Ok(patients)
        }
        ApiResponse::Error { error } => Err(format!(
            "Recent patients fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get full detail for a single patient by ID.
#[tauri::command]
pub async fn get_patient(patient_id: String) -> Result<PatientDetail, String> {
    debug!("get_patient: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<PatientDetail> = client
        .get(&format!("/api/patients/{}", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Patient detail failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get chronological timeline entries for a patient.
#[tauri::command]
pub async fn get_patient_timeline(patient_id: String) -> Result<Vec<TimelineEntry>, String> {
    debug!("get_patient_timeline: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<TimelineEntry>> = client
        .get(&format!("/api/patients/{}/timeline", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Timeline fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get all visits for a patient.
#[tauri::command]
pub async fn get_patient_visits(patient_id: String) -> Result<Vec<VisitInfo>, String> {
    debug!("get_patient_visits: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<VisitInfo>> = client
        .get(&format!("/api/patients/{}/visits", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Visits fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get all clinical notes for a patient.
#[tauri::command]
pub async fn get_patient_notes(patient_id: String) -> Result<Vec<NoteInfo>, String> {
    debug!("get_patient_notes: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<NoteInfo>> = client
        .get(&format!("/api/patients/{}/notes", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Notes fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get all prescriptions for a patient.
#[tauri::command]
pub async fn get_patient_prescriptions(
    patient_id: String,
) -> Result<Vec<PrescriptionInfo>, String> {
    debug!("get_patient_prescriptions: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<PrescriptionInfo>> = client
        .get(&format!("/api/patients/{}/prescriptions", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Prescriptions fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

/// Get all reports (lab / imaging) for a patient.
#[tauri::command]
pub async fn get_patient_reports(patient_id: String) -> Result<Vec<ReportInfo>, String> {
    debug!("get_patient_reports: id={}", patient_id);

    let client = require_client()?;

    let resp: ApiResponse<Vec<ReportInfo>> = client
        .get(&format!("/api/patients/{}/reports", patient_id))
        .await
        .map_err(|e| e.to_string())?;

    match resp {
        ApiResponse::Ok { data } => Ok(data),
        ApiResponse::Error { error } => Err(format!(
            "Reports fetch failed: {} — {}",
            error.code, error.message
        )),
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Build a `MedivaultApiClient` from the stored server URL and session token.
fn require_client() -> Result<MedivaultApiClient, String> {
    let url = credential::read_credential("MediVault/server-url").map_err(|e| e.to_string())?;
    if url.is_empty() {
        return Err("Server URL not configured. Open Settings to connect.".into());
    }
    Ok(MedivaultApiClient::new(url))
}
