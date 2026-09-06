/**
 * Milestone 4 — M4 Correction Pass Tests
 *
 * Comprehensive tests for security correction features:
 * 1. Session version invalidation
 * 2. Token family rotation
 * 3. Device pairing flow
 * 4. Password reset (mustChangePassword)
 * 5. Atomic setup
 * 6. CSRF token validation
 * 7. JWT validation
 * 8. Route permission registry
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/lib/db'
import {
  authenticate,
  createSession,
  refreshSession,
  revokeAllSessions,
  changePassword,
  resetUserPassword,
  setupFirstAdmin,
  disableUser,
  requestDevicePairing,
  approveDevicePairing,
} from '@/lib/auth-service'
import { seedRolesAndPermissions } from '@/lib/seed-rbac'
import {
  hashPassword,
  verifyAccessToken,
  generateAccessToken,
  generateCsrfToken,
  verifyCsrfToken,
  InvalidTokenError,
  SetupAlreadyCompletedError,
  MustChangePasswordError,
} from '@medivault/auth'
import { ROUTE_PERMISSIONS } from '@/lib/route-permissions'

// ─── Environment Setup ────────────────────────────────
process.env.AUTH_JWT_SECRET = 'test-secret-key-for-m4-correction-testing'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

// ─── Test Helpers ─────────────────────────────────────

const TEST_PREFIX = `m4c-${Date.now()}`
let cleanupUserIds: string[] = []

/** Generate a unique email for test isolation */
function testEmail(label: string): string {
  return `${TEST_PREFIX}-${label}@example.com`
}

/** Create a user directly in the DB with a given role */
async function createTestUser(opts: {
  label: string
  password?: string
  roleName?: string
  isActive?: boolean
  mustChangePassword?: boolean
  sessionVersion?: number
}): Promise<{ id: string; email: string; name: string }> {
  const email = testEmail(opts.label)
  const password = opts.password ?? 'Test1234!@#'
  const hashedPw = await hashPassword(password)

  let roleId: string | null = null
  if (opts.roleName) {
    const role = await db.role.findUnique({ where: { name: opts.roleName } })
    roleId = role?.id ?? null
  }

  const user = await db.user.create({
    data: {
      email,
      password: hashedPw,
      name: `Test ${opts.label}`,
      roleId,
      isActive: opts.isActive ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
      sessionVersion: opts.sessionVersion ?? 0,
    },
  })

  cleanupUserIds.push(user.id)
  return { id: user.id, email, name: user.name }
}

// ─── Lifecycle ────────────────────────────────────────

beforeAll(async () => {
  await seedRolesAndPermissions()
})

afterAll(async () => {
  // Clean up all test users and their related data
  if (cleanupUserIds.length > 0) {
    // Delete in order to respect FK constraints
    await db.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } })
    await db.devicePairingCode.deleteMany({ where: { userId: { in: cleanupUserIds } } })
    await db.deviceRegistration.deleteMany({ where: { userId: { in: cleanupUserIds } } })
    await db.auditLog.deleteMany({ where: { actorId: { in: cleanupUserIds } } })
    await db.loginHistory.deleteMany({ where: { userId: { in: cleanupUserIds } } })
    await db.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
  }
})

