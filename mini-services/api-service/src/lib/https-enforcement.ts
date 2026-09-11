/**
 * MediVault Fastify — HTTPS Enforcement
 *
 * Provides helpers for HTTPS/TLS configuration in production.
 * All cookie-setting code MUST use shouldUseSecureCookies() instead of
 * inline `process.env.NODE_ENV === 'production'` checks.
 *
 * Model A — localhost-security contract (approved 2026-09-08):
 * - `MEDIVAULT_LOCALHOST_ONLY=true` (injected ONLY by the macOS desktop
 *   supervisor, which itself fails closed on any non-loopback bind host)
 *   enables the NARROWLY SCOPED desktop-local production mode: production
 *   loopback HTTP is permitted WHEN — and only when — every desktop-local
 *   condition holds. Any unsafe combination (non-loopback host, trusted
 *   TLS termination, direct HTTPS, wildcard/non-local Origin allowlist)
 *   fails closed at startup. This NEVER weakens general production HTTPS
 *   enforcement: deployments that do not set the variable keep the exact
 *   previous behavior (Windows behind its trusted local TLS terminator).
 * - No TLS terminator exists in the desktop-local architecture, so
 *   `TRUSTED_LOCAL_TLS_TERMINATION=true` is forbidden in this mode and
 *   forwarded headers are never trusted (trustProxy = false).
 */

/**
 * Enforce production HTTPS configuration.
 * Call this during server startup.
 *
 * In production, fails fast (throws) if TLS requirements are not met.
 * - `HTTPS=true` signals the server terminates TLS directly.
 * - `NEXT_PUBLIC_BASE_URL=https://...` signals TLS is expected upstream.
 * - `TRUSTED_LOCAL_TLS_TERMINATION=true` allows production without
 *   direct TLS when behind a trusted local TLS-terminating proxy
 *   (e.g., Caddy on the same machine).
 * - `MEDIVAULT_LOCALHOST_ONLY=true` (desktop supervisor only) allows the
 *   Model A desktop-local production mode — loopback-only, no proxy, no
 *   TLS terminator — after proving every safe condition
 *   ([`assertLocalhostProductionSafety`]).
 */
export function enforceHttpsConfig(): void {
  if (process.env.NODE_ENV !== 'production') return

  // Model A: the desktop-local production mode — permitted only after
  // every safe condition is proven; assertLocalhostProductionSafety
  // throws (fail closed) on any unsafe combination.
  if (isLocalhostProductionMode()) {
    assertLocalhostProductionSafety()
    return
  }

  const hasExplicitHttps =
    process.env.HTTPS === 'true' ||
    process.env.NEXT_PUBLIC_BASE_URL?.startsWith('https')

  const isTrustedLocalTlsTermination =
    process.env.TRUSTED_LOCAL_TLS_TERMINATION === 'true'

  if (!hasExplicitHttps && !isTrustedLocalTlsTermination) {
    throw new Error(
      '[MediVault] FATAL: Running in production without explicit HTTPS configuration. ' +
      'Set HTTPS=true or NEXT_PUBLIC_BASE_URL=https://... in production, ' +
      'or set TRUSTED_LOCAL_TLS_TERMINATION=true if behind a trusted local TLS-terminating proxy.',
    )
  }
}

/** Whether the Model A desktop-local production mode is active. */
export function isLocalhostProductionMode(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.MEDIVAULT_LOCALHOST_ONLY === 'true'
  )
}

/** Bind hosts that are loopback (the only hosts Model A may bind). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function isLoopbackHost(host: string | undefined): boolean {
  return (
    typeof host === 'string' &&
    LOOPBACK_HOSTS.has(host.trim().toLowerCase())
  )
}

/**
 * Whether an Origin allowlist entry is a LOCAL origin: the desktop
 * webview custom-scheme origin (`tauri://localhost`) or an http(s)
 * origin whose host is loopback.
 */
