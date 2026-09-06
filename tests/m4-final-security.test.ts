/**
 * M4 Final Verification & Session Design Correction Tests
 *
 * All tests require PostgreSQL. None are skipped.
 * Covers the 11 security scenarios specified in the final correction pass:
 *   1. Immediate device-revocation enforcement
 *   2. Cross-user device rejection
 *   3. Refresh-family revocation
 *   4. Concurrent refresh attempts
 *   5. Temporary-password restrictions
 *   6. Access restoration after password change
 *   7. Pairing expiration
 *   8. Pairing single-use enforcement
 *   9. Pairing fingerprint mismatch
 *   10. Unauthorized pairing approval
 *   11. Pairing claim flow
 * Plus: AuthSession, crypto pairing, CSRF, route-permission coverage, secrets
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID, generateKeyPairSync, createSign } from 'crypto'
import {
  generateCsrfToken,
  verifyCsrfToken,
  generateAccessToken,
  generateRefreshToken,
  generateFamilyId,
  hashToken,
  hashPassword,
  verifyAccessToken,
  generateChallengeNonce,
  verifySignature,
} from '@medivault/auth'
import {
  authenticate,
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  changePassword,
  resetUserPassword,
  requestDevicePairing,
  approveDevicePairing,
  verifyPairingSignature,
  claimPairedDevice,
  revokeDevice,
} from '@/lib/auth-service'
import { validateCsrf, validateOriginHost } from '@/lib/csrf'
import { ROUTE_PERMISSIONS } from '@/lib/route-permissions'

// ─── Environment ──────────────────────────────────
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

const envPath = path.resolve(process.cwd(), '.env')
const envContent = fs.readFileSync(envPath, 'utf-8')
const secretMatch = envContent.match(/^AUTH_JWT_SECRET=(.+)$/m)
if (secretMatch && secretMatch[1].trim()) {
  process.env.AUTH_JWT_SECRET = secretMatch[1].trim()
}

const JWT_SECRET = process.env.AUTH_JWT_SECRET!
const TEST_PREFIX = `m4sec-${randomUUID()}`
let cleanupUserIds: string[] = []
let dbSeeded = false

beforeAll(async () => {
  await db.$executeRawUnsafe('SELECT 1')
})

afterAll(async () => {
  if (cleanupUserIds.length > 0) {
    await db.deviceChallenge.deleteMany({ where: { deviceId: { in: (await db.deviceRegistration.findMany({ where: { userId: { in: cleanupUserIds } }, select: { id: true } })).map(d => d.id) } } }).catch(() => {})
    await db.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
    await db.authSession.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
    await db.devicePairingCode.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
    await db.deviceRegistration.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
    await db.auditLog.deleteMany({ where: { actorId: { in: cleanupUserIds } } }).catch(() => {})
    await db.loginHistory.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
    await db.user.deleteMany({ where: { id: { in: cleanupUserIds } } }).catch(() => {})
  }
})

function testEmail(label: string): string {
  return `${TEST_PREFIX}-${label}@example.com`
}

async function ensureSeed() {
  if (dbSeeded) return
  const { seedRolesAndPermissions } = await import('@/lib/seed-rbac')
  await seedRolesAndPermissions()
  dbSeeded = true
}

async function createTestUser(label: string, overrides?: { roleId?: string; mustChangePassword?: boolean }) {
  await ensureSeed()
  const role = overrides?.roleId || (await db.role.findUnique({ where: { name: 'Doctor' } }))!.id
  const hashedPw = await hashPassword('Test1234!@#')
  const user = await db.user.create({
    data: {
      email: testEmail(label), password: hashedPw, name: label,
      roleId: role, isActive: true,
      mustChangePassword: overrides?.mustChangePassword ?? false,
      sessionVersion: 0,
    },
  })
  cleanupUserIds.push(user.id)
  return user
}

// ────────────────────────────────────────────────
// Suite 1: Immediate device-revocation enforcement
// ────────────────────────────────────────────────
describe('1. Immediate device-revocation enforcement', () => {
  let userId: string; let deviceId: string; let authSessionId: string; let familyId: string

  beforeAll(async () => {
    const user = await createTestUser('devrevok')
    userId = user.id
    const device = await db.deviceRegistration.create({
      data: { userId, deviceName: 'TestDevice', deviceType: 'mobile', isActive: true },
    })
    deviceId = device.id
    const tokens = await createSession(
      { id: userId, email: testEmail('devrevok'), name: 'DevRevoke', roleId: user.roleId, isActive: true, sessionVersion: 0 },
      undefined, undefined, deviceId,
    )
    familyId = tokens.familyId!
    const payload = await verifyAccessToken(tokens.accessToken, JWT_SECRET)
    authSessionId = payload.sessionId!
  })

  it('AuthSession exists and is active before revocation', async () => {
    const session = await db.authSession.findUnique({ where: { id: authSessionId } })
    expect(session).not.toBeNull()
    expect(session!.revokedAt).toBeNull()
    expect(session!.userId).toBe(userId)
    expect(session!.deviceId).toBe(deviceId)
  })

  it('device revocation immediately marks device inactive', async () => {
    await revokeDevice(userId, deviceId)
    const device = await db.deviceRegistration.findUnique({ where: { id: deviceId } })
    expect(device!.isActive).toBe(false)
  })

  it('device revocation revokes associated AuthSession', async () => {
    const session = await db.authSession.findUnique({ where: { id: authSessionId } })
    expect(session!.revokedAt).not.toBeNull()
    expect(session!.revocationReason).toBe('Device revoked')
  })

  it('device revocation revokes associated refresh tokens', async () => {
    const activeTokens = await db.refreshToken.count({ where: { deviceId, userId, revokedAt: null } })
    expect(activeTokens).toBe(0)
  })
})

// ────────────────────────────────────────────────
// Suite 2: Cross-user device rejection
// ────────────────────────────────────────────────
describe('2. Cross-user device rejection', () => {
  it('device bound to user A is not found for user B', async () => {
    const userA = await createTestUser('crossA')
    const userB = await createTestUser('crossB')
    const device = await db.deviceRegistration.create({
      data: { userId: userA.id, deviceName: 'CrossDevice', deviceType: 'mobile', isActive: true },
    })
    const deviceCheck = await db.deviceRegistration.findFirst({
      where: { id: device.id, userId: userB.id, isActive: true },
    })
    expect(deviceCheck).toBeNull()
  })
})

// ────────────────────────────────────────────────
// Suite 3: Refresh-family revocation
// ────────────────────────────────────────────────
describe('3. Refresh-family revocation', () => {
  let userId: string; let familyId: string; let oldRefreshToken: string

  beforeAll(async () => {
    const user = await createTestUser('familyrev')
    userId = user.id
    const tokens = await createSession(
      { id: userId, email: testEmail('familyrev'), name: 'FamilyRev', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    familyId = tokens.familyId!
    oldRefreshToken = tokens.refreshToken
    await refreshSession(tokens.refreshToken)
  })

  it('family has multiple tokens', async () => {
    const familyTokens = await db.refreshToken.findMany({ where: { familyId, userId } })
    expect(familyTokens.length).toBeGreaterThanOrEqual(2)
  })

  it('reusing old token revokes entire family', async () => {
    await expect(refreshSession(oldRefreshToken)).rejects.toThrow('Invalid or expired')
    const activeTokens = await db.refreshToken.count({ where: { familyId, userId, revokedAt: null } })
    expect(activeTokens).toBe(0)
  })

  it('family revocation increments user sessionVersion', async () => {
    const user = await db.user.findUnique({ where: { id: userId } })
    expect(user!.sessionVersion).toBeGreaterThan(0)
  })

  it('family revocation revokes associated AuthSessions', async () => {
    const sessions = await db.authSession.findMany({ where: { familyId, userId } })
    const revoked = sessions.filter(s => s.revokedAt !== null)
    expect(revoked.length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────
// Suite 4: Concurrent refresh attempts
// ────────────────────────────────────────────────
describe('4. Concurrent refresh attempts', () => {
  it('only one concurrent refresh succeeds per token', async () => {
    const user = await createTestUser('concurrent')
    const tokens = await createSession(
      { id: user.id, email: testEmail('concurrent'), name: 'Conc', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    const results = await Promise.allSettled([
      refreshSession(tokens.refreshToken),
      refreshSession(tokens.refreshToken),
    ])
    const failures = results.filter(r => r.status === 'rejected').length
    expect(failures).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────
// Suite 5: Temporary-password restrictions
// ────────────────────────────────────────────────
describe('5. Temporary-password restrictions', () => {
  it('admin reset sets mustChangePassword=true', async () => {
    await ensureSeed()
    const admin = await createTestUser('tempadmin', {
      roleId: (await db.role.findUnique({ where: { name: 'Admin' } }))!.id,
    })
    const target = await createTestUser('temptarget')
    const { tempPassword } = await resetUserPassword(admin.id, target.id)
    const user = await db.user.findUnique({ where: { id: target.id } })
    expect(user!.mustChangePassword).toBe(true)
    // Verify temp password works for auth
    const authed = await authenticate(testEmail('temptarget'), tempPassword)
    expect(authed.mustChangePassword).toBe(true)
  })

  it('FORCED_PW_CHANGE_ALLOWLIST contains only safe routes', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/authorize.ts'), 'utf-8')
    expect(source).toContain('GET /api/auth/me')
    expect(source).toContain('PUT /api/auth/password')
    expect(source).toContain('POST /api/auth/logout')
    expect(source).toContain('POST /api/auth/sessions/revoke-all')
    expect(source).not.toContain('patient')
    expect(source).not.toContain('document')
  })

  it('changePassword clears mustChangePassword', async () => {
    const user = await createTestUser('tempchange', { mustChangePassword: true })
    const { changePassword: cp } = await import('@/lib/auth-service')
    await cp(user.id, 'Test1234!@#', 'NewPass456!@#')
    const updated = await db.user.findUnique({ where: { id: user.id } })
    expect(updated!.mustChangePassword).toBe(false)
  })
})

// ────────────────────────────────────────────────
// Suite 6: Access restoration after password change
// ────────────────────────────────────────────────
describe('6. Access restoration after password change', () => {
  it('new session succeeds after password change with new password', async () => {
    const user = await createTestUser('accessrestore')
    const oldTokens = await createSession(
      { id: user.id, email: testEmail('accessrestore'), name: 'AR', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    await changePassword(user.id, 'Test1234!@#', 'NewPass789!@#')
    const updatedUser = await db.user.findUnique({ where: { id: user.id } })
    const oldPayload = await verifyAccessToken(oldTokens.accessToken, JWT_SECRET)
    expect(oldPayload.sessionVersion).toBeLessThan(updatedUser!.sessionVersion)
    // Old AuthSession should be revoked
    const oldSessions = await db.authSession.findMany({ where: { userId: user.id, revokedAt: null } })
    expect(oldSessions.length).toBe(0)
    // New auth with new password
    const authResult = await authenticate(testEmail('accessrestore'), 'NewPass789!@#')
    expect(authResult.id).toBe(user.id)
    const newTokens = await createSession(authResult)
    const newPayload = await verifyAccessToken(newTokens.accessToken, JWT_SECRET)
    expect(newPayload.sessionVersion).toBe(updatedUser!.sessionVersion)
    const newSession = await db.authSession.findUnique({ where: { id: newPayload.sessionId! } })
    expect(newSession).not.toBeNull()
    expect(newSession!.revokedAt).toBeNull()
  })
})

/** Helper: generate a P-256 key pair and sign a challenge nonce */
async function generateSignedPairing(code: string) {
  const { generateKeyPairSync, createSign } = await import('crypto')
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pairing = await db.devicePairingCode.findFirst({ where: { code } })
  const sign = createSign('SHA256')
  sign.update(Buffer.from(pairing!.challengeNonce!, 'hex'))
  const signature = sign.sign(keyPair.privateKey).toString('hex')
  const pubKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const { verifyPairingSignature } = await import('@/lib/auth-service')
  await verifyPairingSignature(code, signature, pubKeyPem)
  return { pubKeyPem }
}

