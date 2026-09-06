/**
 * MediVault Fastify — Auth Route Registration
 *
 * All authentication routes ported from Next.js with full security:
 * - CSRF protection for cookie-based (browser) mutating requests
 * - Origin validation for all public/mobile endpoints
 * - Device challenge-proof for mobile login/refresh
 * - Cookie-based browser auth vs Bearer-based mobile auth
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission, getAllowedOrigins } from '../../plugins/auth.js'
import { validateCsrf, validateOrigin, applyCorsHeaders } from '../../plugins/csrf.js'
import {
  authenticate,
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  changePassword,
  setupFirstAdmin,
  getUserPermissions,
  getUserRoleName,
  disableUser,
  enableUser,
  requestDevicePairing,
  verifyPairingSignature,
  approveDevicePairing,
  claimPairedDevice,
  registerDevice,
  revokeDevice,
} from '../../lib/auth-service.js'
import { db } from '../../lib/db.js'
import {
  generateCsrfToken,
  verifyAccessToken,
  verifySignature,
  generateChallengeNonce,
  hashToken,
  type AccessTokenPayload,
} from '@medivault/auth'
import { setAuthCookies, clearAuthCookies, getCookieValue } from '../../lib/cookie-helpers.js'

const CHALLENGE_TTL_MS = 2 * 60 * 1000 // 2 minutes

export async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  // ─── Login (browser, cookie-based) ──────────────────
  server.post('/api/auth/login', async (request, reply) => {
    try {
      // CSRF: origin required
      validateOrigin(request)
      // CSRF: token required for cookie-based login
      validateCsrf(request)

      const body = request.body as { email?: string; password?: string }
      if (!body.email || !body.password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }

      const user = await authenticate(body.email, body.password, request.ip, request.headers['user-agent'])
      const tokens = await createSession(user, request.ip, request.headers['user-agent'])

      const csrfToken = generateCsrfToken()
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, csrfToken, tokens.expiresIn)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)

      return reply.status(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role?.name ?? null,
          mustChangePassword: user.mustChangePassword,
        },
        expiresIn: tokens.expiresIn,
      })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Refresh (browser, cookie-based) ────────────────
  server.post('/api/auth/refresh', async (request, reply) => {
    try {
      validateCsrf(request)

      const refreshToken = getCookieValue(request, 'mvlt_refresh')
      if (!refreshToken) {
        return reply.status(401).send({ error: 'Refresh token not found' })
      }

      const tokens = await refreshSession(refreshToken, request.ip, request.headers['user-agent'])
      const csrfToken = generateCsrfToken()
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, csrfToken, tokens.expiresIn)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)

      return reply.status(200).send({ expiresIn: tokens.expiresIn })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Logout ───────────────────────────────────────────
  server.post('/api/auth/logout', { preHandler: [requireAuth, csrfPreHandler] }, async (request, reply) => {
    try {
      const refreshToken = getCookieValue(request, 'mvlt_refresh')
      if (refreshToken) {
        await revokeSession(refreshToken, request.session!.user.id, request.ip, request.headers['user-agent'])
      }
      clearAuthCookies(reply)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({ message: 'Logged out' })
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── Me ──────────────────────────────────────────────
  server.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const session = request.session!
    const permissions = await getUserPermissions(session.user.id)
    const roleName = await getUserRoleName(session.user.id)
    return reply.status(200).send({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        roleId: session.user.roleId,
        roleName,
        isActive: session.user.isActive,
        mustChangePassword: session.user.mustChangePassword,
        sessionVersion: session.user.sessionVersion,
      },
      permissions,
    })
  })

  // ─── Setup Check ──────────────────────────────────────
  server.get('/api/auth/setup', async (_request, reply) => {
    const userCount = await db.user.count()
    return reply.status(200).send({ needsSetup: userCount === 0 })
  })

  // ─── Setup (first admin) ──────────────────────────────
  server.post('/api/auth/setup', async (request, reply) => {
    try {
      validateOrigin(request)

      const body = request.body as { email?: string; password?: string; name?: string }
      if (!body.email || !body.password || !body.name) {
        return reply.status(400).send({ error: 'Email, password, and name are required' })
      }

      const tokens = await setupFirstAdmin(body.email, body.password, body.name, request.ip, request.headers['user-agent'])
      const csrfToken = generateCsrfToken()
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, csrfToken, tokens.expiresIn)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)

      return reply.status(201).send({
        user: { name: body.name, email: body.email },
        expiresIn: tokens.expiresIn,
      })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Change Password ────────────────────────────────
  server.put('/api/auth/password', { preHandler: [requireAuthAllowForcedChange, csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { currentPassword?: string; newPassword?: string }
      if (!body.currentPassword || !body.newPassword) {
        return reply.status(400).send({ error: 'Current password and new password are required' })
      }

      await changePassword(
        session.user.id, body.currentPassword, body.newPassword,
        session.user.id, request.ip, request.headers['user-agent'],
      )

      clearAuthCookies(reply)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({ success: true, message: 'Password changed. Please log in again.' })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Revoke All Sessions ──────────────────────────────
  server.post('/api/auth/sessions/revoke-all', { preHandler: [requireAuth, csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      await revokeAllSessions(session.user.id, session.user.id, request.ip, request.headers['user-agent'])
      clearAuthCookies(reply)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({ success: true })
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── Device Pairing: Request ─────────────────────────
  server.post('/api/auth/devices/pair/request', { preHandler: [requireAuth, requirePermission('device:manage'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { deviceFingerprint?: string; deviceName?: string; deviceType?: string; platform?: string; appVersion?: string }
      if (!body.deviceFingerprint || !body.deviceName || !body.deviceType) {
        return reply.status(400).send({ error: 'Device fingerprint, name, and type are required' })
      }

      const result = await requestDevicePairing(
        session.user.id, body.deviceFingerprint, body.deviceName, body.deviceType,
        body.platform, body.appVersion, request.ip,
      )
      return reply.status(200).send({ code: result.code, challengeNonce: result.challengeNonce, expiresAt: result.expiresAt.toISOString() })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Device Pairing: Verify Signature (mobile) ──────
  server.post('/api/auth/devices/pair/verify', async (request, reply) => {
    try {
      validateOrigin(request)
      const body = request.body as { code?: string; signature?: string; publicKey?: string }
      if (!body.code || !body.signature || !body.publicKey) {
        return reply.status(400).send({ error: 'code, signature, and publicKey are required' })
      }

      const verifiedPublicKey = await verifyPairingSignature(body.code, body.signature, body.publicKey)
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({ verified: true, publicKey: verifiedPublicKey })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Device Pairing: Approve ─────────────────────────
  server.post('/api/auth/devices/pair/approve', { preHandler: [requireAuth, requirePermission('device:manage'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { code?: string; deviceFingerprint?: string }
      if (!body.code) {
        return reply.status(400).send({ error: 'Pairing code is required' })
      }

      const result = await approveDevicePairing(
        body.code, session.user.id, body.deviceFingerprint, request.ip, request.headers['user-agent'],
      )
      return reply.status(200).send({ deviceId: result.deviceId })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Device Pairing: Claim ───────────────────────────
  server.post('/api/auth/devices/pair/claim', async (request, reply) => {
    try {
      validateOrigin(request)
      const body = request.body as { code?: string; deviceFingerprint?: string; publicKey?: string }
      if (!body.code || !body.deviceFingerprint) {
        return reply.status(400).send({ error: 'Pairing code and device fingerprint are required' })
      }

      const tokens = await claimPairedDevice(body.code, body.deviceFingerprint, body.publicKey, request.ip, request.headers['user-agent'])
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn, deviceId: tokens.deviceId, familyId: tokens.familyId,
      })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── List Devices ────────────────────────────────────
  server.get('/api/auth/devices', { preHandler: [requireAuth, requirePermission('device:view')] }, async (request, reply) => {
    const session = request.session!
    const devices = await db.deviceRegistration.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceName: true, deviceType: true, platform: true, appVersion: true, isActive: true, lastSyncedAt: true, lastIp: true, createdAt: true },
    })
    return reply.status(200).send({ devices })
  })

  // ─── Register Device ─────────────────────────────────
  server.post('/api/auth/devices', { preHandler: [requireAuth, requirePermission('device:manage'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { deviceName?: string; deviceType?: string; platform?: string; appVersion?: string }
      if (!body.deviceName || !body.deviceType) {
        return reply.status(400).send({ error: 'Device name and type are required' })
      }

      const device = await registerDevice(session.user.id, body.deviceName, body.deviceType, body.platform, body.appVersion, request.ip)
      return reply.status(201).send(device)
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Revoke Device ───────────────────────────────────
  server.delete('/api/auth/devices/:id', { preHandler: [requireAuth, requirePermission('device:manage'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      await revokeDevice(session.user.id, id, session.user.id, request.ip, request.headers['user-agent'])
      return reply.status(200).send({ success: true })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Mobile: Challenge (generate nonce for device proof) ─
  server.post('/api/auth/mobile/challenge', async (request, reply) => {
    try {
      validateOrigin(request)

      const body = request.body as { deviceId?: string }
      if (!body.deviceId) {
        return reply.status(400).send({ error: 'deviceId is required' })
      }

      // Validate device exists, is active, and has a public key
      const device = await db.deviceRegistration.findFirst({
        where: { id: body.deviceId, isActive: true },
      })
      if (!device) {
        return reply.status(403).send({ error: 'Device not found or inactive' })
      }
      if (!device.publicKey) {
        return reply.status(403).send({ error: 'Device has no public key registered' })
      }

      const nonce = generateChallengeNonce()
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

      const challenge = await db.deviceChallenge.create({
        data: { deviceId: body.deviceId, nonce, expiresAt },
      })

      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({
        challengeId: challenge.id,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt.toISOString(),
      })
    } catch (error) {
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── Mobile: Login (with device challenge proof) ─────
  server.post('/api/auth/mobile/login', async (request, reply) => {
    try {
      validateOrigin(request)
      // No CSRF token for mobile (Bearer-equivalent transport)

      const deviceId = request.headers['x-device-id'] as string | undefined
      if (!deviceId) {
        return reply.status(400).send({ error: 'X-Device-Id header is required' })
      }

      const body = request.body as { email?: string; password?: string; challengeId?: string; signature?: string }
      if (!body.email || !body.password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }
      if (!body.challengeId || !body.signature) {
        return reply.status(400).send({ error: 'challengeId and signature are required' })
      }

      // Verify challenge
      const challenge = await db.deviceChallenge.findUnique({ where: { id: body.challengeId } })
      if (!challenge) {
        return reply.status(403).send({ error: 'Invalid or unknown challenge' })
      }
      if (challenge.usedAt) {
        return reply.status(403).send({ error: 'Challenge has already been used' })
      }
      if (challenge.expiresAt < new Date()) {
        return reply.status(403).send({ error: 'Challenge has expired' })
      }
      if (challenge.deviceId !== deviceId) {
        return reply.status(403).send({ error: 'Challenge does not match the provided device' })
      }

      // Verify device has public key
      const device = await db.deviceRegistration.findUnique({ where: { id: deviceId } })
      if (!device || !device.publicKey) {
        return reply.status(403).send({ error: 'Device not found or has no public key' })
      }

      // Verify ECDSA signature
      const signatureValid = await verifySignature(challenge.nonce, body.signature, device.publicKey)
      if (!signatureValid) {
        return reply.status(403).send({ error: 'Cryptographic signature verification failed' })
      }

      // Mark challenge as used
      await db.deviceChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } })

      // Authenticate user
      const user = await authenticate(body.email, body.password, request.ip, request.headers['user-agent'])

      // Validate device belongs to this user
      const activeDevice = await db.deviceRegistration.findFirst({
        where: { id: deviceId, userId: user.id, isActive: true },
      })
      if (!activeDevice) {
        return reply.status(403).send({ error: 'Device not found, not approved, or inactive' })
      }

      // Create device-bound session
      const tokens = await createSession(user, request.ip, request.headers['user-agent'], deviceId)

      // Extract sessionId from token
      const secret = process.env.AUTH_JWT_SECRET!
      const payload: AccessTokenPayload = await verifyAccessToken(tokens.accessToken, secret)

      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn, sessionId: payload.sessionId,
        deviceId: tokens.deviceId, familyId: tokens.familyId,
      })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })

  // ─── Mobile: Refresh (with device challenge proof) ───
  server.post('/api/auth/mobile/refresh', async (request, reply) => {
    try {
      validateOrigin(request)

      const deviceId = request.headers['x-device-id'] as string | undefined
      if (!deviceId) {
        return reply.status(400).send({ error: 'X-Device-Id header is required' })
      }

      const body = request.body as { refreshToken?: string; challengeId?: string; signature?: string }
      if (!body.refreshToken) {
        return reply.status(400).send({ error: 'Refresh token is required' })
      }
      if (!body.challengeId || !body.signature) {
        return reply.status(400).send({ error: 'challengeId and signature are required' })
      }

      // Verify challenge
      const challenge = await db.deviceChallenge.findUnique({ where: { id: body.challengeId } })
      if (!challenge) {
        return reply.status(403).send({ error: 'Invalid or unknown challenge' })
      }
      if (challenge.usedAt) {
        return reply.status(403).send({ error: 'Challenge has already been used' })
      }
      if (challenge.expiresAt < new Date()) {
        return reply.status(403).send({ error: 'Challenge has expired' })
      }
      if (challenge.deviceId !== deviceId) {
        return reply.status(403).send({ error: 'Challenge does not match the provided device' })
      }

      // Verify token belongs to this device
      const tokenHash = await hashToken(body.refreshToken)
      const storedToken = await db.refreshToken.findFirst({
        where: { tokenHash, deviceId, revokedAt: null },
        include: { device: true },
      })
      if (!storedToken || !storedToken.device || !storedToken.device.publicKey) {
        return reply.status(401).send({ error: 'Invalid or expired refresh token' })
      }

      // Verify ECDSA signature
      const signatureValid = await verifySignature(challenge.nonce, body.signature, storedToken.device.publicKey)
      if (!signatureValid) {
        return reply.status(403).send({ error: 'Cryptographic signature verification failed' })
      }

      // Mark challenge as used
      await db.deviceChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } })

      // Proceed with refresh
      const tokens = await refreshSession(body.refreshToken, request.ip, request.headers['user-agent'])
      applyCorsHeaders(reply, request.headers.origin as string | undefined)
      return reply.status(200).send({
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn,
      })
    } catch (error) {
      return mapAuthError(error, reply)
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────

function mapAuthError(error: unknown, reply: import('fastify').FastifyReply) {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const err = error as { statusCode: number; message: string; retryAfterMs?: number }
    const body: Record<string, unknown> = { error: err.message }
    if (err.retryAfterMs) {
      body.retryAfterMs = err.retryAfterMs
      reply.header('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)))
    }
    return reply.status(err.statusCode).send(body)
  }
  return reply.status(500).send({ error: 'Internal server error' })
}

/** Pre-handler that validates CSRF for mutating requests */
function csrfPreHandler(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  done: () => void,
): void {
  try {
    validateCsrf(request)
    done()
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      reply.status((error as { statusCode: number }).statusCode).send({ error: (error as unknown as { message: string }).message })
    } else {
      reply.status(403).send({ error: 'CSRF validation failed' })
    }
  }
}

/** Pre-handler like requireAuth but allows mustChangePassword users */
function requireAuthAllowForcedChange(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  done: () => void,
): void {
  if (!request.session) {
    reply.status(401).send({ error: 'Authentication required' })
    return
  }
  done()
}