function isLocalOrigin(origin: string): boolean {
  if (/^tauri:\/\/localhost$/i.test(origin)) return true
  const web = /^https?:\/\/([^/:]+)(?::\d+)?$/i.exec(origin)
  return !!web && LOOPBACK_HOSTS.has(web[1].toLowerCase())
}

/**
 * Startup safety gate for the Model A desktop-local production mode.
 * Fails closed (throws) on EVERY unsafe combination of the local mode
 * with:
 *  - a non-loopback bind host (`0.0.0.0`, `::`, LAN/interface addresses);
 *  - trusted local TLS termination (no TLS terminator exists to trust);
 *  - direct HTTPS termination (contradicts the desktop-local transport);
 *  - an unexpected Origin policy (missing, wildcard, or non-local
 *    origins in ALLOWED_ORIGINS).
 */
export function assertLocalhostProductionSafety(): void {
  const must = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new Error(`[MediVault] FATAL (localhost-production mode): ${message}`)
    }
  }

  must(
    isLoopbackHost(process.env.HOST),
    `the bind host must be loopback (127.0.0.1, ::1 or localhost) — got '${process.env.HOST ?? '(unset)'}'.`,
  )

  must(
    process.env.TRUSTED_LOCAL_TLS_TERMINATION !== 'true',
    'TRUSTED_LOCAL_TLS_TERMINATION=true is forbidden — no TLS terminator exists in the desktop-local architecture (Model A contract).',
  )

  must(
    process.env.HTTPS !== 'true',
    'HTTPS=true contradicts the desktop-local plain-loopback transport — remove it or unset MEDIVAULT_LOCALHOST_ONLY.',
  )

  const rawOrigins = process.env.ALLOWED_ORIGINS
  must(
    typeof rawOrigins === 'string' && rawOrigins.trim() !== '',
    'ALLOWED_ORIGINS must be an explicit, minimal allowlist in localhost-production mode.',
  )
  const origins = (rawOrigins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  must(
    origins.length > 0 && !origins.includes('*'),
    'ALLOWED_ORIGINS must not be empty or wildcard in localhost-production mode.',
  )
  for (const origin of origins) {
    must(
      isLocalOrigin(origin),
      `ALLOWED_ORIGINS entry '${origin}' is not a local origin — only the desktop webview origin (tauri://localhost) and loopback web origins are permitted in localhost-production mode.`,
    )
  }
}

/**
 * Fastify trustProxy decision. Under the Model A desktop-local
 * production mode there is NO proxy: X-Forwarded-* headers are never
 * trusted. All other paths keep their exact previous behavior
 * (development loopback trust; production trusted-termination loopback
 * trust for deployments behind a REAL TLS-terminating proxy).
 */
export function shouldTrustProxy(): boolean | string {
  if (process.env.NODE_ENV !== 'production') return '127.0.0.1'
  if (isLocalhostProductionMode()) return false
  if (process.env.TRUSTED_LOCAL_TLS_TERMINATION === 'true') return '127.0.0.1'
  return false
}

/**
 * Whether cookies should use the Secure flag
 *
 * Model A (localhost-production) is the ONE documented exception: the
 * desktop-local transport is plain loopback HTTP BY DESIGN (no TLS
 * terminator exists — see the contract). The `Secure` attribute there
 * adds no security (the bind is loopback-only and Origin-allowlisted)
 * but DOES prevent the webview from storing the cookie at all — WebKit
 * refuses `Secure` cookies over plain HTTP. The localhost-security
 * contract §8 itself flagged this exact contradiction ("NODE_ENV=production
 * forces Secure") as an unresolved interactive proof item; first-run
 * authentication is impossible with it. Every other deployment (Windows
 * trusted TLS termination, general production) keeps the exact previous
 * behavior.
 */
export function shouldUseSecureCookies(): boolean {
  if (isLocalhostProductionMode()) return false
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TRUSTED_LOCAL_TLS_TERMINATION === 'true'
  )
}
