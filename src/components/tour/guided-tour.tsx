'use client'

/**
 * GuidedTour — the spotlight tour engine (DIRECTIVE FEATURE C).
 *
 * Renders inside the authenticated app shell (src/app/page.tsx), so it
 * mounts exactly when the doctor reaches the app for the first time
 * (first successful login / first restored session). While it has never
 * been completed or skipped (tour-state.ts), it offers the tour once;
 * afterwards it stays silent and is only reachable through the header
 * Help & Guide menu.
 *
 * Each step spotlights a REAL application element resolved through a
 * `data-qa` anchor: the engine navigates to the step's view (read-only UI
 * navigation — it never creates or mutates clinical data), scrolls the
 * target into view, and dims the rest of the screen with a cutout around
 * it. Data-dependent steps (patient profile / document viewer) fall back
 * to the declared anchor when no patient/document exists yet, so a fresh
 * install never dead-ends.
 *
 * Safety properties (merge-gate):
 * - Controls are Back / Next / Skip / Finish + a progress indicator —
 *   no interactive actions that could alter patient data.
 * - The overlay is modal while active and unmounts completely on
 *   finish/skip, so nothing stays blocked afterwards.
 * - The keydown handlers stay armed (Escape/arrows — a plain-browser
 *   affordance), but the card never ADVERTISES Escape: on the macOS
 *   WKWebView shell the key never reaches the DOM (TOUR_ESC_HINT_INOPERATIVE),
 *   so the visible Skip control is the supported exit everywhere.
 * - Window resize/scroll re-measure the spotlight; a missing target
 *   degrades to a centered card.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAppStore, type DocumentInfo, type PatientInfo } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { Mascot } from './mascot'
import {
  TOUR_STEPS,
  UNIVERSAL_FALLBACK_TARGET,
  firstStepIndexForSection,
  useTourSections,
  useTourSteps,
  useTourStrings,
  type TourStep,
} from './tour-content'
import {
  TOUR_START_EVENT,
  markTourCompleted,
  markTourDismissed,
  requestTourStart,
  shouldAutoStartTour,
} from './tour-state'

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

const POLL_INTERVAL_MS = 50
/** Covers the AnimatePresence view transition (~350ms) + async section mounts. */
const PRIMARY_TARGET_BUDGET_MS = 2200
/** Fallback anchors are evaluated after the primary budget — quick check. */
const FALLBACK_TARGET_BUDGET_MS = 400
/** Light re-measure loop so async layout shifts keep the cutout honest. */
const RECT_REFRESH_MS = 400
const SPOTLIGHT_PADDING = 8
const VIEWPORT_MARGIN = 12
const TOOLTIP_GAP = 14
const TOOLTIP_MAX_WIDTH = 400
/** Generous height estimate — the card additionally clamps with max-height. */
const TOOLTIP_EST_HEIGHT = 300

