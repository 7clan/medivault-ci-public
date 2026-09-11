'use client'

/**
 * MediVault — desktop first-run backend bridge.
 *
 * The shipped desktop app embeds the static export and serves it from the
 * Tauri custom protocol (`tauri://localhost`). On that origin relative
 * `/api/*` fetches CANNOT reach the loopback Fastify API (they resolve to
 * the asset protocol, which answers 404) — that is the D2 finding of
 * acceptance/FIRST-RUN-ROOT-CAUSE.md.
 *
 * First-run model:
 *   1. The embedded page (origin `tauri://localhost`) is the FIRST-RUN
 *      surface: it drives SMAppService registration through Tauri IPC
 *      (reusing `@/lib/desktop/api`) — no backend required.
 *   2. Once the background service is enabled and
 *      `http://127.0.0.1:3001/health` answers, the same static export is
 *      served BY the API at `http://127.0.0.1:3001/` (see the API's
 *      static-frontend plugin) — the webview navigates there and every
 *      existing relative `/api/*` call becomes same-origin.
 *
 * The loopback API base matches the shipped supervisor default
 * (`macos/supervisor/src/config.rs`, api.port = 3001) and the CSP
 * (`tauri.conf.json` allows `connect-src http://127.0.0.1:*`).
 */

/** The desktop-local API origin served by the supervisor (shipped default). */
export const DESKTOP_API_BASE = 'http://127.0.0.1:3001'

/** Bounded single health probe of the local backend. */
export async function backendHealthProbe(timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${DESKTOP_API_BASE}/health`, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

/**
 * True when running inside the Tauri webview with IPC available
 * (`__TAURI_INTERNALS__` is injected into the app's own pages only).
 */
export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * True when this page is the embedded first-run surface: the Tauri app's
 * own asset origin, where the backend is not yet reachable and the
 * onboarding gate must be shown. After the webview navigates to the
 * API-served origin this is false and the app runs normally.
 */
export function isDesktopFirstRun(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'tauri:' &&
    isTauriDesktop()
  )
}