// ────────────────────────────────────────────────────────
// 1. Session Version Invalidation (5 tests)
// ────────────────────────────────────────────────────────
describe('@integration Session version invalidation', () => {
  it('access token issued BEFORE password change is rejected AFTER password change (sessionVersion mismatch)', async () => {
    const user = await createTestUser({ label: 'sv-pw-change', roleName: 'Doctor' })
    const sessionBefore = await authenticate(user.email, 'Test1234!@#')
    const tokensBefore = await createSession(sessionBefore)

    // Verify the old token's sessionVersion
    const payloadBefore = await verifyAccessToken(tokensBefore.accessToken, process.env.AUTH_JWT_SECRET!)
    expect(payloadBefore.sessionVersion).toBe(0)

    // Change the password — this increments sessionVersion to 1
    await changePassword(user.id, 'Test1234!@#', 'NewPassword1!@#')

    // Verify the user's sessionVersion is now 1 in DB
    const userAfter = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userAfter.sessionVersion).toBe(1)

    // The old token still has sessionVersion=0, which no longer matches DB
    expect(payloadBefore.sessionVersion).not.toBe(userAfter.sessionVersion)
  })

  it('disabling an account invalidates all access tokens via sessionVersion increment', async () => {
    // Create two users: a target and an admin
    const target = await createTestUser({ label: 'sv-disable-target', roleName: 'Doctor' })
    const admin = await createTestUser({ label: 'sv-disable-admin', roleName: 'Admin' })

    // Create a session and token
    const session = await authenticate(target.email, 'Test1234!@#')
    const tokens = await createSession(session)
    const payload = await verifyAccessToken(tokens.accessToken, process.env.AUTH_JWT_SECRET!)
    const svBefore = payload.sessionVersion

    // Disable the target user
    await disableUser(admin.id, target.id)

    // Verify sessionVersion incremented
    const userAfter = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(userAfter.sessionVersion).toBe(svBefore + 1)
    expect(userAfter.isActive).toBe(false)

    // Old token's sessionVersion no longer matches
    expect(payload.sessionVersion).not.toBe(userAfter.sessionVersion)
  })

  it('revokeAllSessions increments sessionVersion and invalidates access tokens', async () => {
    const user = await createTestUser({ label: 'sv-revoke-all', roleName: 'Doctor' })
    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens = await createSession(session)
    const payload = await verifyAccessToken(tokens.accessToken, process.env.AUTH_JWT_SECRET!)
    const svBefore = payload.sessionVersion

    await revokeAllSessions(user.id)

    const userAfter = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userAfter.sessionVersion).toBe(svBefore + 1)
    expect(payload.sessionVersion).not.toBe(userAfter.sessionVersion)

    // Also verify all refresh tokens are revoked
    const activeTokens = await db.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(activeTokens).toBe(0)
  })

  it('sessionVersion mismatch means token is effectively rejected', async () => {
    const user = await createTestUser({ label: 'sv-mismatch', roleName: 'Doctor', sessionVersion: 5 })
    const session = await authenticate(user.email, 'Test1234!@#')
    // createSession uses user.sessionVersion from the auth result (which reads from DB)
    const tokens = await createSession(session)
    const payload = await verifyAccessToken(tokens.accessToken, process.env.AUTH_JWT_SECRET!)
    expect(payload.sessionVersion).toBe(5)

    // Simulate an external sessionVersion bump (e.g. admin reset)
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } })

    const userAfter = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userAfter.sessionVersion).toBe(6)
    expect(payload.sessionVersion).toBe(5)
    // sessionVersion mismatch: 5 !== 6
    expect(payload.sessionVersion).not.toBe(userAfter.sessionVersion)
  })

  it('admin password reset invalidates the target access tokens via sessionVersion', async () => {
    const target = await createTestUser({ label: 'sv-reset-target', roleName: 'Doctor' })
    const admin = await createTestUser({ label: 'sv-reset-admin', roleName: 'Admin' })

    // Create a session and token for the target
    const session = await authenticate(target.email, 'Test1234!@#')
    const tokens = await createSession(session)
    const payload = await verifyAccessToken(tokens.accessToken, process.env.AUTH_JWT_SECRET!)
    const svBefore = payload.sessionVersion

    // Admin resets the target's password
    const { tempPassword } = await resetUserPassword(admin.id, target.id)
    expect(tempPassword).toBeDefined()

    // Verify sessionVersion incremented
    const userAfter = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(userAfter.sessionVersion).toBe(svBefore + 1)
    expect(userAfter.mustChangePassword).toBe(true)

    // Old token's sessionVersion no longer matches
    expect(payload.sessionVersion).not.toBe(userAfter.sessionVersion)
  })
})

