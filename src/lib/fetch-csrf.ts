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
 * Transparent session refresh (P1, exploratory run 34907338207): the access
 * token cookie lives 15 minutes, the `mvlt_refresh` cookie 48 hours, and
 * `/api/auth/refresh` rotates the pair — but nothing in the web app ever
 * called it, so after 15 minutes of continuous use EVERY authenticated
 * request failed with 401 "Authentication required" (a patient create
 * mid-session was the observed casualty). The adapter now attempts ONE
 * refresh and retries the original request with the rotated CSRF pair;
 * auth endpoints that legitimately 401 (login/setup/csrf/refresh itself)
 * and Bearer-transport requests are exempt, and a failed refresh returns
 * the original 401 untouched.
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

/** Auth endpoints whose 401 is legitimate (never refresh-retried). */
const AUTH_EXEMPT = /^\/api\/auth\/(refresh|login|setup|csrf|mobile)(\/|$)/

function isAuthExempt(url: string): boolean {
  let path = url
  if (typeof window !== 'undefined') {
    const origin = window.location.origin
    if (origin && path.startsWith(origin)) path = path.slice(origin.length)
  }
  return AUTH_EXEMPT.test(path)
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

function withHeader(init: RequestInit | undefined, value: string, override = false): RequestInit {
  const headers = new Headers(init?.headers)
  if (override || !headers.has('x-csrf-token')) headers.set('x-csrf-token', value)
  return { ...(init ?? {}), headers }
}

function install(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return
  }
  // http(s) pages only — the API-served app and the web deployment.
  if (!window.location.protocol.startsWith('http')) return

  const originalFetch = window.fetch.bind(window)

  // Single-flight session refresh (concurrent 401s share one POST).
  let refreshInFlight: Promise<boolean> | null = null
  const trySessionRefresh = (): Promise<boolean> => {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const token = await bootstrapCsrfToken()
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (token) headers['x-csrf-token'] = token
          const res = await originalFetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers,
          })
          return res.ok
        } catch {
          return false
        }
      })().finally(() => {
        refreshInFlight = null
      })
    }
    return refreshInFlight
  }

  const wrapped = async (
    input: FetchInput,
    init?: RequestInit,
  ): Promise<Response> => {
    let url = ''
    let method = 'GET'
    try {
      url = requestUrl(input)
      method = requestMethod(input, init)
    } catch {
      // Adapter must never break the request — fall through untouched.
    }

    const mutatingApi = MUTATING_METHODS.has(method) && isApiRequest(url)

    // Attach the CSRF header when the caller did not set one.
    let sendInit = init
    try {
      if (mutatingApi) {
        const headers = new Headers(init?.headers)
        if (!headers.has('x-csrf-token')) {
          const token = await bootstrapCsrfToken()
          if (token) sendInit = withHeader(init, token)
        }
      }
    } catch {
      // Adapter must never break the request — fall through untouched.
    }

    let res: Response
    try {
      res = await originalFetch(input, sendInit)
    } catch (err) {
      // Network-level failure — rethrow untouched (no refresh guessing).
      throw err
    }

    // Transparent session refresh: a 401 from a cookie-mode /api request
    // means the 15-minute access token expired. Attempt ONE refresh and
    // retry the original request with the ROTATED CSRF pair (override —
    // the refresh set a new cookie). Bearer-transport requests and the
    // auth endpoints are exempt; a failed refresh returns the original 401.
    if (res.status === 401 && isApiRequest(url) && !isAuthExempt(url)) {
      let hasBearer = false
      try {
        hasBearer = !!(init?.headers && new Headers(init.headers).has('authorization'))
      } catch {
        hasBearer = false
      }
      if (!hasBearer) {
        const refreshed = await trySessionRefresh()
        if (refreshed) {
          try {
            let retryInit = init
            if (mutatingApi) {
              const token = await bootstrapCsrfToken()
              if (token) retryInit = withHeader(init, token, true)
            }
            return await originalFetch(input, retryInit)
          } catch {
            // Retry failed at the network level — surface the original 401.
          }
        }
      }
    }

    return res
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
