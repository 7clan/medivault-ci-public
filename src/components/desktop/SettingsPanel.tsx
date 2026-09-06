'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Server,
  HardDrive,
  ScanLine,
  Shield,
  Info,
  Loader2,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FolderOpen,
  Database,
  Clock,
  FileText,
} from 'lucide-react'
import {
  getSettings,
  updateSettings,
  testServerConnection,
  getCertificateTrustStatus,
  getServiceStatus,
  getDatabaseStatus,
  getDeviceStatus,
  listDevices,
  revokeDevice,
  getLogContents,
  listScanners,
  friendlyMessage,
} from '@/lib/desktop/api'
import { useDesktopStore } from '@/lib/desktop/store'
import type { AppSettings, ServiceStatus, DatabaseStatus, DeviceStatus, CertTrustStatus, ScannerDevice, RegisteredDevice } from '@/lib/desktop/types'

// =================== MASKED INPUT ===================

function MaskedInput({
  value,
  onChange,
  placeholder,
  label,
  id,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
  id: string
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide value' : 'Reveal value'}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

// =================== SETTINGS PANEL ===================

export function SettingsPanel() {
  const { settings: storeSettings, updateSettings: mergeStoreSettings, serviceStatus, databaseStatus, deviceStatus, setDeviceStatus, setServiceStatus, setDatabaseStatus } = useDesktopStore()

  const [settings, setSettings] = useState<Partial<AppSettings>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Server tab state
  const [connResult, setConnResult] = useState<{ success: boolean; message: string; time?: number } | null>(null)
  const [testing, setTesting] = useState(false)
  const [certStatus, setCertStatus] = useState<CertTrustStatus | null>(null)

  // Scanner tab state
  const [scanners, setScanners] = useState<ScannerDevice[]>([])

  // Security tab state
  const [devices, setDevices] = useState<RegisteredDevice[]>([])
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // About tab state
  const [logs, setLogs] = useState('')

  // Load settings on mount
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [s, svc, db, dev, certs, logsText] = await Promise.all([
          getSettings(),
          getServiceStatus().catch(() => null),
          getDatabaseStatus().catch(() => null),
          getDeviceStatus().catch(() => null),
          getCertificateTrustStatus().catch(() => null),
          getLogContents(100).catch(() => ''),
        ])
        setSettings(s)
        if (svc) setServiceStatus(svc)
        if (db) setDatabaseStatus(db)
        if (dev) setDeviceStatus(dev)
        setCertStatus(certs)
        setLogs(logsText)
      } catch (err) {
        setError(friendlyMessage(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [setServiceStatus, setDatabaseStatus, setDeviceStatus])

  // Load scanners on scanner tab mount
  const loadScanners = useCallback(async () => {
    try {
      const list = await listScanners()
      setScanners(list)
    } catch {
      // scanner listing is non-critical
    }
  }, [])

  // Load devices on security tab mount
  const loadDevices = useCallback(async () => {
    try {
      const list = await listDevices()
      setDevices(list)
    } catch {
      // non-critical
    }
  }, [])

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true)
    setConnResult(null)
    try {
      const res = await testServerConnection(settings.server_url)
      setConnResult({
        success: res.success,
        message: res.error ?? `Server v${res.server_version ?? '?'} responding`,
        time: res.response_time_ms,
      })
    } catch (err) {
      setConnResult({ success: false, message: friendlyMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  // Save settings
  const handleSave = async (partial: Partial<AppSettings>) => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const updated = await updateSettings(partial)
      setSettings(updated)
      mergeStoreSettings(updated)
      setSuccess('Settings saved.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // Revoke device
  const handleRevokeDevice = async (deviceId: string) => {
    setRevokingId(deviceId)
    try {
      await revokeDevice(deviceId)
      await loadDevices()
      const devStat = await getDeviceStatus().catch(() => null)
      if (devStat) setDeviceStatus(devStat)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setRevokingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-700 dark:text-emerald-300">{success}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="server" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="server" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Server</span>
          </TabsTrigger>
          <TabsTrigger value="storage" className="gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Storage</span>
          </TabsTrigger>
          <TabsTrigger value="scanner" className="gap-1.5">
            <ScanLine className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Scanner</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger value="about" className="gap-1.5">
            <Info className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">About</span>
          </TabsTrigger>
        </TabsList>

        {/* ========== SERVER TAB ========== */}
        <TabsContent value="server" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Server Configuration</CardTitle>
              <CardDescription>Configure the MediVault server connection.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="settings-server-url">Server URL</Label>
                <Input
                  id="settings-server-url"
                  type="url"
                  value={settings.server_url ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, server_url: e.target.value }))}
                  placeholder="https://medivault.local"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleTestConnection} disabled={testing || !settings.server_url}>
                  {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                  Test Connection
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSave({ server_url: settings.server_url ?? '' })}
                  disabled={saving}
                >
                  Save
                </Button>
              </div>

              {connResult && (
                <Alert variant={connResult.success ? 'default' : 'destructive'}>
                  {connResult.success ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  <AlertDescription>
                    {connResult.message}
                    {connResult.time != null && (
                      <span className="ml-2 text-xs text-muted-foreground">({connResult.time} ms)</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* Certificate trust */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Certificate Trust</h4>
                {certStatus ? (
                  <div className="flex items-center gap-3">
                    {certStatus.trusted ? (
                      <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Trusted
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="mr-1 h-3 w-3" /> Not Trusted
                      </Badge>
                    )}
                    {certStatus.issuer && (
                      <span className="text-xs text-muted-foreground">{certStatus.issuer}</span>
                    )}
                    {certStatus.days_until_expiry != null && (
                      <span className="text-xs text-muted-foreground">
                        Expires in {certStatus.days_until_expiry} days
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Certificate status unavailable.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== STORAGE TAB ========== */}
        <TabsContent value="storage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Storage Settings</CardTitle>
              <CardDescription>Configure local storage directories for documents and backups.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MaskedInput
                id="data-dir"
                label="Encrypted Document Directory"
                value={settings.backup_destination ?? ''}
                onChange={(v) => setSettings((s) => ({ ...s, backup_destination: v }))}
                placeholder="C:\MediVault\data"
              />
              <MaskedInput
                id="temp-dir"
                label="Temporary Files Directory"
                value={''}
                onChange={() => {}}
                placeholder="%TEMP%\MediVault"
              />
              <MaskedInput
                id="backup-drive"
                label="Backup Drive Path"
                value={settings.backup_destination ?? ''}
                onChange={(v) => setSettings((s) => ({ ...s, backup_destination: v }))}
                placeholder="E:\\MediVault-Backup"
              />
              <Button onClick={() => handleSave({ backup_destination: settings.backup_destination })} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Storage Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== SCANNER TAB ========== */}
        <TabsContent value="scanner" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scanner Configuration</CardTitle>
              <CardDescription>Select and configure your document scanner.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Available Scanners</Label>
                <Select
                  value={settings.scan_default_config?.resolution_dpi?.toString() ?? '300'}
                  onValueChange={(v) => {
                    const dpi = parseInt(v, 10)
                    setSettings((s) => ({
                      ...s,
                      scan_default_config: {
                        ...((s.scan_default_config as AppSettings['scan_default_config']) ?? {
                          resolution_dpi: 300, color_mode: 'color', paper_size: 'auto', duplex: false, quality: 'normal',
                        }),
                        resolution_dpi: dpi,
                      },
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select scanner" />
                  </SelectTrigger>
                  <SelectContent>
                    {scanners.length === 0 ? (
                      <SelectItem value="none" disabled>No scanners found</SelectItem>
                    ) : (
                      scanners.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.scanner_type})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {scanners.length === 0 && (
                  <Button variant="outline" size="sm" onClick={loadScanners}>
                    <ScanLine className="mr-2 h-3.5 w-3.5" /> Refresh Scanner List
                  </Button>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Default Resolution</Label>
                <Select
                  value={settings.scan_default_config?.resolution_dpi?.toString() ?? '300'}
                  onValueChange={(v) => {
                    const cfg = (settings.scan_default_config as AppSettings['scan_default_config']) ?? {
                      resolution_dpi: 300, color_mode: 'color', paper_size: 'auto', duplex: false, quality: 'normal',
                    }
                    setSettings((s) => ({ ...s, scan_default_config: { ...cfg, resolution_dpi: parseInt(v, 10) } }))
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[100, 150, 200, 300, 600].map((dpi) => (
                      <SelectItem key={dpi} value={dpi.toString()}>{dpi} DPI</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Color Mode</Label>
                <Select
                  value={settings.scan_default_config?.color_mode ?? 'color'}
                  onValueChange={(v) => {
                    const cfg = (settings.scan_default_config as AppSettings['scan_default_config']) ?? {
                      resolution_dpi: 300, color_mode: 'color', paper_size: 'auto', duplex: false, quality: 'normal',
                    }
                    setSettings((s) => ({ ...s, scan_default_config: { ...cfg, color_mode: v as AppSettings['scan_default_config']['color_mode'] } }))
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="color">Color</SelectItem>
                    <SelectItem value="grayscale">Grayscale</SelectItem>
                    <SelectItem value="monochrome">Black & White</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Paper Size</Label>
                <Select
                  value={settings.scan_default_config?.paper_size ?? 'auto'}
                  onValueChange={(v) => {
                    const cfg = (settings.scan_default_config as AppSettings['scan_default_config']) ?? {
                      resolution_dpi: 300, color_mode: 'color', paper_size: 'auto', duplex: false, quality: 'normal',
                    }
                    setSettings((s) => ({ ...s, scan_default_config: { ...cfg, paper_size: v as AppSettings['scan_default_config']['paper_size'] } }))
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="letter">US Letter</SelectItem>
                    <SelectItem value="legal">US Legal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={() => handleSave({ scan_default_config: settings.scan_default_config as AppSettings['scan_default_config'] })} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Scanner Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== SECURITY TAB ========== */}
        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device Security</CardTitle>
              <CardDescription>Manage device enrollment and registered devices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current device status */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">This Device</h4>
                {deviceStatus ? (
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    {deviceStatus.registered ? (
                      <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Enrolled
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="mr-1 h-3 w-3" /> Not Enrolled
                      </Badge>
                    )}
                    {deviceStatus.public_key_fingerprint && (
                      <span className="text-xs font-mono text-muted-foreground" title="Public key fingerprint">
                        {deviceStatus.public_key_fingerprint.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Unable to retrieve device status.</p>
                )}
              </div>

              <Separator />

              {/* Registered devices list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Registered Devices</h4>
                  <Button variant="ghost" size="sm" onClick={loadDevices}>
                    Refresh
                  </Button>
                </div>
                <ScrollArea className="max-h-64">
                  <div className="space-y-2">
                    {devices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No registered devices.</p>
                    ) : (
                      devices.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{d.device_name}</span>
                              {d.is_current && (
                                <Badge variant="outline" className="text-xs">This device</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{d.public_key_fingerprint.slice(0, 12)}…</span>
                              <span>·</span>
                              <span>Enrolled {new Date(d.enrolled_at).toLocaleDateString()}</span>
                              {d.last_seen_at && (
                                <>
                                  <span>·</span>
                                  <span>Last seen {new Date(d.last_seen_at).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {!d.is_current && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={revokingId === d.id}
                              onClick={() => handleRevokeDevice(d.id)}
                            >
                              {revokingId === d.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="mr-1 h-3 w-3" />
                              )}
                              Revoke
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== ABOUT TAB ========== */}
        <TabsContent value="about" className="mt-4">
          <div className="space-y-4">
            {/* Version + service info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Application Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">1.0.0</span>
                  <span className="text-muted-foreground">Platform</span>
                  <span className="font-medium">Windows (Tauri 2)</span>
                </div>
              </CardContent>
            </Card>

            {/* Service status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4" /> Service Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {serviceStatus ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {serviceStatus.reachable ? (
                        <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">Online</Badge>
                      ) : (
                        <Badge variant="destructive">Offline</Badge>
                      )}
                      {serviceStatus.response_time_ms != null && (
                        <span className="text-muted-foreground">{serviceStatus.response_time_ms} ms</span>
                      )}
                    </div>
                    {serviceStatus.server_version && (
                      <p>Server version: {serviceStatus.server_version}</p>
                    )}
                    {serviceStatus.uptime_seconds != null && (
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> Uptime: {Math.floor(serviceStatus.uptime_seconds / 3600)}h {Math.floor((serviceStatus.uptime_seconds % 3600) / 60)}m
                      </p>
                    )}
                    {serviceStatus.error && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{serviceStatus.error}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Status unavailable.</p>
                )}
              </CardContent>
            </Card>

            {/* Database status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" /> Database Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {databaseStatus ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {databaseStatus.connected ? (
                        <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">Connected</Badge>
                      ) : (
                        <Badge variant="destructive">Disconnected</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Patients</span>
                      <span>{databaseStatus.total_patients ?? '—'}</span>
                      <span className="text-muted-foreground">Documents</span>
                      <span>{databaseStatus.total_documents ?? '—'}</span>
                      <span className="text-muted-foreground">Size</span>
                      <span>{databaseStatus.size_bytes != null ? formatBytes(databaseStatus.size_bytes) : '—'}</span>
                      <span className="text-muted-foreground">Last Backup</span>
                      <span>
                        {databaseStatus.last_backup
                          ? new Date(databaseStatus.last_backup).toLocaleString()
                          : '—'}
                      </span>
                    </div>
                    {databaseStatus.error && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{databaseStatus.error}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Status unavailable.</p>
                )}
              </CardContent>
            </Card>

            {/* Log viewer */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Recent Logs
                </CardTitle>
                <CardDescription>Last 100 lines from the service log (sensitive data redacted).</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-64">
                  <pre className="text-xs font-mono bg-muted rounded-md p-3 whitespace-pre-wrap break-all">
                    {logs || 'No log entries available.'}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- Helpers ----------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