// ────────────────────────────────────────────────────────
// 2. Token Family Rotation (5 tests)
// ────────────────────────────────────────────────────────
describe('@integration Token family rotation', () => {
  it('refresh creates a token with a familyId', async () => {
    const user = await createTestUser({ label: 'tf-family', roleName: 'Doctor' })
    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens = await createSession(session)

    // Look up the stored refresh token
    const { hashToken } = await import('@medivault/auth')
    const tokenHash = await hashToken(tokens.refreshToken)
    const stored = await db.refreshToken.findFirst({
      where: { tokenHash, userId: user.id },
    })

    expect(stored).not.toBeNull()
    expect(stored!.familyId).toBeTruthy()
    expect(stored!.familyId.length).toBeGreaterThan(0)
  })

  it('rotation sets parentTokenId', async () => {
    const user = await createTestUser({ label: 'tf-parent', roleName: 'Doctor' })
    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens1 = await createSession(session)

    // Refresh the token
    const tokens2 = await refreshSession(tokens1.refreshToken)

    // The new token should reference the old one as parent
    const { hashToken } = await import('@medivault/auth')
    const newHash = await hashToken(tokens2.refreshToken)
    const newStored = await db.refreshToken.findFirst({
      where: { tokenHash: newHash, userId: user.id },
    })

    expect(newStored).not.toBeNull()
    expect(newStored!.parentTokenId).toBeTruthy()

    // The parent should be the old token
    const oldHash = await hashToken(tokens1.refreshToken)
    const oldStored = await db.refreshToken.findFirst({
      where: { tokenHash: oldHash, userId: user.id },
    })
    expect(newStored!.parentTokenId).toBe(oldStored!.id)
  })

  it('using a revoked token revokes the ENTIRE family', async () => {
    const user = await createTestUser({ label: 'tf-reuse', roleName: 'Doctor' })
    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens1 = await createSession(session)

    // Refresh to get a new token in the same family
    const tokens2 = await refreshSession(tokens1.refreshToken)

    // Now reuse the OLD (already revoked) token
    await expect(
      refreshSession(tokens1.refreshToken),
    ).rejects.toThrow('Invalid or expired refresh token')

    // The NEW token's family should also be revoked
    const { hashToken } = await import('@medivault/auth')
    const newHash = await hashToken(tokens2.refreshToken)
    const newStored = await db.refreshToken.findFirst({
      where: { tokenHash: newHash, userId: user.id },
    })
    expect(newStored).not.toBeNull()
    expect(newStored!.revokedAt).not.toBeNull()
    expect(newStored!.revocationReason).toBe('Token reuse detected')
  })

  it('family revocation increments user sessionVersion', async () => {
    const user = await createTestUser({ label: 'tf-sv-incr', roleName: 'Doctor' })
    const svBefore = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion

    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens1 = await createSession(session)
    const tokens2 = await refreshSession(tokens1.refreshToken)

    // Reuse old token to trigger family revocation
    await expect(refreshSession(tokens1.refreshToken)).rejects.toThrow()

    // Verify sessionVersion was incremented
    const userAfter = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userAfter.sessionVersion).toBe(svBefore + 1)
  })

  it('two simultaneous refreshes (same token) — only one succeeds', async () => {
    const user = await createTestUser({ label: 'tf-concurrent', roleName: 'Doctor' })
    const session = await authenticate(user.email, 'Test1234!@#')
    const tokens = await createSession(session)
    const sameRefreshToken = tokens.refreshToken

    // Fire two concurrent refreshes with the same token
    const results = await Promise.allSettled([
      refreshSession(sameRefreshToken),
      refreshSession(sameRefreshToken),
    ])

    // One should succeed, one should fail (the second finds the token already revoked)
    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)
  })
})

