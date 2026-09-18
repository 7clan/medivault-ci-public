'use client'

/**
 * FirstRunOnboarding — the PRE-AUTH first-run control.
 *
 * Fixes the P1 fresh-install circular dependency
 * (acceptance/FIRST-RUN-ROOT-CAUSE.md): a brand-new user had no supported
 * visible way to register the background service before authentication
 * required the backend it starts.
 *
 * This screen renders on the embedded Tauri asset origin
 * (`tauri://localhost`) — before any backend exists — and drives the
 * SAME real registration path the Settings → Background panel uses:
 *
 *   getBackgroundServiceStatus / registerBackgroundService /
 *   openLoginItemsSettings  (@/lib/desktop/api → Tauri IPC →
 *   background_service_* commands → the medivault-launchagent
 *   SMAppService helper). No duplicated service logic.
 *
 * Apple's four-state SMAppService model is surfaced EXACTLY:
 *   notRegistered    → "Set up MediVault" (register)
 *   enabled          → bounded wait for backend health, then hand off to
 *                      the API-served app (create account / sign in)
 *   requiresApproval → clear guidance + "Open Login Items"
 *   notFound         → the documented FRESH state for a never-launched
 *                      app (zero-cost-release contract; register() is the
 *                      proven transition from it) — the setup control is
 *                      offered; a genuinely broken install fails at
 *                      register() with the real error
 *
 * When `http://127.0.0.1:3001/health` answers, the webview navigates to
 * the API-served static export (same frontend, now same-origin with the
 * API) and the normal setup/sign-in flow takes over.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Stethoscope,
  Loader2,
  ShieldCheck,
  Settings2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Server,
} from 'lucide-react'
import {
  getBackgroundServiceStatus,
  registerBackgroundService,
  openLoginItemsSettings,
  navigateToLocalBackend,
  friendlyMessage,
} from '@/lib/desktop/api'
import { DESKTOP_API_BASE, backendHealthProbe } from '@/lib/local-backend'
import {
  firstRunReducer,
  FIRST_RUN_INITIAL,
  DEFAULT_HEALTH_WAIT_BUDGET_MS,
} from '@/lib/first-run-machine'
import { useI18n } from '@/i18n'
import { LanguageToggle } from '@/components/language-switcher'

/** Poll interval for the bounded backend health wait. */
const HEALTH_POLL_INTERVAL_MS = 1500
/** Budget for the bounded health wait — see first-run-machine.ts. */
const HEALTH_WAIT_BUDGET_MS = DEFAULT_HEALTH_WAIT_BUDGET_MS

