/**
 * MediVault — Auth Helpers
 *
 * Provides the getAuthSession() interface for API routes.
 * Supports two transport modes:
 * 1. Browser: reads access token from httpOnly cookie (mvlt_session)
 * 2. Mobile/API: reads access token from Authorization: Bearer header
 *
 * Validation checks (every request):
 * 1. Token exists (cookie or Bearer header)
 * 2. AUTH_JWT_SECRET exists (no fallback)
 * 3. JWT signature, expiration, issuer, audience, algorithm (HS256)
 * 4. User exists in DB
 * 5. User.isActive is true
 * 6. Token sessionVersion matches DB user.sessionVersion
 * 7. If token has deviceId: device exists, belongs to user, is active
 * 8. If token has familyId: family is not revoked (no unrevoked tokens exist)
 * 9. If token has sessionId: AuthSession exists, not revoked, not expired, user matches, device matches if device-bound, family matches
 * 10. Update AuthSession.lastSeenAt on successful validation
 */

import { cookies } from 'next/headers'
import { verifyAccessToken, type AccessTokenPayload } from '@medivault/auth'
import { db } from './db'

/** In-memory throttle map: sessionId -> last DB write timestamp */
const lastSeenAtCache = new Map<string, number>()
const LAST_SEEN_AT_THROTTLE_MS = 300_000 // 5 minutes

/** Test-only: clear the lastSeenAt throttle cache */
export function _resetLastSeenAtCache(): void {
  lastSeenAtCache.clear()
}

export interface AuthSession {
  user: {
    id: string
    name: string
    email: string
    roleId: string | null
    isActive: boolean
    mustChangePassword: boolean
    sessionVersion: number
  }
  deviceId: string | null
  familyId: string | null
  sessionId: string | null
}

/**
 * Get the current authenticated session in App Router API routes.
 * Supports both cookie-based (browser) and Bearer-token (mobile/API) transport.
 */
export async function getAuthSession(request?: { headers: { get: (name: string) => string | null } }): Promise<AuthSession | null> {
  // Determine transport: cookie or Bearer header
  let token: string | null = null
  let isBearerTransport = false

  if (request) {
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
      isBearerTransport = true
    }
  }

  if (!token) {
    try {
      const cookieStore = await cookies()
      token = cookieStore.get('mvlt_session')?.value ?? null
    } catch {
      return null
    }
  }

  if (!token) return null

  const secret = process.env.AUTH_JWT_SECRET
  if (!secret) return null

  try {
    const payload: AccessTokenPayload = await verifyAccessToken(token, secret)

    // Validate user exists and is active in the database
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        isActive: true,
        mustChangePassword: true,
        sessionVersion: true,
      },
    })

    if (!user) return null
    if (!user.isActive) return null

    // Session version mismatch means session was invalidated
    if (user.sessionVersion !== payload.sessionVersion) return null

    // If token is device-bound, validate the device
    if (payload.deviceId) {
      const device = await db.deviceRegistration.findFirst({
        where: { id: payload.deviceId, userId: payload.sub, isActive: true },
        select: { id: true },
      })
      if (!device) return null
    }

    // If token has a family ID, check that the family is not fully revoked
    if (payload.familyId) {
      const hasActiveToken = await db.refreshToken.count({
        where: {
          familyId: payload.familyId,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
      // If no active tokens remain in the family, reject the access token
      if (hasActiveToken === 0) return null
    }

    // If token has a sessionId, validate the AuthSession record
    if (payload.sessionId) {
      const authSession = await db.authSession.findUnique({
        where: { id: payload.sessionId },
      })

      if (!authSession) return null
      if (authSession.revokedAt) return null
      if (authSession.expiresAt <= new Date()) return null
      if (authSession.userId !== payload.sub) return null
      // If device-bound session, verify device matches
      if (authSession.deviceId && payload.deviceId && authSession.deviceId !== payload.deviceId) return null
      // If family-bound session, verify family matches
      if (payload.familyId && authSession.familyId !== payload.familyId) return null

      // Update lastSeenAt on successful validation (throttled: max once per 5 min per session)
      const now = Date.now()
      const lastUpdate = lastSeenAtCache.get(authSession.id)
      if (lastUpdate === undefined || now - lastUpdate >= LAST_SEEN_AT_THROTTLE_MS) {
        lastSeenAtCache.set(authSession.id, now)
        db.authSession.update({
          where: { id: authSession.id },
          data: { lastSeenAt: new Date() },
        }).catch(() => { /* best-effort */ })
      }
    }

    return {
      user: {
        id: user.id,
        name: payload.name,
        email: payload.email,
        roleId: payload.roleId,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        sessionVersion: user.sessionVersion,
      },
      deviceId: payload.deviceId,
      familyId: payload.familyId,
      sessionId: payload.sessionId,
    }
  } catch {
    return null
  }
}
