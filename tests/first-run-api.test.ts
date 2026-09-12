/**
 * FIRST-RUN FIX — targeted API tests
 * (acceptance/FIRST-RUN-ROOT-CAUSE.md — the P1 first-run onboarding fix)
 *
 * Covers the three API-side pieces of the clean-first-run fix:
 *
 *  1. GET /api/auth/csrf — the CSRF double-submit bootstrap issued BEFORE
 *     any session exists (the D3 finding: cookie-less first login could
 *     never pass "CSRF cookie missing").
 *  2. The static-frontend plugin — the API serving the static export at
 *     its own origin so the desktop webview's relative /api calls become
 *     same-origin (the D2 fix), including: SPA fallback, /api JSON 404s,
 *     CSP header, and the fail-closed missing-dir behavior.
 *  3. shouldUseSecureCookies in Model A (localhost-production) — plain
 *     loopback HTTP by design; the Secure flag would make WebKit refuse
 *     to store the cookie at all. General production stays Secure.
 *
 * No database is required (none of these paths touch the DB).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { errorHandlerPlugin } from '../mini-services/api-service/src/plugins/error-handler.js'
import { corsPlugin } from '../mini-services/api-service/src/plugins/cors.js'
import { staticFrontendPlugin } from '../mini-services/api-service/src/plugins/static-frontend.js'
import { registerAuthRoutes } from '../mini-services/api-service/src/routes/auth/index.js'
import { shouldUseSecureCookies } from '../mini-services/api-service/src/lib/https-enforcement.js'

// ─── Environment (set before imports that depend on it) ──────────────
Object.assign(process.env, { NODE_ENV: 'test' })
process.env.AUTH_JWT_SECRET =
  'c282f12b700adbb6745aedb01641cdf35b80b90ad940e74f4781283b064118ac'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

function parseCookies(setCookie: string | string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!setCookie) return result
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  for (const raw of arr) {
    const [pair] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return result
}

function parseSetCookieAttrs(setCookie: string | string[] | undefined): string[] {
  if (!setCookie) return []
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  return arr.flatMap((raw) => raw.split(';').slice(1).map((a) => a.trim()))
}

// ─── Test fixtures ────────────────────────────────────────────────────

let frontendDir: string

async function buildApp(withStatic: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(errorHandlerPlugin)
  await app.register(cookie)
  await app.register(corsPlugin)
  await app.register(registerAuthRoutes as never)
  if (withStatic) {
    await app.register(staticFrontendPlugin)
  } else {
    // Register the plugin with the env unset to prove the no-op path
    // (dev + non-desktop deployments stay byte-identical).
    delete process.env.MEDIVAULT_STATIC_DIR
    await app.register(staticFrontendPlugin)
  }
  return app
}

beforeAll(() => {
  frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-frontend-'))
  fs.writeFileSync(path.join(frontendDir, 'index.html'), '<!doctype html><html><body>MediVault static export</body></html>')
  fs.writeFileSync(path.join(frontendDir, 'app.js'), 'console.log("mv")')
  fs.mkdirSync(path.join(frontendDir, '_next', 'static'), { recursive: true })
  fs.writeFileSync(path.join(frontendDir, '_next', 'static', 'chunk.js'), '/* chunk */')
})

afterAll(() => {
  fs.rmSync(frontendDir, { recursive: true, force: true })
})

// ─── 1. CSRF bootstrap endpoint ───────────────────────────────────────

