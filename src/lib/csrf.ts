/**
 * MediVault — CSRF Protection
 *
 * Browser authentication (cookies):
 * - CSRF tokens are issued as a separate non-HttpOnly cookie (mvlt_csrf).
 * - Mutating requests (POST, PUT, PATCH, DELETE) must include the token
 *   in a header (x-csrf-token) or request body field (_csrf).
 * - The cookie value is compared with the header value using timing-safe comparison.
 * - Origin validation is always performed for state-changing requests.
 *   Host-only fallback is NOT allowed; Origin header is REQUIRED.
 *
 * Mobile authentication uses separate endpoints (/api/auth/mobile/*) and
 * does NOT use CSRF tokens. Browser and mobile flows are fully separated.
 */

import { NextRequest } from 'next/server'
import { verifyCsrfToken, CsrfError } from '@medivault/auth'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Get allowed origins from environment.
 * In development, localhost is always allowed.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (!envOrigins) return ['http://localhost:3000']
  return envOrigins.split(',').map((o) => o.trim())
}

/**
 * Validate Origin header for state-changing requests.
 * Origin is REQUIRED — Host-only fallback is NOT allowed.
 */
export function validateOriginHost(request: NextRequest): void {
  const origin = request.headers.get('origin')
  const allowedOrigins = getAllowedOrigins()

  if (!origin) {
    throw new CsrfError('Origin header is required')
  }

  if (!allowedOrigins.includes(origin)) {
    throw new CsrfError('Origin not allowed')
  }
}

/**
 * Validate CSRF token for mutating requests.
 *
 * For ALL mutating requests:
 * 1. Require a valid Origin header that matches ALLOWED_ORIGINS
 * 2. Reject if Origin is absent (no Host-only fallback)
 * 3. Require a valid CSRF token (x-csrf-token header matching mvlt_csrf cookie)
 * 4. Reject mixed cookie-plus-Bearer attempts
 * 5. Reject Sec-Fetch-Mode: navigate on mutating endpoints
 */
export function validateCsrf(request: NextRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return

  // 1. Reject mixed authentication transport
  const hasSessionCookie = !!request.cookies.get('mvlt_session')
  const authHeader = request.headers.get('authorization')
  const hasBearer = !!authHeader?.startsWith('Bearer ')
  if (hasSessionCookie && hasBearer) {
    throw new CsrfError('Mixed authentication transport not allowed')
  }

  // 2. Validate Origin (required, no Host fallback)
  validateOriginHost(request)

  // 3. Fetch Metadata check
  const secFetchMode = request.headers.get('sec-fetch-mode')
  if (secFetchMode && secFetchMode === 'navigate') {
    throw new CsrfError('Navigate mode not allowed for mutating requests')
  }

  // 4. Validate CSRF token
  const cookieCsrf = request.cookies.get('mvlt_csrf')?.value
  if (!cookieCsrf) {
    throw new CsrfError('CSRF cookie missing')
  }

  const headerCsrf = request.headers.get('x-csrf-token')
  if (!headerCsrf) {
    throw new CsrfError('CSRF token missing')
  }

  if (!verifyCsrfToken(cookieCsrf, headerCsrf)) {
    throw new CsrfError('CSRF token mismatch')
  }
}

/**
 * Generate a CSRF token.
 * This should be called when issuing access tokens (login, refresh, setup).
 */
export { generateCsrfToken as csrfCookieValue } from '@medivault/auth'

/**
 * Build CORS headers for a given request.
 * Only includes headers if the Origin is in the allowed list.
 */
export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin')
  const allowed = getAllowedOrigins()
  if (!origin || !allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Device-Id',
    'Vary': 'Origin',
  }
}
