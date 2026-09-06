/**
 * Phase A — CORS Tests
 *
 * Tests corsHeaders(), getAllowedOrigins() from the shared CSRF module,
 * and the Fastify CORS plugin configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { corsHeaders, getAllowedOrigins } from '@/lib/csrf'

// ─── Lightweight request mock (replaces NextRequest) ──
function mockRequest(url: string, opts: { headers?: Record<string, string>; method?: string } = {}) {
  // Build a case-insensitive header map (mimics Web Headers behavior)
  const headerMap = new Map<string, string>()
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headerMap.set(k.toLowerCase(), v)
    }
  }
  return {
    url,
    method: opts.method ?? 'GET',
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  }
}

// ─── Environment helpers ─────────────────────────────────
const ORIGINAL_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS

function resetAllowedOrigins() {
  if (ORIGINAL_ALLOWED_ORIGINS !== undefined) {
    process.env.ALLOWED_ORIGINS = ORIGINAL_ALLOWED_ORIGINS
  } else {
    delete process.env.ALLOWED_ORIGINS
  }
}

beforeEach(() => {
  resetAllowedOrigins()
  vi.restoreAllMocks()
})

afterEach(() => {
  resetAllowedOrigins()
})

// ────────────────────────────────────────────────────────
// 1. corsHeaders() unit tests (shared module)
// ────────────────────────────────────────────────────────
describe('corsHeaders', () => {
  it('returns proper headers when Origin matches allowed list', () => {
    const req = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000')
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
    expect(headers['Access-Control-Allow-Methods']).toBeDefined()
    expect(headers['Access-Control-Allow-Headers']).toBeDefined()
    expect(headers['Vary']).toBe('Origin')
  })

  it('returns empty object when Origin does not match allowed list', () => {
    const req = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://evil.com' },
    })
    const headers = corsHeaders(req as any)
    expect(headers).toEqual({})
  })

  it('returns empty object when Origin is absent', () => {
    const req = mockRequest('http://localhost:3000/api/test')
    const headers = corsHeaders(req as any)
    expect(headers).toEqual({})
  })

  it('Access-Control-Allow-Credentials is always true when headers are present', () => {
    const req = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)
    if (Object.keys(headers).length > 0) {
      expect(headers['Access-Control-Allow-Credentials']).toBe('true')
    }
  })

  it('never returns a wildcard origin (*)', () => {
    const req1 = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    expect(corsHeaders(req1 as any)['Access-Control-Allow-Origin']).not.toBe('*')

    process.env.ALLOWED_ORIGINS = 'http://app.example.com'
    const req2 = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://app.example.com' },
    })
    expect(corsHeaders(req2 as any)['Access-Control-Allow-Origin']).toBe('http://app.example.com')
  })

  it('Vary: Origin is always set when headers are present', () => {
    const req = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)
    if (Object.keys(headers).length > 0) {
      expect(headers['Vary']).toBe('Origin')
    }
  })

  it('includes expected allowed methods and headers', () => {
    delete process.env.ALLOWED_ORIGINS
    const req = mockRequest('http://localhost:3000/api/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)
    expect(Object.keys(headers).length).toBeGreaterThan(0)
    expect(headers['Access-Control-Allow-Methods']!.includes('GET')).toBe(true)
    expect(headers['Access-Control-Allow-Methods']!.includes('POST')).toBe(true)
    expect(headers['Access-Control-Allow-Methods']!.includes('PUT')).toBe(true)
    expect(headers['Access-Control-Allow-Methods']!.includes('DELETE')).toBe(true)
    expect(headers['Access-Control-Allow-Methods']!.includes('OPTIONS')).toBe(true)
    expect(headers['Access-Control-Allow-Headers']!.includes('Content-Type')).toBe(true)
    expect(headers['Access-Control-Allow-Headers']!.includes('Authorization')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────
// 2. getAllowedOrigins() unit tests (shared module)
// ────────────────────────────────────────────────────────
describe('getAllowedOrigins', () => {
  it('returns [http://localhost:3000] by default', () => {
    delete process.env.ALLOWED_ORIGINS
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000'])
  })

  it('parses ALLOWED_ORIGINS env var correctly (single)', () => {
    process.env.ALLOWED_ORIGINS = 'http://app.example.com'
    expect(getAllowedOrigins()).toEqual(['http://app.example.com'])
  })

  it('parses ALLOWED_ORIGINS env var correctly (multiple)', () => {
    process.env.ALLOWED_ORIGINS = 'http://app.example.com, https://admin.example.com'
    expect(getAllowedOrigins()).toEqual(['http://app.example.com', 'https://admin.example.com'])
  })

  it('trims whitespace from origins', () => {
    process.env.ALLOWED_ORIGINS = '  http://app.example.com  ,  https://admin.example.com  '
    expect(getAllowedOrigins()).toEqual(['http://app.example.com', 'https://admin.example.com'])
  })

  it('returns default when ALLOWED_ORIGINS is empty string (falsy)', () => {
    process.env.ALLOWED_ORIGINS = ''
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000'])
  })
})

// ────────────────────────────────────────────────────────
// 3. Preflight OPTIONS handling
// ────────────────────────────────────────────────────────
describe('Preflight OPTIONS requests', () => {
  it('corsHeaders returns correct preflight headers for login route Origin', () => {
    const req = mockRequest('http://localhost:3000/api/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000')
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
  })

  it('corsHeaders returns correct preflight headers for protected route Origin', () => {
    const req = mockRequest('http://localhost:3000/api/patients', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    })
    const headers = corsHeaders(req as any)

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Methods']).toContain('PUT')
    expect(headers['Access-Control-Allow-Methods']).toContain('DELETE')
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type')
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(headers['Access-Control-Allow-Headers']).toContain('X-CSRF-Token')
  })

  it('preflight for unknown Origin returns empty headers', () => {
    const req = mockRequest('http://localhost:3000/api/patients', {
      method: 'OPTIONS',
      headers: { Origin: 'http://attacker.com' },
    })
    const headers = corsHeaders(req as any)
    expect(headers).toEqual({})
  })

  it('preflight without Origin returns empty headers', () => {
    const req = mockRequest('http://localhost:3000/api/patients', {
      method: 'OPTIONS',
    })
    const headers = corsHeaders(req as any)
    expect(headers).toEqual({})
  })
})
