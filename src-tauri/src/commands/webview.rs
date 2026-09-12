//! Backend hand-off — navigate the main webview to the local API origin.
//!
//! FIRST-RUN FIX (PFT run 34693988598, after F9): the first-run screen's
//! JS-initiated `window.location.replace('http://127.0.0.1:3001/')` left
//! the WKWebView BLANK — the webview's own `fetch` to the same origin
//! worked (that is how the health wait advanced), and the same page
//! renders correctly in a real browser against the same API, but the
//! cross-scheme JS navigation produced an empty document. The hand-off
//! therefore navigates from the RUST side (`WebviewWindow::navigate` →
//! wry's `load_url` → `[WKWebView loadRequest:]`) — a different
//! initiation path than a JS-initiated location change.
//!
//! SECURITY: the command is LOOPBACK-ONLY by construction. An
//! IPC-initiated navigation to an arbitrary URL would let any injected
//! script turn the window into a browser — the target must be plain
//! `http` on a loopback host (127.0.0.1 / localhost / ::1), exactly the
//! local API origin the shipped supervisor serves. Everything else is
//! rejected fail-closed (unit-tested below).
//!
//! NOTE for callers: a successful navigation destroys the calling page's
//! JS context, so the invoke promise never resolves — call it fire and
//! forget and keep a visible anchor fallback for non-desktop contexts.

use tauri::Manager;

/// Validate a hand-off target: plain http on a loopback host (any port).
/// Pure function — unit-tested below.
pub fn is_loopback_http_url(raw: &str) -> bool {
    let parsed = match tauri::Url::parse(raw) {
        Ok(u) => u,
        Err(_) => return false,
    };
    parsed.scheme() == "http"
        && matches!(
            parsed.host_str(),
            // Both IPv6 spellings: url::Url::host_str may serialize the
            // brackets or not depending on the exact slice — accept both.
            Some("127.0.0.1") | Some("localhost") | Some("::1") | Some("[::1]")
        )
}

/// Navigate the main webview to the LOCAL backend origin (the first-run
/// hand-off: the API-served frontend, same origin as every relative
/// `/api/*` call the authenticated app makes).
#[tauri::command]
pub async fn navigate_to_local_backend(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    log::info!("navigate_to_local_backend: invoke received (url={url})");
    if !is_loopback_http_url(&url) {
        return Err(format!(
            "refusing to navigate to non-loopback URL {url:?} — the hand-off target must be the local API origin (plain http on a loopback host)"
        ));
    }
    let parsed = tauri::Url::parse(&url)
        .map_err(|e| format!("invalid hand-off URL: {e}"))?;
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "the main window is not available".to_string())?;
    log::info!(
        "navigate_to_local_backend: navigating the main webview to {parsed}"
    );
    webview
        .navigate(parsed)
        .map_err(|e| format!("navigation failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_loopback_http_url;

    #[test]
    fn accepts_exactly_the_local_api_origin_shapes() {
        for good in [
            "http://127.0.0.1:3001",
            "http://127.0.0.1:3001/",
            "http://127.0.0.1:8123/app",
            "http://localhost:3001/",
            "http://[::1]:3001/",
        ] {
            assert!(is_loopback_http_url(good), "must accept {good:?}");
        }
    }

    #[test]
    fn rejects_everything_else_fail_closed() {
        for bad in [
            "https://127.0.0.1:3001",           // TLS — not the local API shape
            "http://0.0.0.0:3001",               // wildcard bind host — never a target
            "http://192.168.1.5:3001",           // LAN
            "http://example.com",                // internet
            "https://example.com/redirect",      // internet + TLS
            "tauri://localhost",                 // the app origin itself
            "file:///etc/passwd",                // local files
            "javascript:alert(1)",               // script URL
            "data:text/html,<script>",           // data URL
            "",                                  // empty
            "not a url",
            "http://",                           // no host
        ] {
            assert!(!is_loopback_http_url(bad), "must reject {bad:?}");
        }
    }
}
