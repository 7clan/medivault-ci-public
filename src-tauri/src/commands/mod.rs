//! Tauri IPC command module registry.
//!
//! Re-exports every command sub-module so that `main.rs` can reference them
//! as `commands::auth::login`, `commands::patients::search_patients`, etc.

pub mod auth;
pub mod background_service;
pub mod backup;
pub mod device;
pub mod documents;
pub mod patients;
pub mod settings;