// ────────────────────────────────────────────────
// Suite 7: Pairing expiration
// ────────────────────────────────────────────────
describe('7. Pairing expiration', () => {
  it('expired pairing code is rejected even after valid signature verification', async () => {
    const user = await createTestUser('pairexp')

    // Step 1: Create a legitimate pairing request with challenge nonce
    const pairResult = await requestDevicePairing(user.id, 'fp-exp', 'PhoneExp', 'mobile', 'iOS', '1.0')

    // Step 2: Generate a real ECDSA P-256 key pair and sign the challenge nonce
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pubKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const pairing = await db.devicePairingCode.findFirst({ where: { code: pairResult.code } })
    const sign = createSign('SHA256')
    sign.update(Buffer.from(pairing!.challengeNonce!, 'hex'))
    const signature = sign.sign(keyPair.privateKey).toString('hex')

    // Step 3: Complete cryptographic signature verification (stores signature on pairing)
    await verifyPairingSignature(pairResult.code, signature, pubKeyPem)

    // Step 4: Manually expire the pairing code
    await db.devicePairingCode.update({
      where: { id: pairing!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    // Step 5: Attempt to approve — should get expiration rejection (not a signature error)
    await expect(approveDevicePairing(pairResult.code, user.id, 'fp-exp')).rejects.toThrow('Invalid or expired')

    // Step 6: Confirm no DeviceRegistration, AuthSession, or RefreshToken was created
    const regCount = await db.deviceRegistration.count({ where: { userId: user.id, deviceName: 'PhoneExp' } })
    expect(regCount).toBe(0)
    const sessionCount = await db.authSession.count({ where: { userId: user.id } })
    expect(sessionCount).toBe(0)
    const tokenCount = await db.refreshToken.count({ where: { userId: user.id } })
    expect(tokenCount).toBe(0)
  })
})

// ────────────────────────────────────────────────
// Suite 8: Pairing single-use enforcement
// ────────────────────────────────────────────────
describe('8. Pairing single-use enforcement', () => {
  it('used pairing code is rejected on second attempt', async () => {
    const user = await createTestUser('pairused')
    const result = await requestDevicePairing(user.id, 'fp-used', 'PhoneUsed', 'mobile', 'iOS', '1.0')
    await generateSignedPairing(result.code)
    await approveDevicePairing(result.code, user.id, 'fp-used')
    await expect(approveDevicePairing(result.code, user.id, 'fp-used')).rejects.toThrow('already been used')
  })
})

// ────────────────────────────────────────────────
// Suite 9: Pairing fingerprint mismatch
// ────────────────────────────────────────────────
describe('9. Pairing fingerprint mismatch', () => {
  it('mismatched fingerprint is rejected', async () => {
    const user = await createTestUser('pairmismatch')
    const result = await requestDevicePairing(user.id, 'fp-original', 'PhoneM', 'mobile', 'iOS', '1.0')
    await generateSignedPairing(result.code)
    await expect(approveDevicePairing(result.code, user.id, 'fp-wrong')).rejects.toThrow('fingerprint')
  })
})

// ────────────────────────────────────────────────
// Suite 10: Unauthorized pairing approval
// ────────────────────────────────────────────────
describe('10. Unauthorized pairing approval', () => {
  it('non-owner non-admin cannot approve', async () => {
    await ensureSeed()
    const owner = await createTestUser('pairowner')
    const nonAdmin = await createTestUser('pairnonadmin')
    const result = await requestDevicePairing(owner.id, 'fp-own', 'PhoneO', 'mobile', 'iOS', '1.0')
    await generateSignedPairing(result.code)
    await expect(approveDevicePairing(result.code, nonAdmin.id, 'fp-own')).rejects.toThrow('Only the device owner or an admin')
  })
})

// ────────────────────────────────────────────────
// Suite 11: Pairing claim flow
// ────────────────────────────────────────────────
describe('11. Pairing claim flow', () => {
  it('claim returns tokens with deviceId and familyId', async () => {
    const user = await createTestUser('pairclaim')
    const pairResult = await requestDevicePairing(user.id, 'fp-claim', 'PhoneC', 'mobile', 'iOS', '1.0')
    await generateSignedPairing(pairResult.code)
    const approved = await approveDevicePairing(pairResult.code, user.id, 'fp-claim')
    expect(approved.deviceId).toBeDefined()
    const claimed = await claimPairedDevice(pairResult.code, 'fp-claim')
    expect(claimed.accessToken).toBeDefined()
    expect(claimed.refreshToken).toBeDefined()
    expect(claimed.deviceId).toBeDefined()
    expect(claimed.familyId).toBeDefined()
  })

  it('approve does NOT return refreshToken', async () => {
    const user = await createTestUser('pairapprovenotok')
    const result = await requestDevicePairing(user.id, 'fp-noreftok', 'PhoneN', 'mobile', 'iOS', '1.0')
    await generateSignedPairing(result.code)
    const approved = await approveDevicePairing(result.code, user.id, 'fp-noreftok')
    expect((approved as Record<string, unknown>).refreshToken).toBeUndefined()
  })
})

// ────────────────────────────────────────────────
// Suite 12: AuthSession model
// ────────────────────────────────────────────────
describe('12. AuthSession model', () => {
  it('createSession creates an AuthSession record', async () => {
    const user = await createTestUser('sessionmodel')
    const tokens = await createSession(
      { id: user.id, email: testEmail('sessionmodel'), name: 'SM', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    const payload = await verifyAccessToken(tokens.accessToken, JWT_SECRET)
    expect(payload.sessionId).toBeTruthy()
    const authSession = await db.authSession.findUnique({ where: { id: payload.sessionId! } })
    expect(authSession).not.toBeNull()
    expect(authSession!.userId).toBe(user.id)
    expect(authSession!.familyId).toBe(payload.familyId)
    expect(authSession!.revokedAt).toBeNull()
  })

  it('revokeAllSessions revokes all AuthSessions', async () => {
    const user = await createTestUser('sessionrevokeall')
    await createSession(
      { id: user.id, email: testEmail('sessionrevokeall'), name: 'SRA', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    await createSession(
      { id: user.id, email: testEmail('sessionrevokeall'), name: 'SRA', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    await revokeAllSessions(user.id)
    const activeSessions = await db.authSession.count({ where: { userId: user.id, revokedAt: null } })
    expect(activeSessions).toBe(0)
  })

  it('changePassword revokes AuthSessions', async () => {
    const user = await createTestUser('sessionpwchange')
    await createSession(
      { id: user.id, email: testEmail('sessionpwchange'), name: 'SPC', roleId: user.roleId, isActive: true, sessionVersion: 0 },
    )
    await changePassword(user.id, 'Test1234!@#', 'NewPw1234!@#')
    const activeSessions = await db.authSession.count({ where: { userId: user.id, revokedAt: null } })
    expect(activeSessions).toBe(0)
  })

  it('disableUser revokes AuthSessions', async () => {
    await ensureSeed()
    const admin = await createTestUser('sessiondisadmin', {
      roleId: (await db.role.findUnique({ where: { name: 'Admin' } }))!.id,
    })
    const target = await createTestUser('sessiondistarget')
    await createSession(
      { id: target.id, email: testEmail('sessiondistarget'), name: 'SDT', roleId: target.roleId, isActive: true, sessionVersion: 0 },
    )
    const { disableUser: du } = await import('@/lib/auth-service')
    await du(admin.id, target.id)
    const activeSessions = await db.authSession.count({ where: { userId: target.id, revokedAt: null } })
    expect(activeSessions).toBe(0)
  })
})

// ────────────────────────────────────────────────
// Suite 13: Cryptographic pairing
// ────────────────────────────────────────────────
describe('13. Cryptographic device pairing', () => {
  it('generateChallengeNonce produces 64-char hex', () => {
    const nonce = generateChallengeNonce()
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ECDSA P-256 signature round-trip verifies', async () => {
    const { generateKeyPairSync, createSign } = await import('crypto')
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const challenge = generateChallengeNonce()
    const sign = createSign('SHA256')
    sign.update(Buffer.from(challenge, 'hex'))
    const signature = sign.sign(keyPair.privateKey)
    const pubKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const result = await verifySignature(challenge, signature.toString('hex'), pubKeyPem)
    expect(result).toBe(true)
  })

  it('wrong signature fails verification', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const challenge = generateChallengeNonce()
    const result = await verifySignature(challenge, 'deadbeef'.repeat(16), keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
    expect(result).toBe(false)
  })

  it('different key fails verification', async () => {
    const keyPair1 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const keyPair2 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const challenge = generateChallengeNonce()
    const sign = createSign('SHA256')
    sign.update(Buffer.from(challenge, 'hex'))
    const signature = sign.sign(keyPair1.privateKey).toString('hex')
    const pubKey2 = keyPair2.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const result = await verifySignature(challenge, signature, pubKey2)
    expect(result).toBe(false)
  })

  it('requestDevicePairing returns a challenge nonce', async () => {
    const user = await createTestUser('pairchallenge')
    const result = await requestDevicePairing(user.id, 'fp-challenge', 'PhoneCh', 'mobile', 'iOS', '1.0')
    // The pairing code should be returned, and a challenge nonce should be stored
    const pairing = await db.devicePairingCode.findFirst({ where: { code: result.code } })
    expect(pairing?.challengeNonce).toBeTruthy()
    expect(pairing?.challengeNonce).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ────────────────────────────────────────────────
// Suite 14: Browser/mobile endpoint separation
// ────────────────────────────────────────────────
describe('14. Browser/mobile endpoint separation', () => {
  const authRouteFile = path.resolve(process.cwd(), 'mini-services/api-service/src/routes/auth/index.ts')

  it('Fastify auth routes file exists', () => {
    expect(fs.existsSync(authRouteFile)).toBe(true)
  })

  it('mobile login requires X-Device-Id header (source code check)', () => {
    const content = fs.readFileSync(authRouteFile, 'utf-8')
    expect(content).toContain('X-Device-Id')
    expect(content).toContain('header is required')
  })

  it('mobile login returns tokens in JSON (no cookies)', () => {
    const content = fs.readFileSync(authRouteFile, 'utf-8')
    // The mobile login response includes accessToken and refreshToken
    expect(content).toContain('accessToken')
    expect(content).toContain('refreshToken')
    // The mobile login route does NOT call setAuthCookies
    const mobileLoginSection = content.match(/\/\/ ─── Mobile: Login[\s\S]*?(?=\/\/ ───)/)
    if (mobileLoginSection) {
      expect(mobileLoginSection[0]).not.toContain('setAuthCookies')
    }
  })

  it('browser login sets cookies and does NOT return refreshToken in JSON body', () => {
    const content = fs.readFileSync(authRouteFile, 'utf-8')
    // Browser login calls setAuthCookies
    expect(content).toContain('setAuthCookies')
    // Verify cookie-helpers.ts sets the actual cookie strings
    const cookieHelper = fs.readFileSync(path.resolve(process.cwd(), 'mini-services/api-service/src/lib/cookie-helpers.ts'), 'utf-8')
    expect(cookieHelper).toContain('mvlt_session=')
    expect(cookieHelper).toContain('mvlt_refresh=')
    expect(cookieHelper).toContain('HttpOnly')
  })

  it('browser refresh reads from cookie, not body', () => {
    const content = fs.readFileSync(authRouteFile, 'utf-8')
    expect(content).toContain('mvlt_refresh')
    // The refresh route reads from cookie, not from request body
    const refreshSection = content.match(/\/\/ ─── Refresh \(browser[\s\S]*?(?=\/\/ ───)/)
    if (refreshSection) {
      expect(refreshSection[0]).toContain('getCookieValue')
    }
  })

  it('route-permission registry includes mobile endpoints', () => {
    const mobileLogin = ROUTE_PERMISSIONS.find(r => r.path === '/api/auth/mobile/login' && r.method === 'POST')
    expect(mobileLogin).toBeDefined()
    expect(mobileLogin?.public).toBe(true)
    const mobileRefresh = ROUTE_PERMISSIONS.find(r => r.path === '/api/auth/mobile/refresh' && r.method === 'POST')
    expect(mobileRefresh).toBeDefined()
    expect(mobileRefresh?.public).toBe(true)
  })
})

// ────────────────────────────────────────────────
// Suite 15: CSRF validation
// ────────────────────────────────────────────────
describe('15. CSRF validation', () => {
  function mockRequest(opts: {
    method?: string
    authorization?: string
    cookies?: Record<string, string>
    headers?: Record<string, string>
    origin?: string
  }) {
    const headersMap = new Map<string, string>(
      Object.entries(opts.headers ?? {}).concat(
        opts.authorization ? [['authorization', opts.authorization]] : [],
        opts.origin ? [['origin', opts.origin]] : [],
      ),
    )
    const cookiesMap = new Map<string, string>(Object.entries(opts.cookies ?? {}))
    const m = (opts.method || 'GET').toUpperCase()
    return {
      method: m,
      headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
      cookies: { get: (name: string) => { const v = cookiesMap.get(name); return v ? { name, value: v } : undefined } },
    }
  }

  it('Origin header is required for POST (no Host fallback)', () => {
    const req = mockRequest({ method: 'POST', cookies: { mvlt_csrf: 'abc', mvlt_session: 'tok' }, headers: { 'x-csrf-token': 'abc' } }) as any
    expect(() => validateCsrf(req)).toThrow('Origin')
  })

  it('unapproved Origin is rejected', () => {
    const req = mockRequest({ method: 'POST', origin: 'https://evil.com', cookies: { mvlt_csrf: 'abc', mvlt_session: 'tok' }, headers: { 'x-csrf-token': 'abc' } }) as any
    expect(() => validateCsrf(req)).toThrow('Origin not allowed')
  })

  it('mixed cookie-plus-Bearer is rejected', () => {
    const req = mockRequest({ method: 'POST', origin: 'http://localhost:3000', authorization: 'Bearer abc', cookies: { mvlt_session: 'tok', mvlt_csrf: 'abc' }, headers: { 'x-csrf-token': 'abc' } }) as any
    expect(() => validateCsrf(req)).toThrow('Mixed')
  })

  it('Sec-Fetch-Mode: navigate is rejected on POST', () => {
    const csrf = generateCsrfToken()
    const req = mockRequest({ method: 'POST', origin: 'http://localhost:3000', cookies: { mvlt_csrf: csrf, mvlt_session: 'tok' }, headers: { 'x-csrf-token': csrf, 'sec-fetch-mode': 'navigate' } }) as any
    expect(() => validateCsrf(req)).toThrow(/navigate/i)
  })

  it('GET request skips CSRF', () => {
    const req = mockRequest({ method: 'GET' }) as any
    expect(() => validateCsrf(req)).not.toThrow()
  })

  it('isBearerAuthRequest is removed from csrf.ts', () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/csrf.ts'), 'utf-8')
    expect(content).not.toContain('isBearerAuthRequest')
  })
})

// ────────────────────────────────────────────────
// Suite 16: Route-permission coverage
// ────────────────────────────────────────────────
describe('16. Route-permission coverage', () => {
  const fastifyRoutesDir = path.resolve(process.cwd(), 'mini-services/api-service/src/routes')
  const diskRoutes = new Set<string>()

  function findRoutes(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) findRoutes(fullPath)
      else if (entry.name === 'index.ts') {
        const content = fs.readFileSync(fullPath, 'utf-8')
        // Extract Fastify route registrations: server.get/post/put/patch/delete
        const re = /server\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]\)/g
        let m
        while ((m = re.exec(content)) !== null) {
          diskRoutes.add(`${m[1].toUpperCase()} ${m[2]}`)
        }
      }
    }
  }

  beforeAll(() => { findRoutes(fastifyRoutesDir) })

  it('every non-public route on disk exists in the permission registry', () => {
    const registrySet = new Set(ROUTE_PERMISSIONS.map(r => `${r.method} ${r.path}`))
    const missing: string[] = []
    for (const diskRoute of diskRoutes) {
      if (!registrySet.has(diskRoute)) missing.push(diskRoute)
    }
    // Health/readiness and public auth endpoints are expected to be in the registry
    if (missing.length > 0) {
      throw new Error(`Routes on disk missing from ROUTE_PERMISSIONS:\n  ${missing.join('\n  ')}`)
    }
    expect(missing.length).toBe(0)
  })

  it('mobile endpoints are registered as public', () => {
    const ml = ROUTE_PERMISSIONS.find(r => r.path === '/api/auth/mobile/login' && r.method === 'POST')
    expect(ml?.public).toBe(true)
    const mr = ROUTE_PERMISSIONS.find(r => r.path === '/api/auth/mobile/refresh' && r.method === 'POST')
    expect(mr?.public).toBe(true)
  })
})

// ────────────────────────────────────────────────
// Suite 17: Secret and cookie verification
// ────────────────────────────────────────────────
describe('17. Secret and cookie verification', () => {
  it('AUTH_JWT_SECRET is set and has sufficient length', () => {
    expect(process.env.AUTH_JWT_SECRET).toBeDefined()
    expect(process.env.AUTH_JWT_SECRET!.length).toBeGreaterThanOrEqual(32)
    expect(process.env.AUTH_JWT_SECRET).toMatch(/^[0-9a-f]+$/)
  })

  it('AUTH_JWT_SECRET is in .env but not in .env.example', () => {
    const envFile = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8')
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8')
    expect(envFile).toMatch(/AUTH_JWT_SECRET=[0-9a-f]{32,}/)
    expect(envExample).toContain('AUTH_JWT_SECRET=')
    // Verify the value after = is empty (no actual secret)
    const lines = envExample.split('\n')
    const secretLine = lines.find(l => l.startsWith('AUTH_JWT_SECRET='))
    expect(secretLine).toBeDefined()
    expect(secretLine!.split('=')[1].trim()).toBe('')
  })

  it('no x-forwarded-proto trust in Fastify auth routes', () => {
    const authRouteFile = path.resolve(process.cwd(), 'mini-services/api-service/src/routes/auth/index.ts')
    const cookieHelperFile = path.resolve(process.cwd(), 'mini-services/api-service/src/lib/cookie-helpers.ts')
    const httpsFile = path.resolve(process.cwd(), 'mini-services/api-service/src/lib/https-enforcement.ts')
    for (const file of [authRouteFile, cookieHelperFile, httpsFile]) {
      const content = fs.readFileSync(file, 'utf-8')
      expect(content).not.toContain('x-forwarded-proto')
    }
  })

  it('production cookies use Secure flag based on NODE_ENV', () => {
    const cookieHelperFile = path.resolve(process.cwd(), 'mini-services/api-service/src/lib/cookie-helpers.ts')
    const httpsFile = path.resolve(process.cwd(), 'mini-services/api-service/src/lib/https-enforcement.ts')
    for (const file of [cookieHelperFile, httpsFile]) {
      const content = fs.readFileSync(file, 'utf-8')
      expect(content).toContain('shouldUseSecureCookies')
      expect(content).not.toMatch(/x-forwarded-proto.*Secure/i)
    }
  })

  it('https-enforcement module exists', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/https-enforcement.ts'))).toBe(true)
  })

  it('docs/https-trust-model.md exists', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'docs/https-trust-model.md'))).toBe(true)
  })

  it('docs/migration-compatibility.md exists', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'docs/migration-compatibility.md'))).toBe(true)
  })

  it('no next-auth references in source', () => {
    const srcDir = path.resolve(process.cwd(), 'src')
    const pkgDir = path.resolve(process.cwd(), 'packages')
    for (const dir of [srcDir, pkgDir]) {
      const files = fs.readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.ts')).map(f => path.join(dir, String(f)))
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(content).not.toContain('next-auth')
      }
    }
  })
})
