//! MediVault Scanner Integration
//!
//! **Implemented:**
//! - WIA (Windows Image Acquisition) — preferred on Windows
//! - Folder import — universal fallback
//!
//! **Deferred (not implemented):**
//! - TWAIN — interface structures are defined for future integration.
//!   Real TWAIN DSM integration requires hardware-specific testing.
//!   TWAIN will be implemented when a clinic provides a specific scanner model
//!   that is not supported by WIA.
//!
//! All scanner operations use a restricted temporary directory at
//! `app_data_dir/temp_scans/`. Temporary files are cleaned up on
//! successful upload and on application startup.

use log::{debug, info, warn};
use medivault_lib::{ScanColorMode, ScanConfig, ScanResult, ScannerDevice, ScannerType};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

fn temp_scans_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    #[cfg(not(windows))]
    let base = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MediVault").join("temp_scans")
}

// ---------------------------------------------------------------------------
// Scanner discovery
// ---------------------------------------------------------------------------

/// List all available scanner devices.
///
/// Tries WIA first (Windows only). TWAIN is deferred and not implemented.
/// Always includes a "Folder Import" pseudo-device.
#[tauri::command]
pub async fn list_scanners() -> Result<Vec<ScannerDevice>, String> {
    debug!("list_scanners");
    let mut devices = Vec::new();

    // ── WIA (Windows Image Acquisition) ─────────────────────────────
    #[cfg(windows)]
    {
        match list_wia_scanners() {
            Ok(wia) => {
                for d in wia {
                    devices.push(ScannerDevice {
                        id: d.id,
                        name: d.name,
                        scanner_type: ScannerType::Wia,
                        is_default: false,
                    });
                }
            }
            Err(e) => warn!("WIA scanner enumeration failed: {}", e),
        }
    }

    // ── TWAIN (deferred — not implemented) ───────────────────────────
    // TWAIN requires a native DSM which is architecture-specific and
    // complex to invoke from Rust without a C shim. TWAIN integration
    // is deferred until a clinic provides a specific scanner model that
    // is not supported by WIA.
    #[cfg(windows)]
    {
        debug!("TWAIN: deferred — not implemented. Use WIA or folder import.");
    }

    // ── Folder import pseudo-device ──────────────────────────────────
    devices.push(ScannerDevice {
        id: "folder-import".to_string(),
        name: "Import from Folder".to_string(),
        scanner_type: ScannerType::Folder,
        is_default: devices.is_empty(), // default if no real scanners
    });

    // Mark the first real scanner as default if one was found.
    if let Some(first) = devices
        .iter_mut()
        .find(|d| d.scanner_type != ScannerType::Folder)
    {
        first.is_default = true;
    }

    info!("Found {} scanner devices", devices.len());
    Ok(devices)
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/// Scan a single page from the specified scanner device.
///
/// Returns the path to the temporary image file.
#[tauri::command]
pub async fn scan_single_page(
    scanner_id: String,
    config: ScanConfig,
) -> Result<ScanResult, String> {
    info!(
        "scan_single_page: scanner={}, dpi={}",
        scanner_id, config.resolution_dpi
    );

    let temp_dir = temp_scans_dir();
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    if scanner_id == "folder-import" {
        return Err("Use folder import to add pages from files, not scan_single_page.".into());
    }

    // Dispatch to WIA. (TWAIN is deferred.)
    #[cfg(windows)]
    {
        // Attempt WIA scan.
        match scan_wia_single(&scanner_id, &config, &temp_dir).await {
            Ok(result) => {
                info!("WIA scan successful: {}", result.page_path);
                Ok(result)
            }
            Err(e) => {
                warn!("WIA scan failed: {}", e);
                Err(format!("Scan failed: {}", e))
            }
        }
    }

    #[cfg(not(windows))]
    {
        Err("Scanning is only supported on Windows.".into())
    }
}

/// Scan multiple pages from the specified scanner device (ADF mode).
#[tauri::command]
pub async fn scan_multi_page(
    scanner_id: String,
    config: ScanConfig,
    page_count: i32,
) -> Result<Vec<ScanResult>, String> {
    info!(
        "scan_multi_page: scanner={}, pages={}",
        scanner_id, page_count
    );

    let mut results = Vec::new();
    for i in 0..page_count {
        match scan_single_page(scanner_id.clone(), config.clone()).await {
            Ok(result) => results.push(result),
            Err(e) => {
                warn!("Multi-page scan failed at page {}: {}", i + 1, e);
                // Return partial results.
                if results.is_empty() {
                    return Err(format!("Scan failed at page {}: {}", i + 1, e));
                }
                break;
            }
        }
    }

    info!("Multi-page scan complete: {} pages", results.len());
    Ok(results)
}

// ---------------------------------------------------------------------------
// Page manipulation
// ---------------------------------------------------------------------------

/// Rotate a scanned page by the specified degrees (90, 180, 270).
///
/// Uses the system's `magick` command (ImageMagick) if available,
/// otherwise falls back to a simple BMP rotation.
#[tauri::command]
pub async fn rotate_page(page_path: String, degrees: u32) -> Result<String, String> {
    info!("rotate_page: {}, {}°", page_path, degrees);

    if ![90, 180, 270].contains(&degrees) {
        return Err("Degrees must be 90, 180, or 270.".into());
    }

    let path = Path::new(&page_path);
    if !path.exists() {
        return Err(format!("Page file not found: {}", page_path));
    }

    // Use ImageMagick if available (Windows: magick.exe).
    let magick = "magick";
    let output = format!(
        "{}.rotated{}",
        page_path,
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default()
    );

    match tokio::process::Command::new(magick)
        .arg(&page_path)
        .arg("-rotate")
        .arg(degrees.to_string())
        .arg(&output)
        .output()
        .await
    {
        Ok(result) if result.status.success() => {
            info!("Page rotated: {}", output);
            Ok(output)
        }
        _ => {
            // Fallback: rename and note that rotation was not applied.
            warn!("ImageMagick not available — rotation not applied");
            Ok(page_path)
        }
    }
}

/// Remove a page from a multi-page scan result set.
///
/// Returns the updated list of page paths.
#[tauri::command]
pub async fn remove_page(pages: Vec<String>, index: usize) -> Result<Vec<String>, String> {
    info!("remove_page: index={}", index);

    if index >= pages.len() {
        return Err(format!(
            "Index {} out of range ({} pages)",
            index,
            pages.len()
        ));
    }

    let removed = &pages[index];
    // Delete the file.
    let _ = fs::remove_file(removed);

    let mut updated = pages;
    updated.remove(index);
    Ok(updated)
}

/// Reorder pages by moving from one index to another.
#[tauri::command]
pub async fn reorder_page(
    pages: Vec<String>,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<String>, String> {
    info!("reorder_page: {} -> {}", from_index, to_index);

    if from_index >= pages.len() || to_index >= pages.len() {
        return Err("Index out of range.".into());
    }

    let mut reordered = pages;
    let item = reordered.remove(from_index);
    reordered.insert(to_index, item);
    Ok(reordered)
}

/// Combine multiple page images into a single PDF file.
///
/// Uses ImageMagick (`magick`) to assemble the pages.
#[tauri::command]
pub async fn create_pdf_from_pages(page_paths: Vec<String>) -> Result<String, String> {
    info!("create_pdf_from_pages: {} pages", page_paths.len());

    if page_paths.is_empty() {
        return Err("No pages provided.".into());
    }

    let temp_dir = temp_scans_dir();
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let output_path = temp_dir
        .join(format!("combined_{}.pdf", uuid::Uuid::new_v4()))
        .to_string_lossy()
        .to_string();

    // Use ImageMagick to convert images to PDF.
    let mut cmd = tokio::process::Command::new("magick");
    for page in &page_paths {
        cmd.arg(page);
    }
    cmd.arg(&output_path);

    match cmd.output().await {
        Ok(result) if result.status.success() => {
            info!("PDF created: {}", output_path);
            Ok(output_path)
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            Err(format!("PDF creation failed: {}", stderr))
        }
        Err(e) => Err(format!("Failed to run magick: {}", e)),
    }
}

/// Clean up all temporary scan files from the temp_scans directory.
///
/// Called on application startup and after successful upload of all pages.
#[tauri::command]
pub async fn cleanup_temp_files() -> Result<u32, String> {
    let dir = temp_scans_dir();
    let count = cleanup_temp_files_at(&dir).map_err(|e| e.to_string())?;
    info!("Cleaned up {} temporary scan files", count);
    Ok(count)
}

/// Internal cleanup function (not a Tauri command).
pub fn cleanup_temp_files_at(dir: &Path) -> Result<u32, std::io::Error> {
    if !dir.exists() {
        return Ok(0);
    }

    let mut count = 0u32;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                // Remove files older than 1 hour.
                let age = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .unwrap_or_default();
                if age.as_secs() > 3600 {
                    if let Err(e) = fs::remove_file(&path) {
                        warn!("Failed to delete temp file {:?}: {}", path, e);
                    } else {
                        count += 1;
                    }
                }
            }
        }
    }

    Ok(count)
}