describe('GET /api/auth/csrf — pre-login double-submit bootstrap (D3 fix)', () => {
  it('issues the mvlt_csrf cookie + matching body token, no auth required', async () => {
    const app = await buildApp(false)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(typeof body.csrfToken).toBe('string')
      expect(body.csrfToken.length).toBeGreaterThan(20)
      const cookies = parseCookies(res.headers['set-cookie'])
      expect(cookies['mvlt_csrf']).toBeTruthy()
      // Double-submit contract: header (from body) must equal the cookie.
      expect(cookies['mvlt_csrf']).toBe(body.csrfToken)
    } finally {
      await app.close()
    }
  })

  it('sets the documented cookie attributes: Path=/, SameSite=Lax, NOT HttpOnly', async () => {
    const app = await buildApp(false)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      const attrs = parseSetCookieAttrs(res.headers['set-cookie'])
      expect(attrs).toContain('Path=/')
      expect(attrs).toContain('SameSite=Lax')
      expect(attrs.join(' ')).not.toContain('HttpOnly')
      // NODE_ENV=test → no Secure (unchanged pre-existing dev behavior).
      expect(attrs.join(' ')).not.toContain('Secure')
    } finally {
      await app.close()
    }
  })

  it('generates a FRESH token per issuance', async () => {
    const app = await buildApp(false)
    try {
      const r1 = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      const r2 = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      expect(r1.json().csrfToken).not.toBe(r2.json().csrfToken)
    } finally {
      await app.close()
    }
  })

  it('the issued pair satisfies validateCsrf on a subsequent login POST (no missing-cookie failure)', async () => {
    const app = await buildApp(false)
    try {
      const boot = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      const token = boot.json().csrfToken as string
      // The login itself will fail AUTH (no such user — no DB in this
      // test), but it must NOT fail CSRF: the pre-fix behavior was a 403
      // "CSRF cookie missing" for every cookie-less first login.
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          Origin: 'http://localhost:3000',
          Cookie: `mvlt_csrf=${token}`,
          'x-csrf-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ email: 'nobody@example.invalid', password: 'WrongPass!9x' }),
      })
      expect(res.statusCode).not.toBe(403)
      expect(res.json().error).not.toMatch(/CSRF/i)
    } finally {
      await app.close()
    }
  })
})

// ─── 2. Static frontend plugin (D2 fix) ──────────────────────────────

describe('static-frontend plugin — the API serves the static export at its own origin', () => {
  it('no-ops when MEDIVAULT_STATIC_DIR is unset (dev/web deployments unchanged)', async () => {
    delete process.env.MEDIVAULT_STATIC_DIR
    const app = await buildApp(false)
    try {
      const res = await app.inject({ method: 'GET', url: '/' })
      // No static serving: the default 404 (JSON) — exactly the
      // pre-fix behavior for a non-desktop deployment.
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toContain('application/json')
    } finally {
      await app.close()
    }
  })

  it('serves index.html at / with the CSP header and no-cache', async () => {
    process.env.MEDIVAULT_STATIC_DIR = frontendDir
    const app = await buildApp(true)
    try {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('MediVault static export')
      expect(res.headers['content-type']).toContain('text/html')
      const csp = String(res.headers['content-security-policy'])
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain('http://127.0.0.1:*')
      expect(String(res.headers['cache-control'])).toContain('no-cache')
    } finally {
      await app.close()
    }
  })

  it('serves real assets and SPA-falls-back for unknown non-/api GETs', async () => {
    process.env.MEDIVAULT_STATIC_DIR = frontendDir
    const app = await buildApp(true)
    try {
      const asset = await app.inject({ method: 'GET', url: '/_next/static/chunk.js' })
      expect(asset.statusCode).toBe(200)
      expect(asset.body).toContain('chunk')

      const spa = await app.inject({ method: 'GET', url: '/some-client-route' })
      expect(spa.statusCode).toBe(200)
      expect(spa.body).toContain('MediVault static export')
    } finally {
      await app.close()
    }
  })

  it('unknown /api/* routes stay JSON 404 — NEVER index.html', async () => {
    process.env.MEDIVAULT_STATIC_DIR = frontendDir
    const app = await buildApp(true)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' })
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toContain('application/json')
      expect(res.json()).toEqual({ error: 'Not found' })
    } finally {
      await app.close()
    }
  })

  it('real /api routes still win over the static handler (route precedence)', async () => {
    process.env.MEDIVAULT_STATIC_DIR = frontendDir
    const app = await buildApp(true)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(typeof body.csrfToken).toBe('string')
    } finally {
      await app.close()
    }
  })

  it('fails closed when the configured directory does not exist', async () => {
    process.env.MEDIVAULT_STATIC_DIR = path.join(os.tmpdir(), 'mv-frontend-missing-xyz')
    const app = Fastify({ logger: false })
    await expect(app.register(staticFrontendPlugin)).rejects.toThrow(/MEDIVAULT_STATIC_DIR/)
    await app.close()
  })
})