function findByDataQa(anchor: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(`[data-qa="${anchor}"]`)
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count
    const step = () => {
      if (remaining <= 0) resolve()
      else {
        remaining -= 1
        requestAnimationFrame(step)
      }
    }
    requestAnimationFrame(step)
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function GuidedTour() {
  const { toast } = useToast()
  const reduceMotion = useReducedMotion()
  // Localized tour content — resolved through the locale catalog by the
  // single strings module (tour-content.ts). The static TOUR_STEPS below
  // stays structural (views + data-qa anchors) for the resolution engine.
  const tourStrings = useTourStrings()
  const tourSections = useTourSections()
  const tourSteps = useTourSteps()
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [usedFallback, setUsedFallback] = useState(false)

  /** Guards async step resolution against fast Back/Next clicking. */
  const tokenRef = useRef(0)
  const targetRef = useRef<HTMLElement | null>(null)
  const patientRef = useRef<PatientInfo | null>(null)
  const refreshTimerRef = useRef<number | null>(null)

  // ── Activation ─────────────────────────────────────────────────────

  const beginTour = useCallback((startIndex: number) => {
    setIndex(startIndex)
    setActive(true)
  }, [])

  useEffect(() => {
    // Permanent replay path: the header Help & Guide menu dispatches this
    // event (full replay or jump to a section).
    const handleStart = (event: Event) => {
      const section = (event as CustomEvent<{ section?: TourStep['section'] }>).detail?.section
      beginTour(section ? firstStepIndexForSection(section) : 0)
    }
    window.addEventListener(TOUR_START_EVENT, handleStart)

    // First-time offer: this component mounts with the authenticated app
    // shell, i.e. on the first session that reaches the app after login.
    // shouldAutoStartTour() is gated by persisted completion/dismissal, so
    // this fires at most once per install (until a catalog version bump).
    // The offer rides the same activation bus as the Help-menu replays —
    // the listener above is already armed, so the activation state changes
    // in the event callback, not the effect body.
    if (shouldAutoStartTour()) requestTourStart()

    return () => window.removeEventListener(TOUR_START_EVENT, handleStart)
  }, [beginTour])

  // ── Read-only data access for data-dependent steps ─────────────────

  const ensureTourPatient = useCallback(async (): Promise<PatientInfo | null> => {
    const selected = useAppStore.getState().selectedPatient
    if (selected) {
      patientRef.current = selected
      return selected
    }
    if (patientRef.current) return patientRef.current
    try {
      const res = await fetch('/api/patients?limit=1', { credentials: 'include' })
      if (!res.ok) return null
      const data = await res.json()
      const patient = data?.patients?.[0] ?? null
      if (patient) patientRef.current = patient
      return patient
    } catch {
      return null
    }
  }, [])

  const ensureTourDocument = useCallback(async (patient: PatientInfo): Promise<DocumentInfo | null> => {
    const selected = useAppStore.getState().selectedDocument
    if (selected && selected.patientId === patient.id) return selected
    try {
      const res = await fetch(`/api/patients/${patient.id}/documents`, { credentials: 'include' })
      if (!res.ok) return null
      const docs = await res.json()
      return Array.isArray(docs) ? docs[0] ?? null : null
    } catch {
      return null
    }
  }, [])

  // ── Step resolution ────────────────────────────────────────────────

  const waitForAnchor = useCallback(
    (anchor: string, token: number, budgetMs: number): Promise<HTMLElement | null> =>
      new Promise((resolve) => {
        const startedAt = Date.now()
        const tick = () => {
          if (token !== tokenRef.current) {
            resolve(null)
            return
          }
          const el = findByDataQa(anchor)
          if (el) {
            resolve(el)
            return
          }
          if (Date.now() - startedAt >= budgetMs) {
            resolve(null)
            return
          }
          window.setTimeout(tick, POLL_INTERVAL_MS)
        }
        tick()
      }),
    [],
  )

  const resolveStep = useCallback(
    async (stepIndex: number) => {
      const token = ++tokenRef.current
      const step = TOUR_STEPS[stepIndex]
      if (!step) return

      // 1) Navigate to the step's view — pure UI navigation via the store.
      //    (selectPatient/selectDocument also switch the view; the extra
      //    setCurrentView guards cover the "already selected, but the
      //    doctor navigated elsewhere mid-tour" case.)
      const store = useAppStore.getState()
      if (step.view === 'patient-detail' || step.view === 'document-viewer') {
        const patient = await ensureTourPatient()
        if (token !== tokenRef.current) return
        if (patient) {
          if (step.view === 'document-viewer') {
            const doc = await ensureTourDocument(patient)
            if (token !== tokenRef.current) return
            const s = useAppStore.getState()
            if (doc) {
              if (s.selectedDocument?.id !== doc.id) s.selectDocument(doc)
              else if (s.currentView !== 'document-viewer') s.setCurrentView('document-viewer')
            } else {
              // No document for this patient — the documents area of the
              // profile is the declared fallback context.
              if (s.selectedPatient?.id !== patient.id) s.selectPatient(patient)
              else if (s.currentView !== 'patient-detail') s.setCurrentView('patient-detail')
            }
          } else {
            const s = useAppStore.getState()
            if (s.selectedPatient?.id !== patient.id) s.selectPatient(patient)
            else if (s.currentView !== 'patient-detail') s.setCurrentView('patient-detail')
          }
        } else {
          // Fresh install with no patients: fall back to the dashboard.
          const s = useAppStore.getState()
          if (s.currentView !== 'dashboard') s.setCurrentView('dashboard')
        }
      } else if (store.currentView !== step.view) {
        store.setCurrentView(step.view)
      }

      // 2) Resolve the spotlight anchor: primary → declared fallback →
      //    the universal dashboard anchor. Never dead-ends.
      let el = await waitForAnchor(step.target, token, PRIMARY_TARGET_BUDGET_MS)
      if (!el && step.fallbackTarget) {
        el = await waitForAnchor(step.fallbackTarget, token, FALLBACK_TARGET_BUDGET_MS)
      }
      if (!el) {
        el = await waitForAnchor(UNIVERSAL_FALLBACK_TARGET, token, FALLBACK_TARGET_BUDGET_MS)
      }
      if (token !== tokenRef.current) return

      targetRef.current = el
      setUsedFallback(Boolean(el) && el?.getAttribute('data-qa') !== step.target)
      if (el) {
        // Off-screen targets are scrolled into view first (instant — the
        // same no-smooth rule as the BUG-PD23 view-transition reset).
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        await nextFrames(2)
        if (token !== tokenRef.current) return
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      } else {
        setRect(null)
      }
    },
    [ensureTourDocument, ensureTourPatient, waitForAnchor],
  )

  useEffect(() => {
    if (!active) return
    // Step resolution is asynchronous (view transitions + read-only fetches)
    // and token-guarded: it launches from a timer callback so the effect
    // body stays free of state updates, and a fast Back/Next cancels the
    // not-yet-started resolution of the stale step.
    const timer = window.setTimeout(() => void resolveStep(index), 0)
    return () => window.clearTimeout(timer)
  }, [active, index, resolveStep])

  // ── Resize / scroll robustness ────────────────────────────────────

  const recomputeRect = useCallback(() => {
    const el = targetRef.current
    if (!el || !el.isConnected) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    if (!active) return
    const onViewportChange = () => recomputeRect()
    window.addEventListener('resize', onViewportChange)
    // Capture: also catches scrolls of nested containers (documents grid).
    window.addEventListener('scroll', onViewportChange, true)
    refreshTimerRef.current = window.setInterval(recomputeRect, RECT_REFRESH_MS)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [active, recomputeRect])

  // ── Controls ───────────────────────────────────────────────────────

  const closeTour = useCallback(() => {
    tokenRef.current++
    setActive(false)
    setRect(null)
    targetRef.current = null
    const s = useAppStore.getState()
    if (s.currentView !== 'dashboard') s.setCurrentView('dashboard')
  }, [])

  const finish = useCallback(() => {
    markTourCompleted()
    closeTour()
    toast({
      title: tourStrings.completeTitle,
      description: tourStrings.completeDescription,
    })
  }, [closeTour, toast, tourStrings])

  const skip = useCallback(() => {
    markTourDismissed()
    closeTour()
  }, [closeTour])

  const next = useCallback(() => {
    if (index === TOUR_STEPS.length - 1) finish()
    else setIndex(index + 1)
  }, [finish, index])

  const back = useCallback(() => {
    if (index > 0) setIndex(index - 1)
  }, [index])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        skip()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, back, next, skip])

  // ── Render ────────────────────────────────────────────────────────

  if (!active) return null

  const step = tourSteps[index]
  if (!step) return null

  const total = tourSteps.length
  const isLast = index === total - 1
  const body = usedFallback && step.bodyFallback ? step.bodyFallback : step.body
  const section = tourSections.find((s) => s.id === step.section)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const cardWidth = Math.min(TOOLTIP_MAX_WIDTH, vw - 2 * VIEWPORT_MARGIN)
  const progress = Math.round(((index + 1) / total) * 100)

  const padded: SpotlightRect | null = rect
    ? {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + 2 * SPOTLIGHT_PADDING,
        height: rect.height + 2 * SPOTLIGHT_PADDING,
      }
    : null

  // Tooltip placement: prefer below the spotlight, then above, then a
  // viewport-centered fallback — always clamped into the viewport. The
  // single fixed card covers both modes (spotlight + targetless).
  let cardTop: number
  let cardLeft: number
  let cardMaxHeight: number
  if (padded) {
    const fitsBelow = padded.top + padded.height + TOOLTIP_GAP + TOOLTIP_EST_HEIGHT <= vh - VIEWPORT_MARGIN
    const fitsAbove = padded.top - TOOLTIP_GAP - TOOLTIP_EST_HEIGHT >= VIEWPORT_MARGIN
    if (fitsBelow) cardTop = padded.top + padded.height + TOOLTIP_GAP
    else if (fitsAbove) cardTop = clamp(padded.top - TOOLTIP_GAP - TOOLTIP_EST_HEIGHT, VIEWPORT_MARGIN, vh)
    else cardTop = VIEWPORT_MARGIN
    cardLeft = clamp(padded.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, vw - cardWidth - VIEWPORT_MARGIN))
    cardMaxHeight = Math.max(160, vh - cardTop - VIEWPORT_MARGIN)
  } else {
    // No spotlight (target not resolvable): center the card instead.
    cardMaxHeight = Math.min(TOOLTIP_EST_HEIGHT, vh - 2 * VIEWPORT_MARGIN)
    cardTop = Math.max(VIEWPORT_MARGIN, (vh - cardMaxHeight) / 2)
    cardLeft = Math.max(VIEWPORT_MARGIN, (vw - cardWidth) / 2)
  }
  const spring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 34 }

  const card = (
    <motion.div
      data-qa="guided-tour-tooltip"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      className="fixed z-[102] flex flex-col rounded-2xl border border-emerald-200/70 bg-white/95 p-4 shadow-2xl shadow-emerald-900/20 backdrop-blur-md dark:border-emerald-900/60 dark:bg-gray-900/95"
      style={{
        top: cardTop,
        left: cardLeft,
        width: cardWidth,
        maxHeight: cardMaxHeight,
      }}
      initial={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="flex items-start gap-3">
        <Mascot size={44} className="mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {section && (
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              {section.label}
            </p>
          )}
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{step.title}</h3>
        </div>
      </div>

      <p className="mt-2 min-h-0 overflow-y-auto text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>

      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums font-medium">{tourStrings.stepOf(index + 1, total)}</span>
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          data-qa="tour-back"
          variant="outline"
          size="sm"
          onClick={back}
          disabled={index === 0}
          className="border-gray-200 dark:border-gray-700"
        >
          {tourStrings.back}
        </Button>
        <Button
          data-qa="tour-skip"
          variant="ghost"
          size="sm"
          onClick={skip}
          className="text-muted-foreground hover:text-foreground"
        >
          {tourStrings.skip}
        </Button>
        <div className="flex-1" />
        <Button
          data-qa={isLast ? 'tour-finish' : 'tour-next'}
          size="sm"
          onClick={next}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-200/50 transition-all duration-300 hover:from-emerald-600 hover:to-teal-600 dark:shadow-emerald-900/30"
        >
          {isLast ? tourStrings.finish : tourStrings.next}
        </Button>
      </div>
    </motion.div>
  )

  return (
    <>
      {/* Modal input blocker — unmounts completely on finish/skip so
          nothing stays blocked after the tour. */}
      <div data-qa="guided-tour-overlay" className="fixed inset-0 z-[100]" />

      {padded ? (
        <motion.div
          data-qa="guided-tour-spotlight"
          className="pointer-events-none fixed left-0 top-0 z-[100] rounded-xl border-2 border-emerald-400/90"
          style={{ boxShadow: '0 0 0 9999px rgba(3, 22, 16, 0.62), 0 0 24px rgba(16, 185, 129, 0.35)' }}
          initial={false}
          animate={{ x: padded.left, y: padded.top, width: padded.width, height: padded.height }}
          transition={spring}
        >
          <motion.div
            className="absolute inset-0 rounded-[10px] border-2 border-emerald-300"
            animate={reduceMotion ? undefined : { opacity: [0, 0.55, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      ) : (
        <div data-qa="guided-tour-dim" className="fixed inset-0 z-[100] bg-gray-950/60" />
      )}

      {card}
    </>
  )
}