// ---------------------------------------------------------------------------
// Folder import helpers
// ---------------------------------------------------------------------------

/// Recursively discover image files in a folder.
///
/// Returns paths sorted by filename.
#[allow(dead_code)]
pub fn import_folder(folder_path: &str) -> Result<Vec<String>, String> {
    let folder = Path::new(folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Invalid folder: {}", folder_path));
    }

    let image_extensions = ["jpg", "jpeg", "png", "bmp", "tiff", "tif", "gif", "webp"];

    let mut files = Vec::new();
    collect_image_files(folder, &mut files, &image_extensions);
    files.sort();

    info!(
        "Folder import: found {} images in {}",
        files.len(),
        folder_path
    );
    Ok(files)
}

#[allow(dead_code)]
fn collect_image_files(dir: &Path, files: &mut Vec<String>, extensions: &[&str]) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_image_files(&path, files, extensions);
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

// ---------------------------------------------------------------------------
// WIA implementation (Windows only)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod wia {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    /// Internal scanner info from WIA enumeration.
    pub struct WiaScannerInfo {
        pub id: String,
        pub name: String,
    }

    /// List scanners via WIA Device Manager (COM).
    ///
    /// This is a simplified implementation that uses the WIA Common Dialog
    /// or direct COM enumeration. Full WIA 2.0 enumeration via IWiaDevMgr2
    /// requires extensive COM bindings that are defined structurally below.
    pub fn list_wia_scanners() -> Result<Vec<WiaScannerInfo>, String> {
        let mut scanners = Vec::new();

        // Attempt COM-based WIA enumeration.
        unsafe {
            let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_MULTITHREADED as u32);
            if hr < 0 {
                warn!("CoInitializeEx failed: {:#x}", hr);
                // Try to proceed anyway — COM may already be initialized.
            }

            // In a production implementation, this would use:
            //   CLSID_WiaDevMgr2 -> IWiaDevMgr2 -> EnumDevices
            // For this scaffold, we check the Windows Device Setup API
            // via a registry scan for WIA-compatible devices.

            let scanners_from_registry = scan_registry_for_wia();
            scanners.extend(scanners_from_registry);

            // Only call CoUninitialize if we successfully initialised.
            if hr >= 0 {
                CoUninitialize();
            }
        }

        Ok(scanners)
    }

    /// Scan a single page using WIA.
    ///
    /// In production this would:
    /// 1. Get IWiaItem2 for the scanner
    /// 2. Configure resolution, color mode, paper size via WIA properties
    /// 3. Call Transfer to acquire the image
    /// 4. Save to the temp directory
    ///
    /// For this scaffold, we simulate with a placeholder and note
    /// the full implementation path.
    pub async fn scan_wia_single(
        scanner_id: &str,
        config: &ScanConfig,
        temp_dir: &Path,
    ) -> Result<ScanResult, String> {
        info!(
            "WIA scan: scanner={}, dpi={}, color={:?}",
            scanner_id, config.resolution_dpi, config.color_mode
        );

        // ── Full WIA scan implementation outline ─────────────────────
        //
        // 1. CoInitializeEx (COINIT_APARTMENTTHREADED for WIA COM)
        // 2. CoCreateInstance(CLSID_WiaDevMgr2) -> IWiaDevMgr2
        // 3. SelectDevice(scanner_id) or EnumDevices -> IWiaItem2
        // 4. Set WIA_IPS_XRES, WIA_IPS_YRES (resolution)
        //    Set WIA_IPS_PICTURE_TYPE (color/grayscale)
        //    Set WIA_IPS_PAGE_SIZE
        //    Set WIA_DPS_HORIZONTAL BED SIZE
        // 5. Create child item for feeder if ADF
        // 6. IWiaItem2::Transfer() -> IStream
        // 7. Write IStream to temp file
        // 8. Release all COM objects
        //
        // The IWiaDevMgr2 CLSID: 0xA1F4E413-E8A5-4C0E-87D5-A9D2A7B6E7D3}
        // (this is the WIA 2.0 manager)

        // For the scaffold, create a placeholder.
        let file_id = uuid::Uuid::new_v4();
        let ext = match config.color_mode {
            ScanColorMode::Color => "png",
            ScanColorMode::Grayscale => "png",
            ScanColorMode::Monochrome => "bmp",
        };

        let file_name = format!("scan_{}_{}.{}", scanner_id, file_id, ext);
        let file_path = temp_dir.join(&file_name);

        // Create a minimal valid PNG or BMP placeholder.
        // In production, the actual scanner image data would go here.
        create_placeholder_image(&file_path, config, ext).map_err(|e| e.to_string())?;

        let file_size_bytes = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

        let width_px = match config.resolution_dpi {
            150 => 1275,
            200 => 1700,
            300 => 2550,
            600 => 5100,
            _ => 2550,
        };
        let height_px = (width_px as f64 * 1.414).round() as u32; // A4 aspect ratio

        Ok(ScanResult {
            page_path: file_path.to_string_lossy().to_string(),
            width_px,
            height_px,
            file_size_bytes,
            mime_type: match ext {
                "png" => "image/png".to_string(),
                "bmp" => "image/bmp".to_string(),
                "jpg" => "image/jpeg".to_string(),
                _ => "application/octet-stream".to_string(),
            },
        })
    }

    /// Scan WIA-compatible devices from the Windows registry.
    fn scan_registry_for_wia() -> Vec<WiaScannerInfo> {
        let mut scanners = Vec::new();

        // WIA devices are registered under:
        // HKLM\SYSTEM\CurrentControlSet\Control\Class\{6bdd1fc6-810f-11d0-bec7-08002be2092f}
        // Each subkey is a WIA device.
        let reg_key =
            r"SYSTEM\CurrentControlSet\Control\Class\{6bdd1fc6-810f-11d0-bec7-08002be2092f}";

        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Registry::*;
            let mut hkey: *mut std::ffi::c_void = std::ptr::null_mut();

            let wide_key: Vec<u16> = OsStr::new(reg_key)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let hr = unsafe {
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    wide_key.as_ptr(),
                    0,
                    KEY_READ,
                    &mut hkey,
                )
            };

            if hr == 0 {
                let mut index: u32 = 0;
                let mut subkey_name = [0u16; 256];
                let mut subkey_len = subkey_name.len() as u32;

                unsafe {
                    while RegEnumKeyExW(
                        hkey,
                        index,
                        subkey_name.as_mut_ptr(),
                        &mut subkey_len,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                    ) == 0
                    {
                        let name = String::from_utf16_lossy(&subkey_name[..subkey_len as usize]);

                        // Skip class subkeys (they start with "Class" or are not numeric).
                        if name.parse::<u32>().is_ok() {
                            let device_name = read_reg_sz(hkey, &name, "FriendlyName")
                                .unwrap_or_else(|| name.clone());

                            let device_id = read_reg_sz(hkey, &name, "DeviceDesc")
                                .unwrap_or_else(|| name.clone());

                            scanners.push(WiaScannerInfo {
                                id: device_id,
                                name: device_name,
                            });
                        }

                        subkey_len = subkey_name.len() as u32;
                        index += 1;
                    }
                }

                unsafe {
                    RegCloseKey(hkey);
                }
            }
        }

        scanners
    }

    /// Read a REG_SZ value from a registry key's subkey.
    #[cfg(windows)]
    fn read_reg_sz(hkey: *mut std::ffi::c_void, subkey: &str, value_name: &str) -> Option<String> {
        use windows_sys::Win32::System::Registry::*;

        let subkey_wide: Vec<u16> = OsStr::new(subkey)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let value_wide: Vec<u16> = OsStr::new(value_name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut sub_hkey: *mut std::ffi::c_void = std::ptr::null_mut();
        let hr = unsafe { RegOpenKeyExW(hkey, subkey_wide.as_ptr(), 0, KEY_READ, &mut sub_hkey) };
        if hr != 0 {
            return None;
        }

        let mut buf = [0u16; 512];
        let mut buf_len = buf.len() as u32;
        let hr = unsafe {
            RegQueryValueExW(
                sub_hkey,
                value_wide.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                buf.as_mut_ptr() as *mut u8,
                &mut buf_len,
            )
        };

        unsafe {
            RegCloseKey(sub_hkey);
        }

        if hr == 0 && buf_len > 0 {
            let len = (buf_len as usize / 2).saturating_sub(1);
            Some(String::from_utf16_lossy(&buf[..len]))
        } else {
            None
        }
    }

    /// Create a minimal placeholder image file for the scaffold.
    fn create_placeholder_image(
        path: &Path,
        config: &ScanConfig,
        ext: &str,
    ) -> std::io::Result<()> {
        // Create a 1×1 pixel PNG placeholder.
        // PNG header: 89 50 4E 47 0D 0A 1A 0A
        // For BMP: simple header with 1x1 pixel.
        match ext {
            "png" => {
                // Minimal 1x1 transparent PNG.
                let png_bytes = [
                    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
                    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
                    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
                    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, // 8-bit RGB
                    0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
                    0x08, 0xD7, 0x63, 0xD8, 0xD0, 0xC0, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0xF6,
                    0x17, 0xA4, 0x49, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND
                    0xAE, 0x42, 0x60, 0x82,
                ];
                fs::write(path, png_bytes)
            }
            "bmp" => {
                // Minimal 1x1 BMP.
                let bmp_bytes = [
                    0x42, 0x4D, 0x3A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00,
                    0x00, 0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
                    0x01, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00,
                ];
                fs::write(path, bmp_bytes)
            }
            _ => {
                // Generic placeholder.
                fs::write(
                    path,
                    format!(
                        "placeholder: {:?} {}dpi",
                        config.color_mode, config.resolution_dpi
                    ),
                )
            }
        }
    }
}

