'use client'

/**
 * MediVault — browser CSRF double-submit bootstrap (fetch adapter).
 *
 * The API's cookie model (mini-services/api-service/src/plugins/csrf.ts)
 * requires EVERY mutating request to carry the `x-csrf-token` header
 * matching the non-HttpOnly `mvlt_csrf` cookie, and requires a valid
 * Origin. The web frontend never implemented the header side — and no
 * endpoint issued the pair before the first login, so a cookie-less
 * first login could never pass ("CSRF cookie missing" — the D3 finding
 * of acceptance/FIRST-RUN-ROOT-CAUSE.md).
 *
 * This adapter completes the API's own documented model (it does NOT
 * weaken it):
 *   * `GET /api/auth/csrf` (new) issues the pair before login.
 *   * For mutating `/api/*` requests the adapter attaches the token from
 *     the `mvlt_csrf` cookie (bootstrapping it first when absent).
 *   * Requests that already set the header are passed through untouched.
 *
 * It activates only on http(s) pages (the API-served app and the web
 * deployment). The embedded Tauri first-run page (`tauri://localhost`)
 * has no reachable `/api` and is skipped.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === 'mvlt_csrf') return part.slice(eq + 1).trim() || null
  }
  return null
}

let bootstrapInFlight: Promise<string | null> | null = null

async function bootstrapCsrfToken(): Promise<string | null> {
  const existing = readCsrfCookie()
  if (existing) return existing
  if (!bootstrapInFlight) {
    bootstrapInFlight = (async () => {
      try {
        const res = await fetch('/api/auth/csrf', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { csrfToken?: string }
            | null
          if (body && typeof body.csrfToken === 'string' && body.csrfToken) {
            return body.csrfToken
          }
        }
      } catch {
        // Backend unreachable — fall back to whatever cookie state exists.
      }
      return readCsrfCookie()
    })().finally(() => {
      bootstrapInFlight = null
    })
  }
  return bootstrapInFlight
}

function isApiRequest(url: string): boolean {
  if (url.startsWith('/api/') || url === '/api') return true
  if (typeof window !== 'undefined') {
    const origin = window.location.origin
    if (origin && url.startsWith(`${origin}/api/`)) return true
  }
  return false
}

type FetchInput = RequestInfo | URL

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function requestMethod(input: FetchInput, init?: RequestInit): string {
  const fromInit = init && typeof init.method === 'string' ? init.method : ''
  if (fromInit) return fromInit.toUpperCase()
  if (typeof input !== 'string' && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase()
  }
  return 'GET'
}

function withHeader(init: RequestInit | undefined, value: string): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', value)
  return { ...(init ?? {}), headers }
}

function install(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return
  }
  // http(s) pages only — the API-served app and the web deployment.
  if (!window.location.protocol.startsWith('http')) return

  const originalFetch = window.fetch.bind(window)
  const wrapped = async (
    input: FetchInput,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const url = requestUrl(input)
      const method = requestMethod(input, init)
      if (MUTATING_METHODS.has(method) && isApiRequest(url)) {
        const headers = new Headers(init?.headers)
        if (!headers.has('x-csrf-token')) {
          const token = await bootstrapCsrfToken()
          if (token) return originalFetch(input, withHeader(init, token))
        }
      }
    } catch {
      // Adapter must never break the request — fall through untouched.
    }
    return originalFetch(input, init)
  }
  Object.defineProperty(wrapped, '__medivaultCsrf', { value: true })
  if (!(window.fetch as { __medivaultCsrf?: boolean }).__medivaultCsrf) {
    window.fetch = wrapped as typeof window.fetch
  }
}

if (typeof window !== 'undefined') {
  install()
}

// ─── Testable internals (pure helpers; the adapter itself is installed
// once at import time in the browser) ────────────────────────────────────
export { readCsrfCookie, isApiRequest, requestMethod, requestUrl }