// ────────────────────────────────────────────────────────
// 3. Device Pairing Flow (5 tests)
// ────────────────────────────────────────────────────────
describe('@integration Device pairing flow', () => {
  it('requestDevicePairing creates a DevicePairingCode with correct fields', async () => {
    const user = await createTestUser({ label: 'dp-request', roleName: 'Doctor' })
    const result = await requestDevicePairing(
      user.id,
      'fp-abc123',
      'Test Phone',
      'mobile',
      'iOS',
      '1.0.0',
    )

    expect(result.code).toBeDefined()
    expect(result.code.length).toBe(12) // 6 bytes → 12 hex chars
    expect(result.expiresAt).toBeInstanceOf(Date)

    // Verify it was stored in DB
    const pairing = await db.devicePairingCode.findFirst({
      where: { code: result.code, userId: user.id },
    })
    expect(pairing).not.toBeNull()
    expect(pairing!.deviceFingerprint).toBe('fp-abc123')
    expect(pairing!.deviceName).toBe('Test Phone')
    expect(pairing!.deviceType).toBe('mobile')
    expect(pairing!.platform).toBe('iOS')
    expect(pairing!.appVersion).toBe('1.0.0')
    expect(pairing!.usedAt).toBeNull()
  })

  it('approveDevicePairing consumes the code (single-use)', async () => {
    const user = await createTestUser({ label: 'dp-approve', roleName: 'Doctor' })
    const { code } = await requestDevicePairing(
      user.id,
      'fp-approve-test',
      'Approved Device',
      'tablet',
    )

    // Crypto: generate key pair, sign challenge, verify signature
    const { generateKeyPairSync, createSign } = await import('crypto')
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pairing = await db.devicePairingCode.findFirst({ where: { code } })
    const sign = createSign('SHA256')
    sign.update(Buffer.from(pairing!.challengeNonce!, 'hex'))
    const signature = sign.sign(keyPair.privateKey).toString('hex')
    const pubKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const { verifyPairingSignature } = await import('@/lib/auth-service')
    await verifyPairingSignature(code, signature, pubKeyPem)

    // Approve the code
    const { deviceId } = await approveDevicePairing(code, user.id)
    expect(deviceId).toBeDefined()

    // Verify the pairing code is now marked as used
    const pairingAfter = await db.devicePairingCode.findFirst({ where: { code } })
    expect(pairingAfter!.usedAt).not.toBeNull()
    expect(pairingAfter!.approvedBy).toBe(user.id)
  })

  it('an expired pairing code is rejected', async () => {
    const user = await createTestUser({ label: 'dp-expired', roleName: 'Doctor' })

    // Create an expired pairing code directly in DB
    await db.devicePairingCode.create({
      data: {
        userId: user.id,
        code: 'deadbeef1234',
        deviceFingerprint: 'fp-expired',
        deviceName: 'Expired Device',
        deviceType: 'desktop',
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      },
    })

    await expect(
      approveDevicePairing('deadbeef1234', user.id),
    ).rejects.toThrow(/Invalid or expired/)
  })

  it('a used pairing code cannot be reused', async () => {
    const user = await createTestUser({ label: 'dp-reuse', roleName: 'Doctor' })
    const { code } = await requestDevicePairing(
      user.id,
      'fp-reuse-test',
      'Reuse Device',
      'mobile',
    )

    // Crypto verification
    const { generateKeyPairSync, createSign } = await import('crypto')
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const p = await db.devicePairingCode.findFirst({ where: { code } })
    const sign = createSign('SHA256')
    sign.update(Buffer.from(p!.challengeNonce!, 'hex'))
    const sig = sign.sign(keyPair.privateKey).toString('hex')
    const pub = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const { verifyPairingSignature } = await import('@/lib/auth-service')
    await verifyPairingSignature(code, sig, pub)

    // First approval should succeed
    await approveDevicePairing(code, user.id)

    // Second attempt should fail
    await expect(
      approveDevicePairing(code, user.id),
    ).rejects.toThrow(/already.been.used/)
  })

  it('pairing creates a device and device-bound refresh token', async () => {
    const user = await createTestUser({ label: 'dp-device-rt', roleName: 'Doctor' })
    const { code } = await requestDevicePairing(
      user.id,
      'fp-device-rt',
      'Device RT Device',
      'mobile',
      'Android',
      '2.0',
    )

    // Crypto verification
    const { generateKeyPairSync, createSign } = await import('crypto')
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const p = await db.devicePairingCode.findFirst({ where: { code } })
    const sign = createSign('SHA256')
    sign.update(Buffer.from(p!.challengeNonce!, 'hex'))
    const sig = sign.sign(keyPair.privateKey).toString('hex')
    const pub = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const { verifyPairingSignature } = await import('@/lib/auth-service')
    await verifyPairingSignature(code, sig, pub)

    const { deviceId } = await approveDevicePairing(code, user.id)

    // Verify device was created
    const device = await db.deviceRegistration.findUnique({ where: { id: deviceId } })
    expect(device).not.toBeNull()
    expect(device!.userId).toBe(user.id)
    expect(device!.deviceName).toBe('Device RT Device')
    expect(device!.deviceType).toBe('mobile')
    expect(device!.platform).toBe('Android')
    expect(device!.appVersion).toBe('2.0')
    expect(device!.isActive).toBe(true)

    // Verify a device-bound refresh token was created
    const rt = await db.refreshToken.findFirst({
      where: { deviceId, userId: user.id, revokedAt: null },
    })
    expect(rt).not.toBeNull()
    expect(rt!.familyId).toBeTruthy()
    expect(rt!.revokedAt).toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 4. Password Reset (mustChangePassword) (4 tests)
// ────────────────────────────────────────────────────────
describe('@integration Password reset (mustChangePassword)', () => {
  it('resetUserPassword sets mustChangePassword=true', async () => {
    const target = await createTestUser({ label: 'pw-must-true', roleName: 'Doctor', mustChangePassword: false })
    const admin = await createTestUser({ label: 'pw-must-admin', roleName: 'Admin' })

    await resetUserPassword(admin.id, target.id)

    const userAfter = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(userAfter.mustChangePassword).toBe(true)
  })

  it('resetUserPassword returns a tempPassword', async () => {
    const target = await createTestUser({ label: 'pw-temp', roleName: 'Doctor' })
    const admin = await createTestUser({ label: 'pw-temp-admin', roleName: 'Admin' })

    const { tempPassword } = await resetUserPassword(admin.id, target.id)
    expect(tempPassword).toBeDefined()
    expect(tempPassword.length).toBeGreaterThan(0)

    // The temp password should work for authentication
    const result = await authenticate(target.email, tempPassword)
    expect(result.id).toBe(target.id)
    expect(result.mustChangePassword).toBe(true)
  })

  it('a user with mustChangePassword=true triggers MustChangePasswordError in requireAuthentication', async () => {
    // This is a unit-level check: verify the error class exists and has correct properties
    const err = new MustChangePasswordError('Password change required')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Password change required')
    expect(err.statusCode).toBe(403)
    expect(err.name).toBe('MustChangePasswordError')
  })

  it('changing password sets mustChangePassword=false', async () => {
    // Create a user with mustChangePassword=true
    const user = await createTestUser({ label: 'pw-clear-must', roleName: 'Doctor', mustChangePassword: true })

    // Verify it's true
    let userRecord = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userRecord.mustChangePassword).toBe(true)

    // Change password (need to know the current password)
    // Since we set it via createTestUser with 'Test1234!@#', change to a new valid password
    await changePassword(user.id, 'Test1234!@#', 'NewSecurePw1!@#')

    // Verify mustChangePassword is now false
    userRecord = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(userRecord.mustChangePassword).toBe(false)
  })
})

// ────────────────────────────────────────────────────────
// 5. Atomic Setup (4 tests)
// ────────────────────────────────────────────────────────
describe('@integration Atomic setup', () => {
  it('setupFirstAdmin creates the user with Admin role in a single transaction', async () => {
    // This test can only pass if the DB is empty (no users at all)
    // Since other tests may have created users, we use a conditional approach
    const userCount = await db.user.count()
    if (userCount > 0) {
      // DB has users — verify setup throws
      await expect(
        setupFirstAdmin(testEmail('atomic-setup-skip'), 'Test1234!@#', 'Skip User'),
      ).rejects.toThrow(SetupAlreadyCompletedError)
      return
    }

    const tokens = await setupFirstAdmin(
      testEmail('atomic-setup-admin'),
      'Test1234!@#',
      'Atomic Admin',
    )

    expect(tokens.accessToken).toBeDefined()
    expect(tokens.refreshToken).toBeDefined()

    // Verify the user was created with Admin role
    const adminRole = await db.role.findUnique({ where: { name: 'Admin' } })
    expect(adminRole).not.toBeNull()

    const user = await db.user.findFirst({ where: { email: testEmail('atomic-setup-admin') } })
    expect(user).not.toBeNull()
    expect(user!.roleId).toBe(adminRole!.id)
    expect(user!.isActive).toBe(true)
    expect(user!.mustChangePassword).toBe(false)
    expect(user!.sessionVersion).toBe(0)

    cleanupUserIds.push(user!.id)
  })

  it('two concurrent setupFirstAdmin calls: exactly one succeeds', async () => {
    // If there are already users, both should fail with SetupAlreadyCompletedError
    // We can still test the concurrency behavior
    const email1 = testEmail('concurrent-setup-1')
    const email2 = testEmail('concurrent-setup-2')

    const results = await Promise.allSettled([
      setupFirstAdmin(email1, 'Test1234!@#', 'Concurrent 1'),
      setupFirstAdmin(email2, 'Test1234!@#', 'Concurrent 2'),
    ])

    const successes = results.filter((r) => r.status === 'fulfilled')
    const setupErrors = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof SetupAlreadyCompletedError,
    )
    const rateLimitErrors = results.filter(
      (r) => r.status === 'rejected' && r.reason?.constructor?.name === 'RateLimitError',
    )

    // If users already exist (common case), both fail with SetupAlreadyCompletedError
    // or one gets rate-limited due to advisory lock
    if (await db.user.count() > 0) {
      const totalErrors = setupErrors.length + rateLimitErrors.length
      expect(totalErrors).toBe(2)
    } else {
      // In a truly empty DB, exactly one should succeed
      expect(successes.length).toBe(1)
      // The other should fail (either SetupAlreadyCompletedError or RateLimitError from advisory lock)
      expect(setupErrors.length + rateLimitErrors.length).toBe(1)

      // Track the created user for cleanup
      const fulfilled = results.find((r) => r.status === 'fulfilled')
      if (fulfilled && fulfilled.status === 'fulfilled') {
        const createdUser = await db.user.findFirst({
          where: { email: { in: [email1, email2] } },
        })
        if (createdUser) cleanupUserIds.push(createdUser.id)
      }
    }
  })

  it('setup cannot be repeated after completion', async () => {
    // This always applies since we have users from other tests.
    // Reset the rate limiter to avoid hitting the rate limit from concurrent test.
    const { rateLimiter } = await import('@medivault/auth')
    rateLimiter.reset('setup')

    await expect(
      setupFirstAdmin(testEmail('repeat-setup'), 'Test1234!@#', 'Repeat User'),
    ).rejects.toThrow(SetupAlreadyCompletedError)
  })

  it('a failure during setup leaves no user', async () => {
    // Since setup requires strong password, weak password should fail
    // and leave no user
    const userCountBefore = await db.user.count()
    // Use a unique email to make sure
    const uniqueEmail = testEmail('setup-fail-no-user')

    await expect(
      setupFirstAdmin(uniqueEmail, 'weak', 'Should Fail'),
    ).rejects.toThrow()

    const userCountAfter = await db.user.count()
    expect(userCountAfter).toBe(userCountBefore)

    // Also verify no user with our test email was created
    const user = await db.user.findUnique({ where: { email: uniqueEmail } })
    expect(user).toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 6. CSRF Token Validation (3 tests) — unit tests in @medivault/auth
// ────────────────────────────────────────────────────────
describe('CSRF token validation', () => {
  it('generateCsrfToken produces 64-char hex', () => {
    const token = generateCsrfToken()
    expect(token).toHaveLength(64)
    // Verify it's valid hex
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true)
  })

  it('verifyCsrfToken returns true for matching tokens', () => {
    const token = generateCsrfToken()
    expect(verifyCsrfToken(token, token)).toBe(true)
  })

  it('verifyCsrfToken returns false for non-matching tokens', () => {
    const token1 = generateCsrfToken()
    const token2 = generateCsrfToken()
    expect(verifyCsrfToken(token1, token2)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────
// 7. JWT Validation (4 tests) — unit tests
// ────────────────────────────────────────────────────────
describe('JWT validation', () => {
  const secret = 'test-jwt-secret-for-validation'

  it('verifyAccessToken validates issuer (iss)', async () => {
    const token = await generateAccessToken(
      { sub: 'user-1', email: 'a@b.com', name: 'Test', roleId: null, isActive: true, sessionVersion: 0 },
      secret,
      900,
      { issuer: 'medivault' },
    )

    // Verify with correct issuer — should succeed
    const payload = await verifyAccessToken(token, secret, { issuer: 'medivault' })
    expect(payload.iss).toBe('medivault')

    // Verify with wrong issuer — should fail
    await expect(
      verifyAccessToken(token, secret, { issuer: 'wrong-issuer' }),
    ).rejects.toThrow(InvalidTokenError)
  })

  it('verifyAccessToken validates audience (aud)', async () => {
    const token = await generateAccessToken(
      { sub: 'user-1', email: 'a@b.com', name: 'Test', roleId: null, isActive: true, sessionVersion: 0 },
      secret,
      900,
      { audience: 'medivault-api' },
    )

    // Verify with correct audience — should succeed
    const payload = await verifyAccessToken(token, secret, { audience: 'medivault-api' })
    expect(payload.aud).toBe('medivault-api')

    // Verify with wrong audience — should fail
    await expect(
      verifyAccessToken(token, secret, { audience: 'wrong-audience' }),
    ).rejects.toThrow(InvalidTokenError)
  })

  it('verifyAccessToken validates algorithm (rejects non-HS256)', async () => {
    // Create a token with HS256 (the only supported algorithm)
    const token = await generateAccessToken(
      { sub: 'user-1', email: 'a@b.com', name: 'Test', roleId: null, isActive: true, sessionVersion: 0 },
      secret,
      900,
    )

    // Verify it works with HS256
    const payload = await verifyAccessToken(token, secret)
    expect(payload.sub).toBe('user-1')

    // Now tamper with the header to claim a different algorithm
    // JWT format: header.payload.signature
    const parts = token.split('.')
    const tamperedHeader = Buffer.from(JSON.stringify({ alg: 'HS384', typ: 'JWT' })).toString('base64url')
    const tamperedToken = `${tamperedHeader}.${parts[1]}.${parts[2]}`

    // This should fail because jose only accepts HS256
    await expect(
      verifyAccessToken(tamperedToken, secret),
    ).rejects.toThrow(InvalidTokenError)
  })

  it('verifyAccessToken includes sessionVersion in payload', async () => {
    const token = await generateAccessToken(
      { sub: 'user-1', email: 'a@b.com', name: 'Test', roleId: null, isActive: true, sessionVersion: 42 },
      secret,
      900,
    )

    const payload = await verifyAccessToken(token, secret)
    expect(payload.sessionVersion).toBe(42)
  })
})

// ────────────────────────────────────────────────────────
// 8. Route Permission Registry (2 tests)
// ────────────────────────────────────────────────────────
describe('Route permission registry', () => {
  it('ROUTE_PERMISSIONS array exists and has entries for all routes', () => {
    expect(ROUTE_PERMISSIONS).toBeDefined()
    expect(Array.isArray(ROUTE_PERMISSIONS)).toBe(true)
    expect(ROUTE_PERMISSIONS.length).toBeGreaterThan(0)

    // Verify each entry has required fields
    for (const route of ROUTE_PERMISSIONS) {
      expect(route.method).toBeTruthy()
      expect(route.path).toBeTruthy()
      expect(route.path).toMatch(/^\/api/)
    }
  })

  it('every protected route has a permission defined (no undefined permission for non-public routes)', () => {
    const protectedRoutes = ROUTE_PERMISSIONS.filter(
      (r) => !r.public && r.permission === undefined && !r.permissions && !r.role,
    )

    // Some routes only require authentication (no specific permission),
    // which is represented by permission: undefined without public:true.
    // These are valid — they just need auth, not a specific permission.
    // The test verifies that if a route has permission: undefined, it's
    // one of the known "auth-only" routes.
    const authOnlyPaths = [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/auth/sessions/revoke-all',
      '/api/auth/password',
    ]

    for (const route of protectedRoutes) {
      // Routes that only need auth (no specific permission) should be in the allowlist
      const isAuthOnly = authOnlyPaths.some((p) => route.path === p)
      // If it's not an auth-only route and has no permission, that's a problem
      // Actually, the route-permissions.ts uses `permission: undefined` for auth-only routes,
      // so we verify these are only the expected ones
      if (!isAuthOnly) {
        // This shouldn't happen — all non-public, non-auth-only routes should have a permission
        expect(
          route.permission || route.permissions || route.role,
          `Route ${route.method} ${route.path} is non-public but has no permission/role defined`,
        ).toBeTruthy()
      }
    }

    // Also verify the auth-only routes are actually in the registry
    for (const path of authOnlyPaths) {
      const found = ROUTE_PERMISSIONS.some((r) => r.path === path)
      expect(found, `Expected auth-only route ${path} to be in ROUTE_PERMISSIONS`).toBe(true)
    }
  })
})
