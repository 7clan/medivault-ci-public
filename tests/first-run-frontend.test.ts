/**
 * FIRST-RUN FIX — targeted frontend-logic tests
 * (acceptance/FIRST-RUN-ROOT-CAUSE.md — the P1 first-run onboarding fix)
 *
 * Node-environment tests for the three frontend pieces of the fix (no DOM
 * required — the state machine is a pure reducer, and the predicates and
 * the fetch adapter helpers are exported pure functions):
 *
 *  1. first-run-machine — the pre-auth onboarding state model:
 *     fresh install + notRegistered → setup control visible;
 *     register success → bounded backend wait; requiresApproval → the
 *     approval guidance; notFound → clear failure; backend unavailable →
 *     BOUNDED failure (never an infinite spinner); backend healthy →
 *     ready (account setup / sign-in reachable).
 *  2. local-backend predicates — the first-run gate fires ONLY on the
 *     embedded Tauri asset origin (tauri://localhost + IPC present);
 *     every other context (web, API-served app, plain browser) keeps the
 *     existing authenticated flow unchanged.
 *  3. fetch-csrf helpers — the double-submit header attachment contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  firstRunReducer,
  FIRST_RUN_INITIAL,
  DEFAULT_HEALTH_WAIT_BUDGET_MS,
  showsSetupControl,
  showsApprovalGuidance,
  isBackendReady,
  isBoundedFailure,
} from '@/lib/first-run-machine'
import { isTauriDesktop, isDesktopFirstRun, DESKTOP_API_BASE } from '@/lib/local-backend'
import { readCsrfCookie, isApiRequest, requestMethod } from '@/lib/fetch-csrf'

// ─── 1. First-run state machine ──────────────────────────────────────

describe('first-run-machine — the pre-auth onboarding state model', () => {
  const T0 = 1_000_000

  it('fresh install: initial state is checking, and notRegistered exposes the setup control', () => {
    expect(FIRST_RUN_INITIAL).toEqual({ kind: 'checking' })
    // The real first status query on a fresh install:
    const phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'notRegistered',
      now: T0,
    })
    expect(phase).toEqual({ kind: 'status', status: 'notRegistered' })
    expect(showsSetupControl(phase)).toBe(true)
    expect(showsApprovalGuidance(phase)).toBe(false)
    expect(isBackendReady(phase)).toBe(false)
  })

  it('registration success re-queries status (busy → checking → real state)', () => {
    let phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'notRegistered',
      now: T0,
    })
    phase = firstRunReducer(phase, { type: 'busy', action: 'register' })
    expect(phase).toEqual({ kind: 'busy', action: 'register' })
    phase = firstRunReducer(phase, { type: 'action-done' })
    expect(phase).toEqual({ kind: 'checking' })
    // The runner-observed branch (smappservice-lifecycle run 34271908241):
    // after register the status is enabled → bounded health wait.
    phase = firstRunReducer(phase, { type: 'status', status: 'enabled', now: T0 })
    expect(phase).toEqual({ kind: 'waiting', startedAt: T0 })
    expect(showsSetupControl(phase)).toBe(false)
  })

  it('requiresApproval surfaces the approval guidance (Apple’s state model)', () => {
    const phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'requiresApproval',
      now: T0,
    })
    expect(phase).toEqual({ kind: 'status', status: 'requiresApproval' })
    expect(showsApprovalGuidance(phase)).toBe(true)
    expect(showsSetupControl(phase)).toBe(false)
  })

  it('notFound offers the setup control — the documented fresh state for a never-launched app (PFT run 34689461997 first-red)', () => {
    const phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'notFound',
      now: T0,
    })
    expect(phase).toEqual({ kind: 'status', status: 'notFound' })
    // The frozen smappservice-lifecycle evidence (zero-cost-release
    // contract first-red ledger) documents notFound as the fresh state for
    // a never-launched app, and register() succeeds from it → enabled.
    // Treating it as terminal was the product bug: the fresh machine
    // rendered a fatal "Installation problem" card and the pre-auth setup
    // control (the entire P1 fix) never appeared.
    expect(showsSetupControl(phase)).toBe(true)
    expect(showsApprovalGuidance(phase)).toBe(false)
  })

  it('backend healthy → ready (account setup / sign-in reachable)', () => {
    let phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'enabled',
      now: T0,
    })
    phase = firstRunReducer(phase, {
      type: 'health',
      startedAt: T0,
      now: T0 + 5_000,
      healthy: true,
      budgetMs: DEFAULT_HEALTH_WAIT_BUDGET_MS,
    })
    expect(isBackendReady(phase)).toBe(true)
  })

  it('backend unavailable → BOUNDED failure (never an infinite spinner)', () => {
    let phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status',
      status: 'enabled',
      now: T0,
    })
    // Still inside the budget → keep waiting.
    phase = firstRunReducer(phase, {
      type: 'health',
      startedAt: T0,
      now: T0 + 60_000,
      healthy: false,
      budgetMs: DEFAULT_HEALTH_WAIT_BUDGET_MS,
    })
    expect(phase).toEqual({ kind: 'waiting', startedAt: T0 })
    // At/past the budget → the clear timeout failure.
    phase = firstRunReducer(phase, {
      type: 'health',
      startedAt: T0,
      now: T0 + DEFAULT_HEALTH_WAIT_BUDGET_MS,
      healthy: false,
      budgetMs: DEFAULT_HEALTH_WAIT_BUDGET_MS,
    })
    expect(phase).toEqual({ kind: 'timeout' })
    expect(isBoundedFailure(phase)).toBe(true)
    expect(isBackendReady(phase)).toBe(false)
    // And the timeout is recoverable (recheck → fresh status query).
    phase = firstRunReducer(phase, { type: 'recheck' })
    expect(phase).toEqual({ kind: 'checking' })
  })

  it('action errors surface as clear failures with diagnostics', () => {
    const phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'action-error',
      message: 'SMAppService helper missing from the app bundle',
    })
    expect(phase).toEqual({
      kind: 'error',
      message: 'SMAppService helper missing from the app bundle',
    })
    expect(isBoundedFailure(phase)).toBe(true)
  })

  it('status query errors surface as clear failures (fail closed, never guessed)', () => {
    const phase = firstRunReducer(FIRST_RUN_INITIAL, {
      type: 'status-error',
      message: 'Tauri command "background_service_status" is only available in the desktop app.',
    })
    expect(phase.kind).toBe('error')
    expect(isBoundedFailure(phase)).toBe(true)
  })

  it('the health wait budget is 6 minutes (matches the supervisor provision budget)', () => {
    expect(DEFAULT_HEALTH_WAIT_BUDGET_MS).toBe(360_000)
  })
})

// ─── 2. First-run gate predicates ────────────────────────────────────

describe('local-backend predicates — the gate fires ONLY on the embedded Tauri page', () => {
  type WindowLike = {
    location: { protocol: string; origin: string }
    __TAURI_INTERNALS__?: Record<string, unknown>
  }

  const tests: Array<{
    name: string
    window: WindowLike | undefined
    tauri: boolean
    firstRun: boolean
  }> = [
    {
      name: 'embedded Tauri asset origin with IPC → FIRST-RUN (the onboarding gate)',
      window: { location: { protocol: 'tauri:', origin: 'tauri://localhost' }, __TAURI_INTERNALS__: { invoke: () => {} } },
      tauri: true,
      firstRun: true,
    },
    {
      name: 'API-served app (post-navigation http origin, even with IPC) → NOT first-run',
      window: { location: { protocol: 'http:', origin: DESKTOP_API_BASE }, __TAURI_INTERNALS__: { invoke: () => {} } },
      tauri: true,
      firstRun: false,
    },
    {
      name: 'plain web page (http origin, no IPC) → NOT desktop, NOT first-run',
      window: { location: { protocol: 'http:', origin: 'http://localhost:3000' } },
      tauri: false,
      firstRun: false,
    },
    {
      name: 'tauri origin WITHOUT IPC (remote page in the shell) → NOT first-run',
      window: { location: { protocol: 'tauri:', origin: 'tauri://localhost' } },
      tauri: false,
      firstRun: false,
    },
  ]

  let savedWindow: unknown
  beforeEach(() => {
    savedWindow = (globalThis as Record<string, unknown>).window
  })
  afterEach(() => {
    ;(globalThis as Record<string, unknown>).window = savedWindow
  })

  for (const t of tests) {
    it(t.name, () => {
      ;(globalThis as Record<string, unknown>).window = t.window
      expect(isTauriDesktop()).toBe(t.tauri)
      expect(isDesktopFirstRun()).toBe(t.firstRun)
    })
  }

  it('no window at all (SSR/static prerender) → NOT first-run (existing flow)', () => {
    ;(globalThis as Record<string, unknown>).window = undefined
    expect(isDesktopFirstRun()).toBe(false)
    expect(isTauriDesktop()).toBe(false)
  })
})

// ─── 3. fetch-csrf helpers ───────────────────────────────────────────

describe('fetch-csrf helpers — the double-submit header contract', () => {
  let savedDocument: unknown
  let savedWindow: unknown
  beforeEach(() => {
    savedDocument = (globalThis as Record<string, unknown>).document
    savedWindow = (globalThis as Record<string, unknown>).window
  })
  afterEach(() => {
    ;(globalThis as Record<string, unknown>).document = savedDocument
    ;(globalThis as Record<string, unknown>).window = savedWindow
  })

  it('readCsrfCookie parses the mvlt_csrf pair (and ignores others)', () => {
    ;(globalThis as Record<string, unknown>).document = {
      cookie: 'other=1; mvlt_csrf=abc123; mvlt_session=zzz',
    }
    expect(readCsrfCookie()).toBe('abc123')
  })

  it('readCsrfCookie returns null when absent', () => {
    ;(globalThis as Record<string, unknown>).document = { cookie: 'other=1' }
    expect(readCsrfCookie()).toBe(null)
    ;(globalThis as Record<string, unknown>).document = { cookie: '' }
    expect(readCsrfCookie()).toBe(null)
  })

  it('isApiRequest matches relative /api paths and same-origin absolute URLs only', () => {
    ;(globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', origin: 'http://127.0.0.1:3001' },
    }
    expect(isApiRequest('/api/auth/login')).toBe(true)
    expect(isApiRequest('/api')).toBe(true)
    expect(isApiRequest('http://127.0.0.1:3001/api/patients')).toBe(true)
    expect(isApiRequest('/apii/other')).toBe(false)
    expect(isApiRequest('/assets/index.js')).toBe(false)
    expect(isApiRequest('http://evil.example.com/api/auth/login')).toBe(false)
  })

  it('requestMethod resolves from init first, then the Request input', () => {
    expect(requestMethod('/api/x', { method: 'POST' })).toBe('POST')
    expect(requestMethod('/api/x', undefined)).toBe('GET')
    const req = { url: '/api/x', method: 'PUT' } as unknown as Request
    expect(requestMethod(req, undefined)).toBe('PUT')
    // init wins over the Request's own method (fetch semantics).
    expect(requestMethod(req, { method: 'DELETE' })).toBe('DELETE')
  })
})
