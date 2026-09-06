//! MediVault Desktop — Tauri application entry point.
//!
//! This binary initialises the Tauri runtime, registers all plugins,
//! and maps every IPC command module to its corresponding handler.

// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::info;
use tauri::Manager;

mod api_client;
mod commands;
mod credential;
mod scanner;

// Re-export library types so command modules can use them.
pub use medivault_lib::*;

fn main() {
    // Initialise the logger before anything else.
    env_logger::Builder::from_default_env()
        .filter_level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        })
        .init();

    info!("MediVault Desktop starting…");

    tauri::Builder::default()
        // ── Tauri 2 Plugins ──────────────────────────────────────────
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        // ── IPC Command Modules ───────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::login,
            commands::auth::logout,
            commands::auth::refresh_session,
            commands::auth::change_password,
            commands::auth::get_force_password_change_status,
            // Patients
            commands::patients::search_patients,
            commands::patients::get_recent_patients,
            commands::patients::get_patient,
            commands::patients::get_patient_timeline,
            commands::patients::get_patient_visits,
            commands::patients::get_patient_notes,
            commands::patients::get_patient_prescriptions,
            commands::patients::get_patient_reports,
            // Documents
            commands::documents::upload_document,
            commands::documents::upload_multiple,
            commands::documents::upload_folder,
            commands::documents::download_document,
            commands::documents::download_range,
            commands::documents::view_document,
            commands::documents::move_document,
            commands::documents::restore_document,
            commands::documents::delete_document,
            commands::documents::get_document_info,
            // Backup
            commands::backup::get_backup_drive_status,
            commands::backup::select_backup_destination,
            commands::backup::start_manual_backup,
            commands::backup::get_backup_progress,
            commands::backup::verify_backup_checksums,
            commands::backup::get_restore_preview,
            commands::backup::execute_restore,
            commands::backup::get_backup_history,
            // Settings
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::test_server_connection,
            commands::settings::get_certificate_trust_status,
            commands::settings::get_service_status,
            commands::settings::get_database_status,
            commands::settings::get_device_status,
            commands::settings::get_log_contents,
            // Device enrollment
            commands::device::generate_device_keypair,
            commands::device::enroll_device,
            commands::device::get_device_registration_status,
            commands::device::revoke_device,
            commands::device::sign_challenge,
            commands::device::list_devices,
            // Scanner
            scanner::list_scanners,
            scanner::scan_single_page,
            scanner::scan_multi_page,
            scanner::rotate_page,
            scanner::remove_page,
            scanner::reorder_page,
            scanner::create_pdf_from_pages,
            scanner::cleanup_temp_files,
        ])
        // ── Lifecycle ─────────────────────────────────────────────────
        .setup(|app| {
            // Ensure temp scan directory exists and clean stale files.
            let app_data = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let temp_dir = app_data.join("temp_scans");
            if !temp_dir.exists() {
                std::fs::create_dir_all(&temp_dir)?;
            }
            if let Err(e) = scanner::cleanup_temp_files_at(&temp_dir) {
                log::warn!("Failed to clean temp scan files on startup: {}", e);
            }
            info!("MediVault Desktop ready.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MediVault Tauri application");
}
