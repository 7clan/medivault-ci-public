/**
 * MediVault Fastify — HTTPS Enforcement
 *
 * Provides helpers for HTTPS/TLS configuration in production.
 * All cookie-setting code MUST use shouldUseSecureCookies() instead of
 * inline `process.env.NODE_ENV === 'production'` checks.
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
 */
export function enforceHttpsConfig(): void {
  if (process.env.NODE_ENV !== 'production') return

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

/** Whether cookies should use the Secure flag */
export function shouldUseSecureCookies(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TRUSTED_LOCAL_TLS_TERMINATION === 'true'
  )
}