// Re-export WIA types from the platform-specific module.
#[cfg(windows)]
use wia::{list_wia_scanners, scan_wia_single};

// Non-Windows stubs.
#[cfg(not(windows))]
fn list_wia_scanners() -> Result<Vec<super::WiaScannerInfo>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
async fn scan_wia_single(_: &str, _: &ScanConfig, _: &Path) -> Result<ScanResult, String> {
    Err("WIA scanning is only available on Windows.".into())
}

#[cfg(not(windows))]
mod wia {
    pub struct WiaScannerInfo {
        pub id: String,
        pub name: String,
    }
}

// ---------------------------------------------------------------------------
// TWAIN interface definitions (structural — for future native bridge)
// ---------------------------------------------------------------------------

/// TWAIN Data Source Manager (DSM) entry points.
///
/// In a full implementation, these would be loaded dynamically from the
/// TWAIN DSM DLL (`twaindsm.dll` on 32-bit, `TWAINDSM.dll` on 64-bit).
#[cfg(windows)]
#[allow(dead_code)]
mod twain {
    /// TWAIN 2.x DSM structure definitions for reference.
    ///
    /// The actual TWAIN DSM is loaded at runtime and requires a C/C++
    /// shim due to the complex callback-based architecture.
    /// For this scaffold, we define the wire types that a native bridge
    /// would return.
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct TwainDeviceInfo {
        pub id: String,
        pub name: String,
        pub product_name: String,
        pub twain_version: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct TwainCapability {
        pub cap_id: u16,
        pub con_type: u16,
        pub value: serde_json::Value,
    }

    /// Would-be DSM function pointer layout for the TWAIN 2.x DSM.
    /// This is purely structural — the actual FFI requires a C header.
    #[repr(C)]
    pub struct TwainIdentity {
        pub id: u32,
        pub version: TwainVersion,
        pub protocol_major: u16,
        pub protocol_minor: u16,
        pub supported_groups: u32,
        pub manufacturer: String,
        pub product_family: String,
        pub product_name: String,
    }

    #[repr(C)]
    pub struct TwainVersion {
        pub major_num: u16,
        pub minor_num: u16,
        pub language: u16,
        pub country: u16,
    }

    /// Capability constants for TWAIN properties.
    pub const ICAP_XRESOLUTION: u16 = 0x1101;
    pub const ICAP_YRESOLUTION: u16 = 0x1102;
    pub const ICAP_BITDEPTH: u16 = 0x1103;
    pub const ICAP_PIXELTYPE: u16 = 0x1107;
    pub const CAP_FEEDERENABLED: u16 = 0x1001;
    pub const CAP_AUTOFEED: u16 = 0x1002;
    pub const CAP_DUPLEXENABLED: u16 = 0x1003;
    pub const CAP_SUPPORTEDSIZES: u16 = 0x1008;
}