export function FirstRunOnboarding() {
  const { t } = useI18n()
  const [phase, dispatch] = useReducer(firstRunReducer, FIRST_RUN_INITIAL)
  const [elapsed, setElapsed] = useState(0)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    dispatch({ type: 'recheck' })
    try {
      const status = await getBackgroundServiceStatus()
      if (!mounted.current) return
      dispatch({ type: 'status', status, now: Date.now() })
    } catch (err) {
      if (mounted.current) {
        // Tauri command errors reject with STRINGS (Result<_, String>) —
        // surface the real diagnostic instead of a generic fallback.
        const message =
          err instanceof Error ? friendlyMessage(err) : String(err)
        dispatch({ type: 'status-error', message })
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Defer the first status query off the synchronous effect body (the
    // refresh's leading setState must not cascade within the effect).
    const kickoff = setTimeout(() => void refresh(), 0)
    return () => {
      mounted.current = false
      clearTimeout(kickoff)
    }
  }, [refresh])

  // Bounded health wait while the supervisor provisions PostgreSQL + the API.
  useEffect(() => {
    if (phase.kind !== 'waiting') return
    let cancelled = false
    const tick = async () => {
      const now = Date.now()
      const waited = now - phase.startedAt
      if (!mounted.current || cancelled) return
      setElapsed(waited)
      const healthy = await backendHealthProbe()
      if (cancelled || !mounted.current) return
      dispatch({
        type: 'health',
        startedAt: phase.startedAt,
        now: Date.now(),
        healthy,
        budgetMs: HEALTH_WAIT_BUDGET_MS,
      })
    }
    void tick()
    const interval = setInterval(tick, HEALTH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [phase])

  // Hand off: the API now serves the SAME frontend at its own origin —
  // every existing relative /api call becomes same-origin from here on.
  //
  // PFT run 34693988598: the JS-initiated window.location.replace()
  // cross-scheme navigation left the WKWebView BLANK (the webview's own
  // fetch to the same origin worked — that is how this phase was reached
  // — and the page renders correctly in a real browser). The hand-off now
  // navigates from the RUST side (WebviewWindow::navigate → wry
  // load_url): the invoke never resolves on success (the navigation
  // destroys this JS context), so it is fire-and-forget; the location
  // replace is the fallback when the invoke rejects (non-desktop
  // contexts, command errors).
  useEffect(() => {
    if (phase.kind !== 'ready') return
    const target = `${DESKTOP_API_BASE}/`
    void navigateToLocalBackend(target).catch(() => {
      window.location.replace(target)
    })
  }, [phase])

  const runRegister = useCallback(async () => {
    dispatch({ type: 'busy', action: 'register' })
    try {
      await registerBackgroundService()
    } catch (err) {
      if (mounted.current) {
        dispatch({ type: 'action-error', message: friendlyMessage(err) })
      }
      return
    }
    if (mounted.current) dispatch({ type: 'action-done' })
    await refresh()
  }, [refresh])

  const runOpenLoginItems = useCallback(async () => {
    dispatch({ type: 'busy', action: 'open-settings' })
    try {
      await openLoginItemsSettings()
    } catch (err) {
      if (mounted.current) {
        dispatch({ type: 'action-error', message: friendlyMessage(err) })
      }
      return
    }
    if (mounted.current) dispatch({ type: 'action-done' })
    void refresh()
  }, [refresh])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-6 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/40">
            <Stethoscope className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-gradient-emerald">MediVault</h1>
          <p className="text-sm text-muted-foreground">
            {t('desktop.firstRun.tagline')}
          </p>
          <div className="flex justify-center pt-1">
            <LanguageToggle />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" aria-hidden="true" />
              {t('desktop.firstRun.localServices')}
            </CardTitle>
            <CardDescription>
              {t('desktop.firstRun.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase.kind === 'checking' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('desktop.firstRun.checking')}
              </div>
            )}

            {phase.kind === 'status' && phase.status === 'notRegistered' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t('desktop.firstRun.notRegistered')}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('desktop.firstRun.notRegisteredDesc')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('desktop.firstRun.registerDesc')}
                </p>
                <Button size="sm" onClick={() => void runRegister()}>
                  <ShieldCheck className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('desktop.firstRun.setUp')}
                </Button>
              </div>
            )}

            {phase.kind === 'status' && phase.status === 'enabled' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="gap-1 border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('desktop.firstRun.registered')}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('desktop.firstRun.starting')}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('desktop.firstRun.checkAgain')}
                </Button>
              </div>
            )}

            {phase.kind === 'status' && phase.status === 'requiresApproval' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1 border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('desktop.firstRun.approvalRequired')}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('desktop.firstRun.approvalDesc')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('desktop.firstRun.approvalHow')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void runOpenLoginItems()}>
                    <Settings2 className="me-2 h-4 w-4" aria-hidden="true" />
                    {t('desktop.firstRun.openLoginItems')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void refresh()}>
                    <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
                    {t('desktop.firstRun.approvedRecheck')}
                  </Button>
                </div>
              </div>
            )}

            {phase.kind === 'status' && phase.status === 'notFound' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t('desktop.firstRun.notFound')}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('desktop.firstRun.notFoundDesc')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('desktop.firstRun.notFoundDesc2')}
                </p>
                <Button size="sm" onClick={() => void runRegister()}>
                  <ShieldCheck className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('desktop.firstRun.setUp')}
                </Button>
              </div>
            )}

            {phase.kind === 'busy' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {phase.action === 'register'
                  ? t('desktop.firstRun.busy.register')
                  : t('desktop.firstRun.busy.settings')}
              </div>
            )}

            {phase.kind === 'waiting' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>
                    {t('desktop.firstRun.checking')}
                    <span className="ms-1 tabular-nums">
                      ({Math.floor(elapsed / 1000)}s)
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('desktop.firstRun.waitingNote')}
                </p>
              </div>
            )}

            {phase.kind === 'ready' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="gap-1 border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('desktop.firstRun.ready')}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('desktop.firstRun.opening')}
                  </span>
                </div>
                {/* Visible fallback in case the automatic hand-off is blocked. */}
                <a
                  href={`${DESKTOP_API_BASE}/`}
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                >
                  {t('desktop.firstRun.open')}
                  <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                </a>
              </div>
            )}

            {phase.kind === 'timeout' && (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription>
                    <span className="font-medium">
                      {t('desktop.firstRun.timeoutTitle')}
                    </span>{' '}
                    {t('desktop.firstRun.timeoutDesc')}
                  </AlertDescription>
                </Alert>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('desktop.firstRun.tryAgain')}
                </Button>
              </div>
            )}

            {phase.kind === 'error' && (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription>{phase.message}</AlertDescription>
                </Alert>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('desktop.firstRun.tryAgain')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          {t('desktop.firstRun.footer')}
        </p>
      </motion.div>
    </div>
  )
}
