'use client'

/**
 * MediVault — first-run onboarding state machine (pure reducer).
 *
 * The pre-auth onboarding state model, extracted from the component so the
 * Apple SMAppService four-state surface (notRegistered | enabled |
 * requiresApproval | notFound) and the bounded backend wait are unit-testable
 * without a DOM (acceptance/FIRST-RUN-ROOT-CAUSE.md — the P1 first-run fix).
 *
 * Phase → visible affordance (what FirstRunOnboarding renders):
 *   checking            → "MediVault is preparing local services…" (spinner)
 *   status/notRegistered → the "Set up MediVault" setup control
 *   status/enabled      → registered + starting message
 *   status/requiresApproval → approval guidance + "Open Login Items" control
 *   status/notFound     → the documented FRESH state for a never-launched
 *                          app (macos-zero-cost-release-contract.md: "the
 *                          documented fresh state for a never-launched app
 *                          is notFound"; frozen lifecycle runs 34265844092
 *                          prove register() succeeds from it → enabled).
 *                          The setup control is offered; a genuinely broken
 *                          install fails at register() with the real error.
 *   busy                → action in flight (spinner + label)
 *   waiting             → bounded health wait with elapsed display
 *   ready               → "Local service ready" → hand off to the
 *                          API-served app (account setup / sign-in reachable)
 *   timeout             → bounded failure (NEVER an infinite spinner)
 *   error               → clear failure with diagnostics + retry
 */

import type { BackgroundServiceStatus } from '@/lib/desktop/types'

export type FirstRunPhase =
  | { kind: 'checking' }
  | { kind: 'status'; status: BackgroundServiceStatus }
  | { kind: 'busy'; action: string }
  | { kind: 'waiting'; startedAt: number }
  | { kind: 'ready' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }

export type FirstRunEvent =
  | { type: 'status'; status: BackgroundServiceStatus; now: number }
  | { type: 'status-error'; message: string }
  | { type: 'busy'; action: string }
  | { type: 'action-done' }
  | { type: 'action-error'; message: string }
  | { type: 'health'; startedAt: number; now: number; healthy: boolean; budgetMs: number }
  | { type: 'recheck' }

export const FIRST_RUN_INITIAL: FirstRunPhase = { kind: 'checking' }

/** Default bounded health-wait budget (see the component for rationale). */
export const DEFAULT_HEALTH_WAIT_BUDGET_MS = 360_000

export function firstRunReducer(
  phase: FirstRunPhase,
  event: FirstRunEvent,
): FirstRunPhase {
  switch (event.type) {
    case 'status': {
      // `enabled` means launchd may already be starting the backend — go
      // straight to the bounded health wait; every other status surfaces
      // Apple's model exactly.
      if (event.status === 'enabled') {
        return { kind: 'waiting', startedAt: event.now }
      }
      return { kind: 'status', status: event.status }
    }
    case 'status-error':
      return { kind: 'error', message: event.message }
    case 'busy':
      return { kind: 'busy', action: event.action }
    case 'action-done':
      // Re-query the real status (register → enabled | requiresApproval).
      return { kind: 'checking' }
    case 'action-error':
      return { kind: 'error', message: event.message }
    case 'health': {
      if (event.healthy) return { kind: 'ready' }
      // Bounded wait: after the budget, a clear failure — never a hang.
      if (event.now - event.startedAt >= event.budgetMs) {
        return { kind: 'timeout' }
      }
      return phase
    }
    case 'recheck':
      return { kind: 'checking' }
    default:
      return phase
  }
}

/** Does the phase expose the pre-auth setup (register) control?
 *
 * `notFound` is included deliberately: the frozen smappservice-lifecycle
 * evidence (macos-zero-cost-release-contract.md first-red ledger) documents
 * `notFound` as the fresh state for a never-launched app — register() is
 * the proven transition from BOTH fresh states (notRegistered AND
 * notFound → enabled/requiresApproval). Treating notFound as terminal was
 * the PFT run 34689461997 first-red: the fresh machine reported notFound,
 * the onboarding rendered a fatal "Installation problem" card, and the
 * setup control never appeared. A genuinely broken install (plist actually
 * missing) fails at register() and surfaces the real error instead.
 */
export function showsSetupControl(phase: FirstRunPhase): boolean {
  return (
    phase.kind === 'status' &&
    (phase.status === 'notRegistered' || phase.status === 'notFound')
  )
}

/** Does the phase expose the Login Items approval guidance? */
export function showsApprovalGuidance(phase: FirstRunPhase): boolean {
  return phase.kind === 'status' && phase.status === 'requiresApproval'
}

/** Is the phase the terminal "backend healthy" hand-off state? */
export function isBackendReady(phase: FirstRunPhase): boolean {
  return phase.kind === 'ready'
}

/** Is the phase a bounded failure (timeout or error)? */
export function isBoundedFailure(phase: FirstRunPhase): boolean {
  return phase.kind === 'timeout' || phase.kind === 'error'
}
