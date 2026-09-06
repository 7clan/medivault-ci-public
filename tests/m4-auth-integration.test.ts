/**
 * Milestone 4 — Auth Integration Tests
 *
 * Tests for auth-service.ts functions that require a real database.
 * Marked with @integration tag.
 *
 * Test isolation: creates test users via Prisma, cleans up after.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { db } from '@/lib/db'
import {
  authenticate,
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  changePassword,
  resetUserPassword,
  setupFirstAdmin,
  getUserPermissions,
  getUserRoleName,
  disableUser,
  enableUser,
  registerDevice,
  revokeDevice,
} from '@/lib/auth-service'
import { seedRolesAndPermissions } from '@/lib/seed-rbac'
import { hashPassword } from '@medivault/auth'
import { PrismaClient } from '@prisma/client'
import {
  AuthenticationError,
  AccountLockedError,
  SetupAlreadyCompletedError,
  AuthorizationError,
  SECURITY_ACTIONS,
  rateLimiter,
} from '@medivault/auth'

// ─── Environment Setup ────────────────────────────────
process.env.AUTH_JWT_SECRET = 'test-secret-key-for-m4-testing'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

// ─── Test Helpers ─────────────────────────────────────

const TEST_PREFIX = `m4-test-${Date.now()}`
let cleanupUserIds: string[] = []
let cleanupRoleIds: string[] = []
let cleanupDeviceIds: string[] = []

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
      mustChangePassword: false,
      sessionVersion: 0,
    },
  })

  cleanupUserIds.push(user.id)
  return { id: user.id, email, name: user.name }
}

// ────────────────────────────────────────────────────────
// 1. Initial Admin Setup
// ────────────────────────────────────────────────────────
describe('@integration Initial admin setup', () => {
  it('setupFirstAdmin creates user with Admin role when DB is empty', async () => {
    const userCount = await db.user.count()
    if (userCount === 0) {
      // DB is empty — actually call setupFirstAdmin
      const tokens = await setupFirstAdmin(
        testEmail('first-admin-setup'),
        'Test1234!@#',
        'Admin User',
      )
      expect(tokens.accessToken).toBeDefined()
      expect(tokens.refreshToken).toBeDefined()

      // Verify the user was created with Admin role
      const adminRole = await db.role.findUnique({ where: { name: 'Admin' } })
      expect(adminRole).not.toBeNull()
      const user = await db.user.findFirst({ where: { roleId: adminRole!.id } })
      expect(user).not.toBeNull()
      expect(user!.email).toContain('first-admin-setup')
    } else {
      // DB has users — calling setupFirstAdmin should throw
      await expect(
        setupFirstAdmin(testEmail('first-admin-setup'), 'Test1234!@#', 'Admin User'),
      ).rejects.toThrow(SetupAlreadyCompletedError)
    }
  })

  it('Second setup call throws SetupAlreadyCompletedError', async () => {
    // After the first test (or if DB already had users), userCount > 0
    const userCount = await db.user.count()
    if (userCount > 0) {
      await expect(
        setupFirstAdmin(testEmail('second-setup'), 'Test1234!@#', 'Admin User'),
      ).rejects.toThrow(SetupAlreadyCompletedError)
    } else {
      // DB is empty (shouldn't normally happen after first test)
      // Do setup then verify second call throws
      await setupFirstAdmin(testEmail('second-setup-pre'), 'Test1234!@#', 'Admin')
      await expect(
        setupFirstAdmin(testEmail('second-setup-post'), 'Test1234!@#', 'Admin'),
      ).rejects.toThrow(SetupAlreadyCompletedError)
    }
  })

  it('Created admin user can authenticate with correct password', async () => {
    // Create our own admin user to test authentication
    const testUser = await createTestUser({ label: 'admin-auth-test', roleName: 'Admin' })
    const result = await authenticate(testUser.email, 'Test1234!@#')
    expect(result.email).toBe(testUser.email)
    expect(result.role?.name).toBe('Admin')
    expect(result.mustChangePassword).toBe(false)
    expect(typeof result.sessionVersion).toBe('number')
  })
})

// ────────────────────────────────────────────────────────
// 2. Login Tests
// ────────────────────────────────────────────────────────
describe('@integration Login tests', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'login', roleName: 'Doctor' })
  })

  it('Correct credentials returns user', async () => {
    const result = await authenticate(testUser.email, 'Test1234!@#')
    expect(result.id).toBe(testUser.id)
    expect(result.email).toBe(testUser.email)
    expect(result.isActive).toBe(true)
  })

  it('Wrong password throws AuthenticationError("Invalid credentials")', async () => {
    try {
      await authenticate(testUser.email, 'WrongPassword1!')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
      expect((err as AuthenticationError).message).toBe('Invalid credentials')
    }
  })

  it('Unknown email throws AuthenticationError (same generic message)', async () => {
    try {
      await authenticate('nonexistent-' + Date.now() + '@example.com', 'Test1234!@#')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
      expect((err as AuthenticationError).message).toBe('Invalid credentials')
    }
  })

  it('Disabled account throws AuthenticationError', async () => {
    const disabledUser = await createTestUser({
      label: 'login-disabled',
      roleName: 'Doctor',
      isActive: false,
    })
    try {
      await authenticate(disabledUser.email, 'Test1234!@#')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
    }
  })
})

// ────────────────────────────────────────────────────────
// 3. Lockout Tests
// ────────────────────────────────────────────────────────
describe('@integration Lockout tests', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'lockout', roleName: 'Doctor' })
  })

  it('5 failed attempts locks account for 15 minutes', async () => {
    // Reset any previous failed attempts and rate limiter
    await db.user.update({
      where: { id: testUser.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })
    rateLimiter.reset(`login:${testUser.email}`)

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      try {
        await authenticate(testUser.email, `WrongPass${i}!`)
      } catch {
        // Expected
      }
    }

    // Reset the rate limiter so the 6th attempt isn't blocked by it
    rateLimiter.reset(`login:${testUser.email}`)

    // 6th attempt should throw AccountLockedError
    try {
      await authenticate(testUser.email, 'Test1234!@#')
      expect.unreachable('Should have thrown AccountLockedError')
    } catch (err) {
      expect(err).toBeInstanceOf(AccountLockedError)
      const lockErr = err as AccountLockedError
      expect(lockErr.retryAfterMs).toBeGreaterThan(0)
      expect(lockErr.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000)
    }
  })

  it('AccountLockedError thrown with retryAfterMs', async () => {
    // The lock should still be in effect
    const user = await db.user.findUnique({ where: { id: testUser.id } })
    expect(user!.lockedUntil).not.toBeNull()

    // Reset rate limiter so the check reaches the DB lock check
    rateLimiter.reset(`login:${testUser.email}`)

    try {
      await authenticate(testUser.email, 'Test1234!@#')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AccountLockedError)
      expect((err as AccountLockedError).retryAfterMs).toBeTypeOf('number')
    }
  })

  it('After lockout expires, can try again', async () => {
    // Set lockedUntil to the past directly in DB
    await db.user.update({
      where: { id: testUser.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    })

    // Reset failedLoginAttempts so we don't immediately re-lock
    await db.user.update({
      where: { id: testUser.id },
      data: { failedLoginAttempts: 0 },
    })

    // Reset rate limiter
    rateLimiter.reset(`login:${testUser.email}`)

    // Should be able to authenticate now
    const result = await authenticate(testUser.email, 'Test1234!@#')
    expect(result.id).toBe(testUser.id)
  })
})

// ────────────────────────────────────────────────────────
// 4. Password Change
// ────────────────────────────────────────────────────────
describe('@integration Password change', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'pwchange', roleName: 'Doctor' })
  })

  it('changePassword with correct current password succeeds', async () => {
    await expect(
      changePassword(testUser.id, 'Test1234!@#', 'NewPassword1!@#'),
    ).resolves.not.toThrow()
  })

  it('changePassword with wrong current password throws AuthenticationError', async () => {
    try {
      await changePassword(testUser.id, 'WrongOldPw1!@#', 'AnotherNew1!@#')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
      expect((err as AuthenticationError).message).toContain('Current password is incorrect')
    }
  })

  it('changePassword with weak new password throws error', async () => {
    try {
      await changePassword(testUser.id, 'NewPassword1!@#', 'weak')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
      expect((err as AuthenticationError).message).toContain('Password must be at least')
    }
  })

  it('After password change, old refresh tokens are revoked', async () => {
    // Reset password to something we know
    await db.user.update({
      where: { id: testUser.id },
      data: { password: await hashPassword('CurrentPw123!@#') },
    })

    // Create a session (which creates a refresh token)
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    // Verify the refresh token exists and is not revoked
    const tokenHash = await import('@medivault/auth').then(m => m.hashToken(tokens.refreshToken))
    let storedToken = await db.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
    })
    expect(storedToken).not.toBeNull()

    // Change password
    await changePassword(testUser.id, 'CurrentPw123!@#', 'AfterChange1!@#')

    // Old refresh token should now be revoked
    storedToken = await db.refreshToken.findFirst({
      where: { tokenHash },
    })
    expect(storedToken!.revokedAt).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 5. Admin Password Reset
// ────────────────────────────────────────────────────────
describe('@integration Admin password reset', () => {
  let adminUser: { id: string; email: string; name: string }
  let targetUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    adminUser = await createTestUser({ label: 'admin-reset', roleName: 'Admin' })
    targetUser = await createTestUser({ label: 'target-reset', roleName: 'Doctor' })
  })

  it('Admin can reset another user\'s password', async () => {
    const result = await resetUserPassword(adminUser.id, targetUser.id)
    expect(result.tempPassword).toBeDefined()
    expect(typeof result.tempPassword).toBe('string')
    expect(result.tempPassword.length).toBeGreaterThan(0)

    // Target user should have mustChangePassword = true
    const target = await db.user.findUnique({ where: { id: targetUser.id } })
    expect(target!.mustChangePassword).toBe(true)
  })

  it('User\'s old sessions are invalidated', async () => {
    // Reset password back to known value and clear mustChangePassword
    await db.user.update({
      where: { id: targetUser.id },
      data: { password: await hashPassword('BeforeReset1!@#'), mustChangePassword: false },
    })

    // Create a session
    const user = await db.user.findUnique({ where: { id: targetUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    // Reset password (auto-generates temp password)
    const resetResult = await resetUserPassword(adminUser.id, targetUser.id)
    expect(resetResult.tempPassword).toBeDefined()

    // Target should have mustChangePassword = true
    const target = await db.user.findUnique({ where: { id: targetUser.id } })
    expect(target!.mustChangePassword).toBe(true)

    // Old refresh token should be revoked
    const hashModule = await import('@medivault/auth')
    const tokenHash = await hashModule.hashToken(tokens.refreshToken)
    const storedToken = await db.refreshToken.findFirst({ where: { tokenHash } })
    expect(storedToken!.revokedAt).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 6. Session Management
// ────────────────────────────────────────────────────────
describe('@integration Session management', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'session', roleName: 'Doctor' })
  })

  it('createSession returns accessToken and refreshToken', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    expect(tokens.accessToken).toBeDefined()
    expect(tokens.refreshToken).toBeDefined()
    expect(tokens.expiresIn).toBe(15 * 60) // 15 minutes
    expect(typeof tokens.accessToken).toBe('string')
    expect(typeof tokens.refreshToken).toBe('string')
  })

  it('refreshToken can be used with refreshSession to get new tokens', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    const newTokens = await refreshSession(tokens.refreshToken)

    expect(newTokens.accessToken).toBeDefined()
    expect(newTokens.refreshToken).toBeDefined()
    expect(newTokens.refreshToken).not.toBe(tokens.refreshToken) // Token rotation
  })

  it('Old refreshToken is revoked after use', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    // Use the refresh token
    await refreshSession(tokens.refreshToken)

    // The old token should now be revoked
    const hashModule = await import('@medivault/auth')
    const tokenHash = await hashModule.hashToken(tokens.refreshToken)
    const storedToken = await db.refreshToken.findFirst({ where: { tokenHash } })
    expect(storedToken!.revokedAt).not.toBeNull()
  })

  it('Reusing a revoked refreshToken revokes tokens in the same family (token reuse detection)', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const sessionVersionBefore = user!.sessionVersion

    // Create a session and refresh it to get session2 (same family)
    const session1 = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })
    const session2Tokens = await refreshSession(session1.refreshToken)

    // Now reuse the OLD session1 refresh token — should trigger reuse detection
    try {
      await refreshSession(session1.refreshToken)
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
    }

    // session2's token should be revoked via family revocation
    const hashModule = await import('@medivault/auth')
    const session2Hash = await hashModule.hashToken(session2Tokens.refreshToken)
    const session2Token = await db.refreshToken.findFirst({ where: { tokenHash: session2Hash } })
    expect(session2Token!.revokedAt).not.toBeNull()
    expect(session2Token!.revocationReason).toBe('Token reuse detected')

    // User's sessionVersion should have been incremented
    const updatedUser = await db.user.findUnique({ where: { id: testUser.id } })
    expect(updatedUser!.sessionVersion).toBe(sessionVersionBefore + 1)
  })

  it('revokeSession works', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!
    const tokens = await createSession({
      id: user!.id,
      email: user!.email,
      name: user!.name,
      roleId: user!.roleId,
      isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    await revokeSession(tokens.refreshToken, testUser.id)

    const hashModule = await import('@medivault/auth')
    const tokenHash = await hashModule.hashToken(tokens.refreshToken)
    const storedToken = await db.refreshToken.findFirst({ where: { tokenHash } })
    expect(storedToken!.revokedAt).not.toBeNull()
  })

  it('revokeAllSessions revokes all tokens', async () => {
    const user = await db.user.findUnique({ where: { id: testUser.id } })!

    // Create multiple sessions
    const tokens1 = await createSession({
      id: user!.id, email: user!.email, name: user!.name,
      roleId: user!.roleId, isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })
    const tokens2 = await createSession({
      id: user!.id, email: user!.email, name: user!.name,
      roleId: user!.roleId, isActive: user!.isActive,
      sessionVersion: user!.sessionVersion,
    })

    // Revoke all
    await revokeAllSessions(testUser.id, testUser.id)

    const hashModule = await import('@medivault/auth')
    const hash1 = await hashModule.hashToken(tokens1.refreshToken)
    const hash2 = await hashModule.hashToken(tokens2.refreshToken)

    const token1 = await db.refreshToken.findFirst({ where: { tokenHash: hash1 } })
    const token2 = await db.refreshToken.findFirst({ where: { tokenHash: hash2 } })

    expect(token1!.revokedAt).not.toBeNull()
    expect(token2!.revokedAt).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 7. Device Registration
// ────────────────────────────────────────────────────────
describe('@integration Device registration', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'device', roleName: 'Doctor' })
  })

  it('registerDevice creates DeviceRegistration', async () => {
    const device = await registerDevice(
      testUser.id,
      'Test iPhone',
      'mobile',
      'iOS 17',
      '1.0.0',
      '192.168.1.1',
    )

    expect(device.id).toBeDefined()
    expect(device.deviceName).toBe('Test iPhone')
    expect(device.deviceType).toBe('mobile')
    expect(device.isActive).toBe(true)
    cleanupDeviceIds.push(device.id)
  })

  it('Reaching max device limit throws error', async () => {
    // Set max_devices_per_user to 1
    await db.configuration.upsert({
      where: { key: 'max_devices_per_user' },
      update: { value: '1' },
      create: { key: 'max_devices_per_user', value: '1' },
    })

    // Count existing active devices
    const activeCount = await db.deviceRegistration.count({
      where: { userId: testUser.id, isActive: true },
    })

    // Try to register one more — will fail if already at limit
    if (activeCount >= 1) {
      try {
        await registerDevice(testUser.id, 'Extra Device', 'mobile', 'iOS', '2.0', '10.0.0.1')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthorizationError)
        expect((err as AuthorizationError).message).toContain('Maximum number of devices')
      }
    } else {
      // Register one to reach the limit
      const device = await registerDevice(testUser.id, 'Fill Device', 'mobile', 'iOS', '1.0', '10.0.0.1')
      cleanupDeviceIds.push(device.id)

      // Next one should fail
      try {
        await registerDevice(testUser.id, 'Overflow Device', 'mobile', 'iOS', '2.0', '10.0.0.2')
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthorizationError)
        expect((err as AuthorizationError).message).toContain('Maximum number of devices')
      }
    }

    // Restore default
    await db.configuration.upsert({
      where: { key: 'max_devices_per_user' },
      update: { value: '10' },
      create: { key: 'max_devices_per_user', value: '10' },
    })
  })

  it('revokeDevice marks device inactive and revokes its tokens', async () => {
    // First, allow more devices
    await db.configuration.upsert({
      where: { key: 'max_devices_per_user' },
      update: { value: '10' },
      create: { key: 'max_devices_per_user', value: '10' },
    })

    const user = await db.user.findUnique({ where: { id: testUser.id } })!

    // Register a device first
    const device = await registerDevice(
      testUser.id,
      'Revoke Test Device',
      'mobile',
      'iOS',
      '1.0',
      '192.168.1.1',
    )
    cleanupDeviceIds.push(device.id)

    // Create a session linked to this device
    const tokens = await createSession(
      {
        id: user!.id, email: user!.email, name: user!.name,
        roleId: user!.roleId, isActive: user!.isActive,
        sessionVersion: user!.sessionVersion,
      },
      '192.168.1.1',
      'test-agent',
      device.id,
    )

    // Revoke the device
    await revokeDevice(testUser.id, device.id, testUser.id)

    // Device should be inactive
    const updatedDevice = await db.deviceRegistration.findUnique({ where: { id: device.id } })
    expect(updatedDevice!.isActive).toBe(false)

    // Token should be revoked
    const hashModule = await import('@medivault/auth')
    const tokenHash = await hashModule.hashToken(tokens.refreshToken)
    const storedToken = await db.refreshToken.findFirst({ where: { tokenHash, deviceId: device.id } })
    expect(storedToken!.revokedAt).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 8. Role and Permission Checks
// ────────────────────────────────────────────────────────
describe('@integration Role and permission checks', () => {
  it('seedRolesAndPermissions creates all roles and permissions', async () => {
    await seedRolesAndPermissions()

    const roles = await db.role.findMany()
    const roleNames = roles.map((r) => r.name)
    expect(roleNames).toContain('Admin')
    expect(roleNames).toContain('Doctor')
    expect(roleNames).toContain('Assistant')
    expect(roleNames).toContain('ReadOnly')

    const permissions = await db.permission.findMany()
    expect(permissions.length).toBeGreaterThan(0)
  })

  it('getUserPermissions returns correct permissions for each role', async () => {
    // Test with a Doctor user
    const doctorUser = await createTestUser({ label: 'perms-doctor', roleName: 'Doctor' })
    const doctorPerms = await getUserPermissions(doctorUser.id)

    expect(doctorPerms).toContain('patient:view')
    expect(doctorPerms).toContain('patient:create')
    expect(doctorPerms).toContain('document:view')
    expect(doctorPerms).toContain('notes:view')
    // Doctor should NOT have these
    expect(doctorPerms).not.toContain('users:delete')
    expect(doctorPerms).not.toContain('purge:approve')
  })

  it('Assigning a user to Doctor role gives Doctor permissions', async () => {
    const user = await createTestUser({ label: 'role-assign-no-role' })

    // Without a role, should have no permissions
    const noRolePerms = await getUserPermissions(user.id)
    expect(noRolePerms).toHaveLength(0)

    // Assign Doctor role
    const doctorRole = await db.role.findUnique({ where: { name: 'Doctor' } })
    await db.user.update({
      where: { id: user.id },
      data: { roleId: doctorRole!.id },
    })

    const doctorPerms = await getUserPermissions(user.id)
    expect(doctorPerms.length).toBeGreaterThan(0)
    expect(doctorPerms).toContain('patient:view')
  })
})

// ────────────────────────────────────────────────────────
// 9. Account Enable/Disable
// ────────────────────────────────────────────────────────
describe('@integration Account enable/disable', () => {
  let adminUser: { id: string; email: string; name: string }
  let targetUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    adminUser = await createTestUser({ label: 'admin-enable', roleName: 'Admin' })
    targetUser = await createTestUser({ label: 'target-enable', roleName: 'Doctor' })
  })

  it('disableUser sets isActive=false', async () => {
    await disableUser(adminUser.id, targetUser.id)

    const user = await db.user.findUnique({ where: { id: targetUser.id } })
    expect(user!.isActive).toBe(false)
  })

  it('Disabled user cannot authenticate', async () => {
    try {
      await authenticate(targetUser.email, 'Test1234!@#')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError)
      expect((err as AuthenticationError).message).toBe('Invalid credentials')
    }
  })

  it('enableUser sets isActive=true, clears lockout', async () => {
    // First, set a lock on the user
    await db.user.update({
      where: { id: targetUser.id },
      data: {
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        failedLoginAttempts: 5,
      },
    })

    await enableUser(adminUser.id, targetUser.id)

    const user = await db.user.findUnique({ where: { id: targetUser.id } })
    expect(user!.isActive).toBe(true)
    expect(user!.lockedUntil).toBeNull()
    expect(user!.failedLoginAttempts).toBe(0)
  })

  it('Re-enabled user can authenticate', async () => {
    const result = await authenticate(targetUser.email, 'Test1234!@#')
    expect(result.id).toBe(targetUser.id)
  })
})

// ────────────────────────────────────────────────────────
// 10. Audit and Login History
// ────────────────────────────────────────────────────────
describe('@integration Audit and login history', () => {
  let testUser: { id: string; email: string; name: string }

  beforeAll(async () => {
    testUser = await createTestUser({ label: 'audit', roleName: 'Doctor' })
  })

  it('Successful login creates LoginHistory(success=true)', async () => {
    // Clear any existing login history for this user
    await db.loginHistory.deleteMany({ where: { userId: testUser.id } })

    await authenticate(testUser.email, 'Test1234!@#', '127.0.0.1', 'test-agent')

    const history = await db.loginHistory.findMany({
      where: { userId: testUser.id, success: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    expect(history.length).toBe(1)
    expect(history[0].success).toBe(true)
    expect(history[0].ipAddress).toBe('127.0.0.1')
    expect(history[0].userAgent).toBe('test-agent')
  })

  it('Failed login creates LoginHistory(success=false)', async () => {
    // Clear history
    await db.loginHistory.deleteMany({ where: { userId: testUser.id } })

    try {
      await authenticate(testUser.email, 'WrongPw1!@#', '10.0.0.1', 'bad-agent')
    } catch {
      // Expected
    }

    const history = await db.loginHistory.findMany({
      where: { userId: testUser.id, success: false },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    expect(history.length).toBe(1)
    expect(history[0].success).toBe(false)
    expect(history[0].failureReason).toBe('Invalid credentials')
    expect(history[0].ipAddress).toBe('10.0.0.1')
  })

  it('Password change creates AuditLog(PASSWORD_CHANGE)', async () => {
    // Ensure the password is what we expect
    await db.user.update({
      where: { id: testUser.id },
      data: { password: await hashPassword('AuditTestPw1!@#') },
    })

    // Get current audit log count for PASSWORD_CHANGE
    const beforeCount = await db.auditLog.count({
      where: { actorId: testUser.id, action: SECURITY_ACTIONS.PASSWORD_CHANGE },
    })

    await changePassword(testUser.id, 'AuditTestPw1!@#', 'AuditNewPw1!@#')

    const afterCount = await db.auditLog.count({
      where: { actorId: testUser.id, action: SECURITY_ACTIONS.PASSWORD_CHANGE },
    })

    expect(afterCount).toBe(beforeCount + 1)
  })

  it('Device registration creates AuditLog(DEVICE_REGISTER)', async () => {
    const beforeCount = await db.auditLog.count({
      where: { actorId: testUser.id, action: SECURITY_ACTIONS.DEVICE_REGISTER },
    })

    const device = await registerDevice(
      testUser.id,
      'Audit Test Device',
      'mobile',
      'iOS',
      '1.0',
    )
    cleanupDeviceIds.push(device.id)

    const afterCount = await db.auditLog.count({
      where: { actorId: testUser.id, action: SECURITY_ACTIONS.DEVICE_REGISTER },
    })

    expect(afterCount).toBe(beforeCount + 1)
  })

  it('Audit logs do NOT contain passwords or tokens in details', async () => {
    // Collect all audit logs for our test user
    const logs = await db.auditLog.findMany({
      where: { actorId: testUser.id },
    })

    for (const log of logs) {
      const detailsStr = JSON.stringify(log.details)
      // Check for common password/token key names
      expect(detailsStr).not.toContain('password')
      expect(detailsStr).not.toContain('token')
      expect(detailsStr).not.toContain('secret')
      // Also check for the actual test password values
      expect(detailsStr).not.toContain('Test1234!@#')
      expect(detailsStr).not.toContain('AuditTestPw1!@#')
      expect(detailsStr).not.toContain('AuditNewPw1!@#')
    }
  })
})

// ────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────
afterAll(async () => {
  // Clean up all test users and their related data
  for (const userId of cleanupUserIds) {
    try {
      // Delete in order of dependencies
      await db.refreshToken.deleteMany({ where: { userId } })
      await db.loginHistory.deleteMany({ where: { userId } })
      await db.auditLog.deleteMany({ where: { actorId: userId } })
      await db.syncQueue.deleteMany({
        where: { device: { userId } },
      })
      await db.deviceRegistration.deleteMany({ where: { userId } })
      await db.clinicalNote.deleteMany({ where: { doctorId: userId } })
      await db.annotation.deleteMany({ where: { doctorId: userId } })
      await db.prescription.deleteMany({ where: { doctorId: userId } })
      await db.visit.deleteMany({ where: { doctorId: userId } })
      await db.documentVersion.deleteMany({ where: { createdBy: userId } })
      await db.user.delete({ where: { id: userId } })
    } catch {
      // Ignore cleanup errors
    }
  }
})