// ─── 3. Secure-cookie model — Model A exception ───────────────────────

describe('shouldUseSecureCookies — Model A (localhost-production) exception', () => {
  const snapshot: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const key of ['NODE_ENV', 'MEDIVAULT_LOCALHOST_ONLY', 'TRUSTED_LOCAL_TLS_TERMINATION']) {
      snapshot[key] = process.env[key]
    }
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete (process.env as Record<string, string | undefined>)[key]
      else (process.env as Record<string, string | undefined>)[key] = value
    }
  })

  it('Model A (localhost-production): NO Secure — plain loopback HTTP by design (the fix)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).MEDIVAULT_LOCALHOST_ONLY = 'true'
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = undefined
    expect(shouldUseSecureCookies()).toBe(false)
  })

  it('general production (no localhost mode): Secure REMAINS (unchanged)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).MEDIVAULT_LOCALHOST_ONLY = undefined
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = undefined
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('trusted local TLS termination (Windows shape): Secure REMAINS (unchanged)', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).MEDIVAULT_LOCALHOST_ONLY = undefined
    ;(process.env as Record<string, string | undefined>).TRUSTED_LOCAL_TLS_TERMINATION = 'true'
    expect(shouldUseSecureCookies()).toBe(true)
  })

  it('Model A csrf bootstrap cookie carries no Secure flag', async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).MEDIVAULT_LOCALHOST_ONLY = 'true'
    const app = await buildApp(false)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' })
      const attrs = parseSetCookieAttrs(res.headers['set-cookie']).join(' ')
      expect(attrs).not.toContain('Secure')
      expect(attrs).toContain('SameSite=Lax')
    } finally {
      await app.close()
    }
  })
})

// ─── Dependency drift guard (PFT run 34692245479 first-red) ─────────
// The staged prod tree (npm install --omit=dev from
// mini-services/api-service/package.json) must resolve the SAME MAJOR
// of every fastify-family plugin the dev/test tree (the root
// package.json + bun.lock) exercises. v8→v10 of @fastify/static changed
// the setHeaders callback contract (raw ServerResponse vs FastifyReply):
// the drifted prod tree answered GET / with 500 {"error":"Internal
// server error"} and the hand-off screen showed the raw JSON — while
// every dev/test run was green. Same-major = same semver API contract.
describe('api-service dependency drift guard (staged prod tree == tested tree)', () => {
  const repoRoot = path.resolve(__dirname, '..')
  const rootDeps = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  ).dependencies as Record<string, string>
  const apiDeps = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'mini-services/api-service/package.json'),
      'utf8',
    ),
  ).dependencies as Record<string, string>
  const majorOf = (range: string) => /^[\^~]?(\d+)/.exec(range)?.[1]

  for (const dep of [
    '@fastify/static',
    '@fastify/cookie',
    '@fastify/cors',
    '@fastify/multipart',
    '@fastify/rate-limit',
    'fastify',
  ]) {
    it(`${dep}: the api-service range matches the root (tested) range's major`, () => {
      expect(apiDeps[dep], 'the api-service must declare the dependency').toBeDefined()
      expect(rootDeps[dep], 'the root (tested) tree must declare the dependency').toBeDefined()
      expect(majorOf(apiDeps[dep])).toBe(majorOf(rootDeps[dep]))
    })
  }
})
