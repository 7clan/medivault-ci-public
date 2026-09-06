/**
 * MediVault Fastify — Authentication Middleware
 *
 * Provides session resolution and pre-handler hooks for Fastify routes.
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
 * 10. Update AuthSession.lastSeenAt on successful validation (throttled)
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { verifyAccessToken, type AccessTokenPayload } from '@medivault/auth'
import { db } from '../lib/db.js'
import { getUserPermissions } from '../lib/auth-service.js'
import { shouldUseSecureCookies } from '../lib/https-enforcement.js'
import { setAuthCookies, clearAuthCookies } from '../lib/cookie-helpers.js'
import { generateCsrfToken } from '@medivault/auth'

// ─── Types ─────────────────────────────────────────────

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

declare module 'fastify' {
  interface FastifyRequest {
    session: AuthSession | null
    isBearerTransport: boolean
  }
}

// ─── LRU Last-Seen-At Cache ────────────────────────────

/**
 * Bounded LRU cache for lastSeenAt throttle writes.
 * Prevents excessive DB writes for active sessions.
 */
export class LastSeenAtCache {
  private cache = new Map<string, number>()
  readonly maxSize: number
  readonly ttlMs: number

  constructor(maxSize = 10000, ttlMs = 300_000) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  /** Returns true if the update should proceed (cache miss or expired). */
  shouldUpdate(key: string): boolean {
    const now = Date.now()
    const lastUpdate = this.cache.get(key)
    if (lastUpdate === undefined || now - lastUpdate >= this.ttlMs) {
      this.set(key, now)
      return true
    }
    return false
  }

  private set(key: string, timestamp: number): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, timestamp)
  }

  /** Clear all entries (useful for testing). */
  clear(): void {
    this.cache.clear()
  }

  /** Current cache size. */
  get size(): number {
    return this.cache.size
  }
}

// Singleton cache instance
const lastSeenAtCache = new LastSeenAtCache(10000, 300_000)

// ─── FORCED PASSWORD CHANGE ALLOWLIST ──────────────────

/**
 * Routes that are allowed when mustChangePassword is true.
 * Everything else returns 403 until the password is changed.
 */
export const FORCED_PW_CHANGE_ALLOWLIST = new Set([
  'GET /api/auth/me',
  'PUT /api/auth/password',
  'POST /api/auth/logout',
  'POST /api/auth/sessions/revoke-all',
])

// ─── Allowed Origins ───────────────────────────────────

/**
 * Get allowed origins from environment.
 * In development, localhost is always allowed.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (!envOrigins) return ['http://localhost:3000']
  return envOrigins.split(',').map((o) => o.trim())
}

// ─── Plugin ─────────────────────────────────────────────

export const fastifyAuthPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate request with session and transport info
  fastify.decorateRequest('session', null)
  fastify.decorateRequest('isBearerTransport', false)

  // Hook to resolve session on every request
  fastify.addHook('onRequest', async (request) => {
    request.session = null
    request.isBearerTransport = false

    // Determine transport: cookie or Bearer header
    let token: string | null = null
    let isBearerTransport = false

    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
      isBearerTransport = true
    }

    if (!token) {
      token = request.cookies.mvlt_session ?? null
    }

    if (!token) return

    request.isBearerTransport = isBearerTransport

    const secret = process.env.AUTH_JWT_SECRET
    if (!secret) return

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

      if (!user) return
      if (!user.isActive) return

      // Session version mismatch means session was invalidated
      if (user.sessionVersion !== payload.sessionVersion) return

      // If token is device-bound, validate the device
      if (payload.deviceId) {
        const device = await db.deviceRegistration.findFirst({
          where: { id: payload.deviceId, userId: payload.sub, isActive: true },
          select: { id: true },
        })
        if (!device) return
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
        if (hasActiveToken === 0) return
      }

      // If token has a sessionId, validate the AuthSession record
      if (payload.sessionId) {
        const authSession = await db.authSession.findUnique({
          where: { id: payload.sessionId },
        })

        if (!authSession) return
        if (authSession.revokedAt) return
        if (authSession.expiresAt <= new Date()) return
        if (authSession.userId !== payload.sub) return
        // If device-bound session, verify device matches
        if (authSession.deviceId && payload.deviceId && authSession.deviceId !== payload.deviceId) return
        // If family-bound session, verify family matches
        if (payload.familyId && authSession.familyId !== payload.familyId) return

        // Update lastSeenAt on successful validation (throttled: max once per 5 min per session)
        if (lastSeenAtCache.shouldUpdate(authSession.id)) {
          db.authSession.update({
            where: { id: authSession.id },
            data: { lastSeenAt: new Date() },
          }).catch(() => { /* best-effort */ })
        }
      }

      request.session = {
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
      // Token verification failed — leave session as null
      request.session = null
    }
  })
}

export default fp(fastifyAuthPlugin, {
  name: 'medivault-auth',
})

// ─── Pre-handler Hooks ──────────────────────────────────

/**
 * Pre-handler that requires authentication.
 * Returns 401 if no valid session.
 * Returns 403 if mustChangePassword and route not in allowlist.
 */
export const requireAuth: import('fastify').preHandlerHookHandler = async (request, reply) => {
  if (!request.session) {
    return reply.status(401).send({ error: 'Authentication required' })
  }

  if (request.session.user.mustChangePassword) {
    const routeKey = `${request.method} ${request.url}`
    if (!FORCED_PW_CHANGE_ALLOWLIST.has(routeKey)) {
      return reply.status(403).send({ error: 'Password change required before accessing this resource' })
    }
  }
}

/**
 * Pre-handler factory that requires a specific permission.
 */
export function requirePermission(permission: string): import('fastify').preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.session) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const userPermissions = await getUserPermissions(request.session.user.id)
    if (!userPermissions.includes(permission)) {
      return reply.status(403).send({ error: `Missing required permission: ${permission}` })
    }
  }
}
