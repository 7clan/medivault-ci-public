/**
 * MediVault — Authorization Middleware Helpers
 *
 * Provides require* functions and withAuth HOF for API routes.
 * Supports both cookie-based (browser) and Bearer-token (mobile/API) transport.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession, type AuthSession } from './auth-helpers'
import { getUserPermissions, getUserRoleName } from './auth-service'
import { validateCsrf, corsHeaders } from './csrf'
import {
  hasPermission as checkPerm,
  hasAnyPermission as checkAnyPerm,
  hasRole as checkRoleMatch,
  AuthorizationError,
  AuthenticationError,
  MustChangePasswordError,
} from '@medivault/auth'
import type { AuthError } from '@medivault/auth'

/**
 * Routes that are allowed when mustChangePassword is true.
 * Everything else returns 403 until the password is changed.
 */
const FORCED_PW_CHANGE_ALLOWLIST = new Set([
  'GET /api/auth/me',
  'PUT /api/auth/password',
  'POST /api/auth/logout',
  'POST /api/auth/sessions/revoke-all',
])

/**
 * Require an authenticated session. Throws AuthenticationError if not logged in.
 * Also checks mustChangePassword and throws MustChangePasswordError if needed
 * (unless the route is in the forced-password-change allowlist).
 */
export async function requireAuthentication(req?: NextRequest): Promise<AuthSession> {
  const session = await getAuthSession(req)
  if (!session) {
    throw new AuthenticationError('Authentication required')
  }
  if (session.user.mustChangePassword && req) {
    const routeKey = `${req.method} ${req.nextUrl.pathname}`
    if (!FORCED_PW_CHANGE_ALLOWLIST.has(routeKey)) {
      throw new MustChangePasswordError('Password change required before accessing this resource')
    }
  }
  return session
}

/**
 * Require authentication but allow users with mustChangePassword (for the password change endpoint itself).
 */
export async function requireAuthenticationAllowForcedChange(req?: NextRequest): Promise<AuthSession> {
  const session = await getAuthSession(req)
  if (!session) {
    throw new AuthenticationError('Authentication required')
  }
  return session
}

/**
 * Require a specific permission.
 */
export async function requirePermission(session: AuthSession, permission: string): Promise<void> {
  const userPermissions = await getUserPermissions(session.user.id)
  if (!checkPerm(userPermissions, permission)) {
    throw new AuthorizationError(`Missing required permission: ${permission}`)
  }
}

/**
 * Require at least one of the listed permissions.
 */
export async function requireAnyPermission(session: AuthSession, permissions: string[]): Promise<void> {
  const userPermissions = await getUserPermissions(session.user.id)
  if (!checkAnyPerm(userPermissions, permissions)) {
    throw new AuthorizationError(`Missing required permissions: ${permissions.join(', ')}`)
  }
}

/**
 * Require a specific role name.
 */
export async function requireRole(session: AuthSession, role: string): Promise<void> {
  const userRoleName = await getUserRoleName(session.user.id)
  if (!checkRoleMatch(userRoleName, role)) {
    throw new AuthorizationError(`Missing required role: ${role}`)
  }
}

/**
 * Require an active device registration.
 */
export async function requireActiveDevice(session: AuthSession, deviceId: string): Promise<void> {
  const { db } = await import('./db')
  const device = await db.deviceRegistration.findFirst({
    where: { id: deviceId, userId: session.user.id, isActive: true },
  })
  if (!device) {
    throw new AuthorizationError('Device not found or inactive')
  }
}

/**
 * Map an AuthError to a NextResponse with the correct status code.
 */
export function authErrorToResponse(error: unknown): NextResponse {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const authErr = error as AuthError
    const body: Record<string, unknown> = { error: authErr.message }

    if ('retryAfterMs' in authErr && typeof (authErr as { retryAfterMs: unknown }).retryAfterMs === 'number') {
      body.retryAfterMs = (authErr as { retryAfterMs: number }).retryAfterMs
    }

    return NextResponse.json(body, { status: authErr.statusCode })
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Handler function type for withAuth.
 */
type AuthenticatedHandler = (
  req: NextRequest,
  session: AuthSession,
  params?: Record<string, string>,
) => Promise<NextResponse> | NextResponse

/**
 * Apply CORS headers to a successful response if the Origin is allowed.
 */
function applyCors(request: NextRequest, response: NextResponse): NextResponse {
  const headers = corsHeaders(request)
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}

/**
 * Higher-order function that wraps an API route handler with authentication, CSRF, and error mapping.
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      validateCsrf(req)
      const session = await requireAuthentication(req)
      const params = ctx?.params ? await ctx.params : undefined
      const response = await handler(req, session, params)
      return applyCors(req, response)
    } catch (error) {
      return authErrorToResponse(error)
    }
  }
}

/**
 * Like withAuth but skips mustChangePassword check (for the password change endpoint).
 */
export function withAuthAllowForcedChange(handler: AuthenticatedHandler) {
  return async (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      validateCsrf(req)
      const session = await requireAuthenticationAllowForcedChange(req)
      const params = ctx?.params ? await ctx.params : undefined
      const response = await handler(req, session, params)
      return applyCors(req, response)
    } catch (error) {
      return authErrorToResponse(error)
    }
  }
}
