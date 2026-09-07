'use client'

/**
 * BackgroundServicePanel — the SMAppService control panel.
 *
 * Implements Apple's real SMAppService status model EXACTLY (no invented
 * states) with the required per-state behavior:
 *
 *   notRegistered    → offer "Register background service"
 *                      (SMAppService.register via the desktop command)
 *   enabled          → show the background service as active
 *   requiresApproval → clear actionable message +
 *                      "Open Login Items Settings" button invoking
 *                      SMAppService.openSystemSettingsLoginItems()
 *   notFound         → installation/configuration error message
 *
 * The status is polled on mount and after every action (register leaves
 * macOS in requiresApproval until the user approves in System Settings —
 * this is Apple's contract, not an error).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Server,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import {
  getBackgroundServiceStatus,
  registerBackgroundService,
  unregisterBackgroundService,
  openLoginItemsSettings,
  friendlyMessage,
} from '@/lib/desktop/api'
import type { BackgroundServiceStatus } from '@/lib/desktop/types'

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: BackgroundServiceStatus }
  | { kind: 'busy'; status: BackgroundServiceStatus; action: string }
  | { kind: 'error'; message: string }

const BUSY_TIMEOUT_MS = 15_000

export function BackgroundServicePanel() {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const status = await getBackgroundServiceStatus()
      if (mounted.current) setState({ kind: 'ready', status })
    } catch (err) {
      if (mounted.current) {
        setState({ kind: 'error', message: friendlyMessage(err) })
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [refresh])

  const runAction = useCallback(
    async (
      action: string,
      fn: () => Promise<void>,
      current: BackgroundServiceStatus
    ) => {
      setState({ kind: 'busy', status: current, action })
      // Bound the UI busy state — the action itself is bounded in Rust.
      timer.current = setTimeout(() => {
        if (mounted.current) void refresh()
      }, BUSY_TIMEOUT_MS)
      try {
        await fn()
      } catch (err) {
        if (mounted.current) {
          setState({ kind: 'error', message: friendlyMessage(err) })
          return
        }
      }
      if (timer.current) clearTimeout(timer.current)
      await refresh()
    },
    [refresh]
  )

  if (state.kind === 'loading') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" aria-hidden="true" />
            Background Service
          </CardTitle>
          <CardDescription>
            The MediVault backend (PostgreSQL + API) that keeps running while
            you are logged in, managed as a macOS Login Item.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking background service status…
        </CardContent>
      </Card>
    )
  }

  if (state.kind === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" aria-hidden="true" />
            Background Service
          </CardTitle>
          <CardDescription>
            The MediVault backend (PostgreSQL + API) that keeps running while
            you are logged in, managed as a macOS Login Item.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {state.message}
            </AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const busy = state.kind === 'busy'
  const status: BackgroundServiceStatus = state.status

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" aria-hidden="true" />
          Background Service
          {busy && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
        </CardTitle>
        <CardDescription>
          The MediVault backend (PostgreSQL + API) that keeps running while
          you are logged in, managed as a macOS Login Item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'notRegistered' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Not registered</Badge>
              <span className="text-sm text-muted-foreground">
                The background service is installed but not yet enabled.
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Register it to start the backend automatically at login and keep
              it running while you work. Registration uses your account — no
              administrator password is required.
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void runAction('register', registerBackgroundService, status)
              }
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              Register background service
            </Button>
          </div>
        )}

        {status === 'enabled' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="gap-1 border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Active
              </Badge>
              <span className="text-sm text-muted-foreground">
                The background service is running and starts at login.
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              PostgreSQL and the MediVault API are supervised in the
              background. You can also control this item in System Settings →
              General → Login Items.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void runAction('unregister', unregisterBackgroundService, status)
              }
            >
              <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Stop starting at login…
            </Button>
          </div>
        )}

        {status === 'requiresApproval' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Approval required
              </Badge>
              <span className="text-sm text-muted-foreground">
                macOS needs your approval before the background service can run.
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Open System Settings → Login Items, find MediVault under
              &ldquo;Allowed at Login&rdquo;, and turn on its background
              service. This approval can only be granted by you.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    'open-settings',
                    openLoginItemsSettings,
                    status
                  )
                }
              >
                <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Open Login Items Settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                I&apos;ve approved it — recheck
              </Button>
            </div>
          </div>
        )}

        {status === 'notFound' && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              <span className="font-medium">
                Installation problem.
              </span>{' '}
              The background service could not be found in this copy of the
              app. Please reinstall MediVault. If the problem persists, this
              is a configuration error — report it with the logs from the
              Support section.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
