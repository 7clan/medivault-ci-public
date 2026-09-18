/**
 * Guided tour — persistence + activation bus (DIRECTIVE FEATURE C).
 *
 * Completion (and dismissal) persist in localStorage following the app's
 * existing pattern (see `medivault-recently-viewed` in the zustand store):
 * after the doctor finishes OR skips the tour it is never offered again
 * automatically — the permanent replay entry lives in the header Help &
 * Guide menu instead.
 *
 * The component-level activation bus uses the app's established window
 * CustomEvent pattern (`medivault:show-shortcuts`,
 * `medivault:open-patient-switcher`).
 */
import type { TourSectionId } from './tour-content'

/** Versioned so a future catalog rewrite can re-offer the tour once. */
export const TOUR_STORAGE_KEY = 'medivault-tour-completed-v1'

/** Window event that asks the (mounted) tour component to start. */
export const TOUR_START_EVENT = 'medivault:start-tour'

export type TourStatus = 'unseen' | 'completed' | 'dismissed'

function readStoredStatus(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY)
  } catch {
    // localStorage may be full or unavailable
    return null
  }
}

function writeStoredStatus(status: Exclude<TourStatus, 'unseen'>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, status)
  } catch {
    // localStorage may be full or unavailable — the tour simply re-offers
  }
}

export function getTourStatus(): TourStatus {
  const stored = readStoredStatus()
  if (stored === 'completed' || stored === 'dismissed') return stored
  return 'unseen'
}

/**
 * The auto-offer gate: the tour starts by itself only while it has never
 * been completed or skipped. The GuidedTour component is mounted inside
 * the authenticated app shell, so this resolves to true exactly on the
 * first session that reaches the dashboard (first successful login /
 * restored session) and never again afterwards.
 */
export function shouldAutoStartTour(): boolean {
  return getTourStatus() === 'unseen'
}

export function markTourCompleted(): void {
  writeStoredStatus('completed')
}

export function markTourDismissed(): void {
  writeStoredStatus('dismissed')
}

/** Ask the mounted tour component to start (optionally at a section). */
export function requestTourStart(section?: TourSectionId): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<{ section?: TourSectionId }>(TOUR_START_EVENT, {
      detail: { section },
    }),
  )
}
