//! Tauri build script for MediVault desktop application.
//!
//! This script is invoked by Cargo during the build process and configures
//! the Tauri build pipeline, including code generation for IPC commands
//! and platform-specific bundling.

fn main() {
    tauri_build::build()
}
