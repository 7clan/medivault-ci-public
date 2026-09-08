/**
 * Model A — localhost-security contract (approved 2026-09-08).
 *
 * Unit tests for the desktop-local production mode in the Fastify API's
 * HTTPS enforcement: the narrowly scoped `MEDIVAULT_LOCALHOST_ONLY`
 * mode (injected only by the macOS supervisor), its fail-closed unsafe
 * combination matrix, the trustProxy decision, and the PRESERVATION of
 * the general production HTTPS enforcement for every deployment that
 * does not opt into the desktop-local mode (Windows unchanged).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  enforceHttpsConfig,
  isLocalhostProductionMode,
  shouldTrustProxy,
} from '../mini-services/api-service/src/lib/https-enforcement'

const ORIGINAL_ENV = { ...process.env }

const MODEL_A_KEYS = [
  'NODE_ENV',
  'HTTPS',
  'NEXT_PUBLIC_BASE_URL',
  'TRUSTED_LOCAL_TLS_TERMINATION',
  'MEDIVAULT_LOCALHOST_ONLY',
  'HOST',
  'ALLOWED_ORIGINS',
] as const

function resetEnv() {
  for (const key of MODEL_A_KEYS) {
    delete (process.env as Record<string, string | undefined>)[key]
  }
  for (const key of MODEL_A_KEYS) {
    if (ORIGINAL_ENV[key] !== undefined) {
      ;(process.env as Record<string, string | undefined>)[key] = ORIGINAL_ENV[key]
    }
  }
}

/** The APPROVED Model A desktop-local production configuration. */
function approvedLocalhostProduction(): void {
  const env = process.env as Record<string, string | undefined>
  env.NODE_ENV = 'production'
  env.MEDIVAULT_LOCALHOST_ONLY = 'true'
  env.HOST = '127.0.0.1'
  env.ALLOWED_ORIGINS = 'tauri://localhost,http://localhost:3000'
}

describe('Model A: enforceHttpsConfig — the approved localhost-production mode', () => {
  beforeEach(() => resetEnv())
  afterEach(() => resetEnv())

  it('test 1 (unit level): the approved localhost production configuration starts (does not throw)', () => {
    approvedLocalhostProduction()
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('accepts the IPv6 loopback and the localhost name as bind hosts', () => {
    for (const host of ['::1', 'localhost', ' 127.0.0.1 ']) {
      resetEnv()
      approvedLocalhostProduction()
      ;(process.env as Record<string, string | undefined>).HOST = host
      expect(() => enforceHttpsConfig()).not.toThrow()
    }
  })

  it('test 11 (unit level): non-loopback 0.0.0.0 production bind fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).HOST = '0.0.0.0'
    expect(() => enforceHttpsConfig()).toThrow(/loopback.*0\.0\.0\.0/s)
  })

  it('test 11 (unit level): a LAN interface address production bind fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).HOST = '192.168.1.20'
    expect(() => enforceHttpsConfig()).toThrow(/loopback.*192\.168\.1\.20/s)
  })

  it('test 11 (unit level): the IPv6 wildcard :: production bind fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).HOST = '::'
    expect(() => enforceHttpsConfig()).toThrow(/loopback.*'::'/s)
  })

  it('test 11 (unit level): an unset bind host fails closed', () => {
    approvedLocalhostProduction()
    delete (process.env as Record<string, string | undefined>).HOST
    expect(() => enforceHttpsConfig()).toThrow(/loopback.*\(unset\)/s)
  })

  it('test 11 (unit level): combining local desktop mode with trusted TLS termination fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(() => enforceHttpsConfig()).toThrow(/TRUSTED_LOCAL_TLS_TERMINATION=true is forbidden/)
  })

  it('test 11 (unit level): combining local desktop mode with direct HTTPS fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).HTTPS = 'true'
    expect(() => enforceHttpsConfig()).toThrow(/HTTPS=true contradicts/)
  })

  it('test 11 (unit level): a missing Origin allowlist fails closed (unexpected Origin policy)', () => {
    approvedLocalhostProduction()
    delete (process.env as Record<string, string | undefined>).ALLOWED_ORIGINS
    expect(() => enforceHttpsConfig()).toThrow(/ALLOWED_ORIGINS must be an explicit/)
  })

  it('test 11 (unit level): a wildcard Origin allowlist fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).ALLOWED_ORIGINS = '*'
    expect(() => enforceHttpsConfig()).toThrow(/wildcard/)
  })

  it('test 11 (unit level): a non-local (remote) Origin allowlist entry fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).ALLOWED_ORIGINS =
      'http://localhost:3000,https://remote.example.com'
    expect(() => enforceHttpsConfig()).toThrow(/'https:\/\/remote\.example\.com' is not a local origin/)
  })

  it('test 11 (unit level): a remote-only Origin allowlist fails closed', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).ALLOWED_ORIGINS = 'https://evil.invalid'
    expect(() => enforceHttpsConfig()).toThrow(/is not a local origin/)
  })

  it('accepts an allowlist of local origins only (webview + loopback web origins)', () => {
    approvedLocalhostProduction()
    ;(process.env as Record<string, string | undefined>).ALLOWED_ORIGINS =
      'tauri://localhost,http://localhost:3000,http://127.0.0.1:3000,https://localhost'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })
})

describe('Model A: general production HTTPS enforcement is PRESERVED (Windows unchanged)', () => {
  beforeEach(() => resetEnv())
  afterEach(() => resetEnv())

  it('still throws in production without HTTPS and without trusted termination (no local mode)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    expect(() => enforceHttpsConfig()).toThrow(/FATAL/)
  })

  it('still allows production behind a trusted local TLS terminator (no local mode)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('still allows production with direct HTTPS (no local mode)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).HTTPS = 'true'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })

  it('still does not throw in development', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    expect(() => enforceHttpsConfig()).not.toThrow()
  })
})

describe('Model A: isLocalhostProductionMode', () => {
  beforeEach(() => resetEnv())
  afterEach(() => resetEnv())

  it('is active only in production with the supervisor assertion', () => {
    approvedLocalhostProduction()
    expect(isLocalhostProductionMode()).toBe(true)
  })

  it('is inactive outside production even with the assertion', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    ;(process.env as Record<string, string | undefined>).MEDIVAULT_LOCALHOST_ONLY = 'true'
    expect(isLocalhostProductionMode()).toBe(false)
  })

  it('is inactive in production without the assertion', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    expect(isLocalhostProductionMode()).toBe(false)
  })
})

describe('Model A: shouldTrustProxy', () => {
  beforeEach(() => resetEnv())
  afterEach(() => resetEnv())

  it('test 6 (unit level): trustProxy is FALSE in the localhost-production mode (no proxy exists)', () => {
    approvedLocalhostProduction()
    expect(shouldTrustProxy()).toBe(false)
  })

  it('still trusts the loopback proxy in production behind a real TLS terminator (no local mode)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(shouldTrustProxy()).toBe('127.0.0.1')
  })

  it('still returns false in plain production (no local mode, no terminator)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    expect(shouldTrustProxy()).toBe(false)
  })

  it('still trusts the loopback proxy in development', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    expect(shouldTrustProxy()).toBe('127.0.0.1')
  })
})
