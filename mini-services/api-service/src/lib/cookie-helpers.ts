/**
 * MediVault Fastify — Cookie Helpers
 *
 * Provides cookie setting and clearing utilities for auth tokens.
 * All cookies follow security best practices:
 * - HttpOnly for auth cookies (not for CSRF cookie)
 * - SameSite=Lax
 * - Secure flag in production
 * - Path=/
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { shouldUseSecureCookies } from './https-enforcement.js'

/**
 * Set auth cookies on the response.
 * Sets mvlt_session (access token, HttpOnly), mvlt_refresh (refresh token, HttpOnly),
 * and mvlt_csrf (CSRF token, NOT HttpOnly — must be readable by JavaScript).
 *
 * @param reply - Fastify reply object
 * @param accessToken - JWT access token
 * @param refreshToken - Refresh token
 * @param csrfToken - CSRF token
 * @param expiresIn - Access token expiry in seconds
 * @param secure - Override secure flag (defaults to shouldUseSecureCookies())
 */
export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  csrfToken: string,
  expiresIn: number,
  secure?: boolean,
): void {
  const useSecure = secure ?? shouldUseSecureCookies()
  const secureFlag = useSecure ? '; Secure' : ''

  // Each cookie as its OWN Set-Cookie header: Fastify stores the array and
  // Node serializes it as three separate headers. (First-red fix of run
  // 34237523921: the previous comma-joined single header is parsed by every
  // real HTTP client — browsers, curl — as ONE cookie, so mvlt_refresh and
  // mvlt_csrf were never actually delivered over the wire; only the
  // test-suite's lenient ', ' splitting masked it. SameSite=Lax values
  // never contain ', ', so the test helpers that join+split keep working.)
  reply.header('Set-Cookie', [
    `mvlt_session=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expiresIn}${secureFlag}`,
    `mvlt_refresh=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${48 * 60 * 60}${secureFlag}`,
    `mvlt_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=${expiresIn}${secureFlag}`,
  ])
}

/**
 * Clear all auth cookies by setting Max-Age=0.
 */
export function clearAuthCookies(reply: FastifyReply): void {
  const secure = shouldUseSecureCookies()
  const secureFlag = secure ? '; Secure' : ''

  // Same first-red fix as setAuthCookies: separate Set-Cookie headers, one
  // per cleared cookie, so every real client honors all three Max-Age=0.
  reply.header('Set-Cookie', [
    `mvlt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    `mvlt_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    `mvlt_csrf=; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`,
  ])
}

/**
 * Get a cookie value from the request.
 */
export function getCookieValue(request: FastifyRequest, name: string): string | undefined {
  return request.cookies[name] as string | undefined
}
