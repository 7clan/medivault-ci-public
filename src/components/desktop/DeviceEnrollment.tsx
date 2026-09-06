'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Key,
  KeyRound,
  Monitor,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  ShieldAlert,
  Fingerprint,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react'
import {
  generateDeviceKeyPair,
  enrollDevice,
  getDeviceStatus,
  listDevices,
  revokeDevice,
  friendlyMessage,
} from '@/lib/desktop/api'
import type { DeviceKeyPair, RegisteredDevice } from '@/lib/desktop/types'

type EnrollmentStep = 1 | 2 | 3 | 4

interface DeviceEnrollmentProps {
  onEnrolled?: () => void
  compact?: boolean
}

// =================== DEVICE ENROLLMENT ===================

export function DeviceEnrollment({ onEnrolled, compact = false }: DeviceEnrollmentProps) {
  // Current device status
  const [deviceStatus, setDeviceStatus] = useState<Awaited<ReturnType<typeof getDeviceStatus>> | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)

  // Enrollment wizard
  const [step, setStep] = useState<EnrollmentStep>(1)
  const [keyPair, setKeyPair] = useState<DeviceKeyPair | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Registered devices list
  const [devices, setDevices] = useState<RegisteredDevice[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)

  // Revoke dialog
  const [revokeTarget, setRevokeTarget] = useState<RegisteredDevice | null>(null)
  const [revoking, setRevoking] = useState(false)

  // Copy fingerprint feedback
  const [copied, setCopied] = useState(false)

  // ---- Load status ----
  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const status = await getDeviceStatus()
      setDeviceStatus(status)
      if (status.registered) {
        // Already enrolled, load devices list
        loadDevices()
      }
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  // ---- Load devices ----
  const loadDevices = useCallback(async () => {
    setLoadingDevices(true)
    try {
      const list = await listDevices()
      setDevices(list)
    } catch {
      // non-critical
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  // ---- Step 1: Generate keypair ----
  const handleGenerateKeypair = async () => {
    setError(null)
    try {
      const kp = await generateDeviceKeyPair()
      setKeyPair(kp)
      setStep(2)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }

  // ---- Step 3: Submit enrollment ----
  const handleEnroll = async () => {
    if (!pairingCode.trim() || !deviceName.trim()) {
      setError('Pairing code and device name are required.')
      return
    }
    setEnrolling(true)
    setError(null)
    try {
      await enrollDevice({
        pairing_code: pairingCode.trim(),
        device_name: deviceName.trim(),
      })
      setStep(4)
      onEnrolled?.()
      await loadStatus()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setEnrolling(false)
    }
  }

  // ---- Revoke device ----
  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setError(null)
    try {
      await revokeDevice(revokeTarget.id)
      setRevokeTarget(null)
      await loadStatus()
      await loadDevices()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setRevoking(false)
    }
  }

  // ---- Copy fingerprint ----
  const handleCopyFingerprint = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // clipboard may be unavailable
    })
  }

  // ---- Init ----
  useState(() => {
    loadStatus()
  })

  // =================== NOT ENROLLED: WIZARD ===================

  if (deviceStatus && !deviceStatus.registered && !compact) {
    return (
      <div className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" /> Device Not Enrolled
            </CardTitle>
            <CardDescription>
              This device must be enrolled before it can communicate with the MediVault server.
              Enrollment binds a cryptographic identity to this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnrollmentWizard
              step={step}
              keyPair={keyPair}
              pairingCode={pairingCode}
              deviceName={deviceName}
              enrolling={enrolling}
              error={error}
              onGenerateKeypair={handleGenerateKeypair}
              onPairingCodeChange={setPairingCode}
              onDeviceNameChange={setDeviceName}
              onEnroll={handleEnroll}
              onSetStep={setStep}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  // =================== ENROLLED: STATUS + DEVICES LIST ===================

  if (deviceStatus?.registered) {
    return (
      <div className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Current device info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-500" /> Device Enrolled
            </CardTitle>
            <CardDescription>This device is registered and authorized.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Device Name</span>
              <span className="font-medium">{deviceStatus.device_name ?? 'Unknown'}</span>
              <span className="text-muted-foreground">Device ID</span>
              <span className="font-mono text-xs">{deviceStatus.device_id ?? '—'}</span>
              <span className="text-muted-foreground">Public Key Fingerprint</span>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono">{deviceStatus.public_key_fingerprint ?? '—'}</code>
                {deviceStatus.public_key_fingerprint && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopyFingerprint(deviceStatus.public_key_fingerprint!)} aria-label="Copy fingerprint">
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                )}
              </div>
              <span className="text-muted-foreground">Enrolled</span>
              <span>{deviceStatus.enrolled_at ? new Date(deviceStatus.enrolled_at).toLocaleString() : '—'}</span>
              <span className="text-muted-foreground">Last Seen</span>
              <span>{deviceStatus.last_seen_at ? new Date(deviceStatus.last_seen_at).toLocaleString() : '—'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Registered devices list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">All Registered Devices</CardTitle>
              <CardDescription>Devices enrolled on your account.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadDevices} disabled={loadingDevices}>
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No devices found.</p>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-2">
                  {devices.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{d.device_name}</span>
                          {d.is_current && (
                            <Badge variant="outline" className="text-xs">This device</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-6">
                          <Fingerprint className="h-3 w-3" />
                          <span className="font-mono">{d.public_key_fingerprint.slice(0, 20)}…</span>
                          <span>·</span>
                          <span>{new Date(d.enrolled_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      {!d.is_current && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setRevokeTarget(d)}
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Revoke confirmation dialog */}
        <Dialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Revoke Device
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to revoke <strong>{revokeTarget?.device_name}</strong>?
                This device will no longer be able to access the MediVault server. The device
                owner will need to re-enroll to regain access.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevokeTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
                {revoking ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Revoke Device
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // =================== LOADING ===================

  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

// =================== ENROLLMENT WIZARD (INTERNAL) ===================

function EnrollmentWizard({
  step,
  keyPair,
  pairingCode,
  deviceName,
  enrolling,
  error,
  onGenerateKeypair,
  onPairingCodeChange,
  onDeviceNameChange,
  onEnroll,
  onSetStep,
}: {
  step: EnrollmentStep
  keyPair: DeviceKeyPair | null
  pairingCode: string
  deviceName: string
  enrolling: boolean
  error: string | null
  onGenerateKeypair: () => void
  onPairingCodeChange: (v: string) => void
  onDeviceNameChange: (v: string) => void
  onEnroll: () => void
  onSetStep: (s: EnrollmentStep) => void
}) {
  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                s < step
                  ? 'bg-emerald-600 text-white'
                  : s === step
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ring-2 ring-emerald-500'
                  : 'bg-muted text-muted-foreground'
              }`}
              aria-current={s === step ? 'step' : undefined}
            >
              {s < step ? <CheckCircle2 className="h-4 w-4" /> : s}
            </div>
            {s < 4 && <div className={`h-0.5 w-8 ${s < step ? 'bg-emerald-500' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      <Separator />

      {/* Step 1: Generate Keypair */}
      {step === 1 && (
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Key className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Generate Device Key Pair</h3>
            <p className="text-sm text-muted-foreground mt-1">
              A unique RSA-2048 key pair will be generated and stored securely in
              the Windows Credential Manager. The private key never leaves this device.
            </p>
          </div>
          <Button onClick={onGenerateKeypair} className="mx-auto">
            <KeyRound className="mr-2 h-4 w-4" />
            Generate Key Pair
          </Button>
        </div>
      )}

      {/* Step 2: Enter Pairing Code */}
      {step === 2 && keyPair && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Public Key Fingerprint</span>
                <Badge variant="outline" className="text-xs font-mono">SHA-256</Badge>
              </div>
              <code className="text-xs font-mono text-muted-foreground break-all">
                {keyPair.public_key_fingerprint}
              </code>
              <p className="text-xs text-muted-foreground">
                Provide this fingerprint to the administrator or enter it on another device
                to generate a pairing code.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pairing-code">Pairing Code</Label>
            <Input
              id="pairing-code"
              value={pairingCode}
              onChange={(e) => onPairingCodeChange(e.target.value)}
              placeholder="Enter the 6-digit pairing code"
              className="font-mono text-center text-lg tracking-widest"
              maxLength={10}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Obtain this code from another enrolled device or your administrator.
            </p>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => onSetStep(1)}>
              Back
            </Button>
            <Button onClick={() => onSetStep(3)} disabled={!pairingCode.trim()}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Device Name */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="device-name">Device Name</Label>
            <Input
              id="device-name"
              value={deviceName}
              onChange={(e) => onDeviceNameChange(e.target.value)}
              placeholder="e.g., Dr. Smith's Desktop PC"
            />
            <p className="text-xs text-muted-foreground">
              Choose a recognizable name for this device. It will be visible in the
              registered devices list on all your devices.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => onSetStep(2)}>
              Back
            </Button>
            <Button onClick={onEnroll} disabled={enrolling || !deviceName.trim()}>
              {enrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enrolling…
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Complete Enrollment
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Success */}
      {step === 4 && (
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Enrollment Complete</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This device is now enrolled and authorized to communicate with the MediVault server.
            </p>
          </div>
          <Button onClick={() => onSetStep(1)} variant="outline">
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
