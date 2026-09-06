/**
 * Milestone 4 — HTTPS Enforcement Tests
 *
 * Tests for enforceHttpsConfig() and shouldUseSecureCookies().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { enforceHttpsConfig, shouldUseSecureCookies } from '@/lib/https-enforcement'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  // Delete all env vars that these tests care about
  for (const key of ['NODE_ENV', 'HTTPS', 'NEXT_PUBLIC_BASE_URL', 'TRUSTED_LOCAL_TLS_TERMINATION'] as const) {
    delete (process.env as Record<string, string | undefined>)[key]
  }
  // Restore any that were originally set
  for (const key of ['NODE_ENV', 'HTTPS', 'NEXT_PUBLIC_BASE_URL', 'TRUSTED_LOCAL_TLS_TERMINATION'] as const) {
    if (ORIGINAL_ENV[key] !== undefined) {
      ;(process.env as Record<string, string | undefined>)[key] = ORIGINAL_ENV[key]
    }
  }
}

describe('enforceHttpsConfig', () => {
  beforeEach(() => {
    resetEnv()
  })

  afterEach(() => {
    resetEnv()
  })

  it('throws in production without HTTPS config and without trusted termination', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    // No HTTPS, no NEXT_PUBLIC_BASE_URL, no TRUSTED_LOCAL_TLS_TERMINATION
    expect(() => enforceHttpsConfig()).toThrow(/FATAL/)
  })

  it('does not throw in production with HTTPS=true', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).HTTPS = 'true'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('does not throw in production with NEXT_PUBLIC_BASE_URL=https://...', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).NEXT_PUBLIC_BASE_URL = 'https://medivault.example.com'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('does not throw in production with TRUSTED_LOCAL_TLS_TERMINATION=true', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('throws in production with NEXT_PUBLIC_BASE_URL=http://... (not https)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).NEXT_PUBLIC_BASE_URL = 'http://medivault.example.com'
    expect(() => enforceHttpsConfig()).toThrow(/FATAL/)
  })

  it('throws in production with HTTPS=false', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).HTTPS = 'false'
    expect(() => enforceHttpsConfig()).toThrow(/FATAL/)
  })

  it('does not throw in development mode regardless of config', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    // No HTTPS config at all — should be fine in dev
    expect(() => enforceHttpsConfig()).not.toThrow()

    // Even with explicitly wrong config
    ;(process.env as Record<string, string | undefined>).NEXT_PUBLIC_BASE_URL = 'http://localhost:3000'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('does not throw in test mode regardless of config', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })
})

describe('shouldUseSecureCookies', () => {
  beforeEach(() => {
    resetEnv()
  })

  afterEach(() => {
    resetEnv()
  })

  it('returns true in production', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('returns false in development', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    expect(shouldUseSecureCookies()).toBe(false)
  })

  it('returns false in test mode', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    expect(shouldUseSecureCookies()).toBe(false)
  })

  it('returns true when TRUSTED_LOCAL_TLS_TERMINATION=true even in non-production', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('returns true when TRUSTED_LOCAL_TLS_TERMINATION=true in production', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(shouldUseSecureCookies()).toBe(true)
  })
})
