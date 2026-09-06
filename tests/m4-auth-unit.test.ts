/**
 * Milestone 4 — Auth Unit Tests
 *
 * Tests for @medivault/auth package modules (no DB needed).
 * Covers: password validation, JWT tokens, refresh token hashing,
 * rate limiter, and RBAC helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validatePasswordStrength,
  generateAccessToken,
  verifyAccessToken,
  hashToken,
  verifyTokenHash,
  RateLimiter,
  hasPermission,
  hasAnyPermission,
  hasRole,
  PERMISSIONS,
  ROLES,
  InvalidTokenError,
  TokenReuseError,
} from '@medivault/auth'

// ─── Environment Setup ────────────────────────────────
process.env.AUTH_JWT_SECRET = 'test-secret-key-for-m4-testing'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

// ────────────────────────────────────────────────────────
// 1. Password Strength Validation
// ────────────────────────────────────────────────────────
describe('Password strength validation', () => {
  it('rejects too short (< 10 chars)', () => {
    const result = validatePasswordStrength('Ab1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must be at least 10 characters long')
  })

  it('rejects missing uppercase', () => {
    const result = validatePasswordStrength('abcdefghijkl1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one uppercase letter')
  })

  it('rejects missing lowercase', () => {
    const result = validatePasswordStrength('ABCDEFGHIJKL1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one lowercase letter')
  })

  it('rejects missing digit', () => {
    const result = validatePasswordStrength('Abcdefghij!!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one digit')
  })

  it('rejects missing special char', () => {
    const result = validatePasswordStrength('Abcdefghij12')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one special character')
  })

  it('accepts valid password Test1234!@#', () => {
    const result = validatePasswordStrength('Test1234!@#')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────
// 2. JWT Access Tokens
// ────────────────────────────────────────────────────────
describe('JWT tokens', () => {
  const secret = 'test-secret-key-for-m4-testing'
  const input = {
    sub: 'user-uuid-001',
    email: 'test@example.com',
    name: 'Test User',
    roleId: 'role-uuid-001',
    isActive: true,
    sessionVersion: 0,
  }

  it('generateAccessToken and verifyAccessToken round-trip', async () => {
    const token = await generateAccessToken(input, secret)
    const payload = await verifyAccessToken(token, secret)

    expect(payload.sub).toBe(input.sub)
    expect(payload.email).toBe(input.email)
    expect(payload.name).toBe(input.name)
    expect(payload.roleId).toBe(input.roleId)
    expect(payload.isActive).toBe(input.isActive)
    expect(payload.iat).toBeTypeOf('number')
    expect(payload.exp).toBeTypeOf('number')
  })

  it('expired token throws InvalidTokenError', async () => {
    // Generate a token that expires in 0 seconds
    const token = await generateAccessToken(input, secret, 0)
    // Wait a tiny moment to ensure it's expired
    await new Promise((r) => setTimeout(r, 50))

    await expect(verifyAccessToken(token, secret)).rejects.toThrow(TokenReuseError)
  })

  it('token with wrong secret throws InvalidTokenError', async () => {
    const token = await generateAccessToken(input, secret)
    await expect(verifyAccessToken(token, 'wrong-secret')).rejects.toThrow(InvalidTokenError)
  })
})

// ────────────────────────────────────────────────────────
// 3. Refresh Token Hashing
// ────────────────────────────────────────────────────────
describe('Refresh token hashing', () => {
  it('hashToken and verifyTokenHash round-trip', async () => {
    const token = 'abcd1234-efgh-5678-ijkl-9012mnop3456'
    const hash = await hashToken(token)
    const valid = await verifyTokenHash(token, hash)
    expect(valid).toBe(true)
  })

  it('different token does not match hash', async () => {
    const token1 = 'token-one-abc-123'
    const token2 = 'token-two-def-456'
    const hash = await hashToken(token1)
    const valid = await verifyTokenHash(token2, hash)
    expect(valid).toBe(false)
  })
})

// ────────────────────────────────────────────────────────
// 4. Rate Limiter
// ────────────────────────────────────────────────────────
describe('Rate limiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter()
  })

  afterEach(() => {
    limiter.destroy()
  })

  it('allows first N requests', () => {
    const maxAttempts = 5
    for (let i = 0; i < maxAttempts; i++) {
      const result = limiter.check('test-key', maxAttempts, 60_000)
      expect(result.allowed).toBe(true)
      expect(result.retryAfterMs).toBe(0)
    }
  })

  it('blocks N+1 request', () => {
    const maxAttempts = 5
    // Exhaust the limit
    for (let i = 0; i < maxAttempts; i++) {
      limiter.check('test-key', maxAttempts, 60_000)
    }
    // Next one should be blocked
    const result = limiter.check('test-key', maxAttempts, 60_000)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('allows again after window expires', async () => {
    // Create a limiter with a very short window (50ms)
    const shortLimiter = new RateLimiter()
    try {
      const maxAttempts = 3
      const shortWindow = 50

      // Exhaust the limit
      for (let i = 0; i < maxAttempts; i++) {
        shortLimiter.check('short-key', maxAttempts, shortWindow)
      }
      // Next one should be blocked
      let result = shortLimiter.check('short-key', maxAttempts, shortWindow)
      expect(result.allowed).toBe(false)

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 80))

      // Should be allowed again
      result = shortLimiter.check('short-key', maxAttempts, shortWindow)
      expect(result.allowed).toBe(true)
    } finally {
      shortLimiter.destroy()
    }
  })
})

// ────────────────────────────────────────────────────────
// 5. RBAC
// ────────────────────────────────────────────────────────
describe('RBAC', () => {
  it('hasPermission returns true when permission is in list', () => {
    const perms = ['patient:view', 'patient:create', 'patient:edit']
    expect(hasPermission(perms, 'patient:view')).toBe(true)
    expect(hasPermission(perms, 'patient:create')).toBe(true)
    expect(hasPermission(perms, 'patient:edit')).toBe(true)
  })

  it('hasPermission returns false when not in list', () => {
    const perms = ['patient:view', 'patient:create']
    expect(hasPermission(perms, 'patient:delete')).toBe(false)
    expect(hasPermission(perms, 'users:view')).toBe(false)
  })

  it('hasAnyPermission returns true when any match', () => {
    const perms = ['patient:view', 'document:view']
    expect(hasAnyPermission(perms, ['patient:create', 'patient:view'])).toBe(true)
    expect(hasAnyPermission(perms, ['users:delete', 'document:view'])).toBe(true)
  })

  it('hasAnyPermission returns false when none match', () => {
    const perms = ['patient:view', 'document:view']
    expect(hasAnyPermission(perms, ['users:delete', 'purge:approve'])).toBe(false)
  })

  it('hasRole returns true when role matches', () => {
    expect(hasRole('Admin', 'Admin')).toBe(true)
    expect(hasRole('Doctor', 'Doctor')).toBe(true)
  })

  it('hasRole returns false when role does not match', () => {
    expect(hasRole('Doctor', 'Admin')).toBe(false)
    expect(hasRole(null, 'Admin')).toBe(false)
    expect(hasRole('ReadOnly', 'Admin')).toBe(false)
  })

  it('ROLES object has Admin, Doctor, Assistant, ReadOnly', () => {
    expect(ROLES).toHaveProperty('Admin')
    expect(ROLES).toHaveProperty('Doctor')
    expect(ROLES).toHaveProperty('Assistant')
    expect(ROLES).toHaveProperty('ReadOnly')
  })

  it('Admin has all permissions', () => {
    const allPerms = Object.keys(PERMISSIONS)
    const adminPerms = ROLES.Admin
    for (const perm of allPerms) {
      expect(adminPerms).toContain(perm)
    }
  })

  it('Doctor does not have users:delete or purge:approve', () => {
    const doctorPerms = ROLES.Doctor
    expect(doctorPerms).not.toContain('users:delete')
    expect(doctorPerms).not.toContain('purge:approve')
  })

  it('ReadOnly only has :view permissions', () => {
    const readOnlyPerms = ROLES.ReadOnly
    for (const perm of readOnlyPerms) {
      expect(perm).toMatch(/:view$/)
    }
  })
})
