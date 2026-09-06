'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Stethoscope, Loader2, Wifi, WifiOff, KeyRound, ShieldCheck } from 'lucide-react'
import { login, testServerConnection, changePassword, getDeviceStatus, friendlyMessage } from '@/lib/desktop/api'
import { useDesktopStore } from '@/lib/desktop/store'

type LoginPhase = 'login' | 'change-password' | 'enrollment'

export function DesktopLoginForm() {
  const { serverUrl, setServerUrl, setAuthenticated, updateSettings } = useDesktopStore()

  // Form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [urlInput, setUrlInput] = useState(serverUrl)

  // Change password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // UI state
  const [phase, setPhase] = useState<LoginPhase>('login')
  const [loading, setLoading] = useState(false)
  const [testingConn, setTestingConn] = useState(false)
  const [connStatus, setConnStatus] = useState<'idle' | 'success' | 'fail' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // --- Connection test ---
  const handleTestConnection = useCallback(async () => {
    setTestingConn(true)
    setConnStatus(null)
    setError(null)
    try {
      const result = await testServerConnection(urlInput || undefined)
      if (result.success) {
        setConnStatus('success')
        setServerUrl(urlInput)
      } else {
        setConnStatus('fail')
        setError(result.error ?? 'Connection failed')
      }
    } catch (err) {
      setConnStatus('fail')
      setError(friendlyMessage(err))
    } finally {
      setTestingConn(false)
    }
  }, [urlInput, setServerUrl])

  // --- Login ---
  const handleLogin = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setLoading(true)
      setError(null)

      try {
        const session = await login({
          email,
          password,
          server_url: urlInput || undefined,
        })

        setAuthenticated(session)
        updateSettings({ server_url: session.email ? urlInput : undefined })

        // Check if device is enrolled
        if (session.force_password_change) {
          setPhase('change-password')
          return
        }

        try {
          const devStatus = await getDeviceStatus()
          if (!devStatus.registered) {
            setPhase('enrollment')
            return
          }
        } catch {
          // Non-fatal — proceed to app
        }
      } catch (err) {
        setError(friendlyMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [email, password, urlInput, setAuthenticated, updateSettings]
  )

  // --- Change password ---
  const handleChangePassword = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await changePassword({
        current_password: password,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      // After password change, check enrollment
      try {
        const devStatus = await getDeviceStatus()
        if (!devStatus.registered) {
          setPhase('enrollment')
          return
        }
      } catch {
        // proceed
      }
      setPhase('login')
      setPassword('')
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setLoading(false)
    }
  }, [password, newPassword, confirmPassword])

  // --- Enrollment redirect ---
  const handleEnrollmentComplete = useCallback(() => {
    setPhase('login')
    setEmail('')
    setPassword('')
  }, [])

  // ======================== RENDER ========================

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/40">
            <Stethoscope className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gradient-emerald">MediVault</h1>
          <p className="text-sm text-muted-foreground">Secure Medical Document Management</p>
        </div>

        {/* ---- LOGIN PHASE ---- */}
        {phase === 'login' && (
          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-xl">Sign In</CardTitle>
              <CardDescription>
                Enter your credentials to access the desktop app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4" aria-label="Sign in form">
                {/* Server URL */}
                <div className="space-y-2">
                  <Label htmlFor="server-url">Server URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="server-url"
                      type="url"
                      placeholder="https://medivault.local"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      aria-label="Server URL"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleTestConnection}
                      disabled={testingConn || !urlInput}
                      aria-label="Test server connection"
                    >
                      {testingConn ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : connStatus === 'success' ? (
                        <Wifi className="h-4 w-4 text-emerald-500" />
                      ) : connStatus === 'fail' ? (
                        <WifiOff className="h-4 w-4 text-destructive" />
                      ) : (
                        <Wifi className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {connStatus === 'success' && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">Connected successfully</p>
                  )}
                </div>

                <Separator />

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="doctor@clinic.example"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    disabled={loading}
                  />
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                  />
                </div>

                {/* Error */}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Submit */}
                <Button type="submit" className="w-full" disabled={loading || !email || !password}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ---- CHANGE PASSWORD PHASE ---- */}
        {phase === 'change-password' && (
          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center pb-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2">
                <KeyRound className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <CardTitle className="text-xl">Change Password</CardTitle>
              <CardDescription>
                Your administrator requires you to set a new password before continuing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4" aria-label="Change password form">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Minimum 12 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={loading || !newPassword || !confirmPassword}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ---- ENROLLMENT PHASE ---- */}
        {phase === 'enrollment' && (
          <DeviceEnrollmentInline onComplete={handleEnrollmentComplete} />
        )}
      </div>
    </div>
  )
}

// ---------- Inline enrollment component used inside the login flow ----------
// (Full enrollment component is in DeviceEnrollment.tsx; this is a
//  lightweight version that returns control to the login flow after
//  enrollment completes.)

import { DeviceEnrollment } from './DeviceEnrollment'

function DeviceEnrollmentInline({ onComplete }: { onComplete: () => void }) {
  return (
    <Card className="border-0 shadow-xl">
      <CardHeader className="text-center pb-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <CardTitle className="text-xl">Device Enrollment</CardTitle>
        <CardDescription>
          This device needs to be enrolled before you can use the desktop app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeviceEnrollment
          onEnrolled={onComplete}
          compact
        />
      </CardContent>
    </Card>
  )
}
