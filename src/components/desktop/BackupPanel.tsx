'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  HardDrive,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  FileText,
  FolderOpen,
  RefreshCw,
} from 'lucide-react'
import {
  getBackupDriveStatus,
  selectBackupDestination,
  startManualBackup,
  getBackupProgress,
  verifyBackupChecksums,
  getRestorePreview,
  executeRestore,
  getBackupHistory,
  friendlyMessage,
} from '@/lib/desktop/api'
import type {
  BackupInfo,
  BackupDriveStatus,
  BackupProgress as BackupProgressType,
  RestorePreview,
  RestoreResult,
  ChecksumResult,
} from '@/lib/desktop/types'

// ---------- Helpers ----------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>
    case 'in_progress':
    case 'running':
      return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> In Progress</Badge>
    case 'failed':
      return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Failed</Badge>
    case 'cancelled':
      return <Badge variant="outline">Cancelled</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

// =================== BACKUP PANEL ===================

export function BackupPanel() {
  // Drive status
  const [driveStatus, setDriveStatus] = useState<BackupDriveStatus | null>(null)

  // Backup history
  const [history, setHistory] = useState<BackupInfo[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Manual backup
  const [backupStarting, setBackupStarting] = useState(false)
  const [backupProgress, setBackupProgress] = useState<BackupProgressType | null>(null)
  const [backupPollId, setBackupPollId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Restore
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState(0)
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null)

  // Checksum verification
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [checksumResults, setChecksumResults] = useState<ChecksumResult[] | null>(null)

  // Dialogs
  const [showBackupConfirm, setShowBackupConfirm] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [showRestoreResult, setShowRestoreResult] = useState(false)

  // Error
  const [error, setError] = useState<string | null>(null)

  // ---- Load drive status & history ----
  const refresh = useCallback(async () => {
    try {
      const [ds, hist] = await Promise.all([
        getBackupDriveStatus(),
        getBackupHistory(),
      ])
      setDriveStatus(ds)
      setHistory(hist)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ---- Select backup drive ----
  const handleSelectDrive = async () => {
    try {
      await selectBackupDestination()
      const ds = await getBackupDriveStatus()
      setDriveStatus(ds)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }

  // ---- Start manual backup ----
  const handleStartBackup = async () => {
    setShowBackupConfirm(false)
    setBackupStarting(true)
    setError(null)
    try {
      const backupId = await startManualBackup()
      setBackupPollId(backupId)

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const prog = await getBackupProgress(backupId)
          setBackupProgress(prog)
          if (prog.current_step === 'completed' || prog.current_step === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setBackupPollId(null)
            setBackupStarting(false)
            await refresh()
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 1000)
    } catch (err) {
      setError(friendlyMessage(err))
      setBackupStarting(false)
    }
  }

  // ---- Verify checksums ----
  const handleVerify = async (backupId: string) => {
    setVerifyingId(backupId)
    setChecksumResults(null)
    setError(null)
    try {
      const results = await verifyBackupChecksums(backupId)
      setChecksumResults(results)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setVerifyingId(null)
    }
  }

  // ---- Restore preview ----
  const handleRestorePreview = async (backupId: string) => {
    setSelectedBackupId(backupId)
    setError(null)
    try {
      const preview = await getRestorePreview(backupId)
      setRestorePreview(preview)
      setShowRestoreConfirm(true)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }

  // ---- Execute restore ----
  const handleExecuteRestore = async () => {
    if (!selectedBackupId) return
    setShowRestoreConfirm(false)
    setRestoring(true)
    setRestoreProgress(0)
    setError(null)
    try {
      const result = await executeRestore(selectedBackupId)
      setRestoreResult(result)
      setRestoreProgress(100)
      setShowRestoreResult(true)
      await refresh()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setRestoring(false)
      setSelectedBackupId(null)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- Drive Status Card ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> Backup Drive
          </CardTitle>
          <CardDescription>Status of the configured backup destination.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {driveStatus ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {driveStatus.available ? (
                  <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="mr-1 h-3 w-3" /> Disconnected
                  </Badge>
                )}
                {driveStatus.drive_label && (
                  <span className="text-sm text-muted-foreground">{driveStatus.drive_label}</span>
                )}
              </div>
              {driveStatus.available && (
                <div className="grid grid-cols-2 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Free Space</span>
                  <span className="font-medium">
                    {driveStatus.free_space_bytes != null ? formatBytes(driveStatus.free_space_bytes) : '—'}
                  </span>
                  <span className="text-muted-foreground">Total Space</span>
                  <span>
                    {driveStatus.total_space_bytes != null ? formatBytes(driveStatus.total_space_bytes) : '—'}
                  </span>
                  {driveStatus.free_space_bytes != null && driveStatus.total_space_bytes != null && (
                    <>
                      <span className="text-muted-foreground">Usage</span>
                      <span>{Math.round((1 - driveStatus.free_space_bytes / driveStatus.total_space_bytes) * 100)}%</span>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No backup drive configured.</p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectDrive}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Select Backup Drive
            </Button>
            <Button
              size="sm"
              onClick={() => setShowBackupConfirm(true)}
              disabled={!driveStatus?.available || backupStarting || !!backupPollId}
            >
              {backupStarting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Start Manual Backup
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- Active Backup Progress ---- */}
      {(backupProgress || backupStarting) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Backup In Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={backupProgress?.percentage ?? 0} className="h-3" />
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              <span className="text-muted-foreground">Step</span>
              <span className="capitalize">{backupProgress?.current_step ?? 'Initializing…'}</span>
              <span className="text-muted-foreground">Files</span>
              <span>
                {backupProgress?.files_processed ?? 0}
                {backupProgress?.total_files != null ? ` / ${backupProgress.total_files}` : ''}
              </span>
              <span className="text-muted-foreground">Size</span>
              <span>
                {formatBytes(backupProgress?.bytes_processed ?? 0)}
                {backupProgress?.total_bytes != null ? ` / ${formatBytes(backupProgress.total_bytes)}` : ''}
              </span>
              {backupProgress?.estimated_remaining_seconds != null && (
                <>
                  <span className="text-muted-foreground">ETA</span>
                  <span>~{Math.ceil(backupProgress.estimated_remaining_seconds / 60)} min</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Backup History ---- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Backup History
            </CardTitle>
            <CardDescription>Previous backups on this drive.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loadingHistory}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No backup history found.</p>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-3">
                {history.map((b) => (
                  <div key={b.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {statusBadge(b.status)}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(b.started_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {b.status === 'completed' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleVerify(b.id)}
                              disabled={verifyingId === b.id}
                            >
                              {verifyingId === b.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <ShieldCheck className="mr-1 h-3 w-3" />
                              )}
                              Verify
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestorePreview(b.id)}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Restore
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {b.file_count != null && (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {b.file_count} files
                        </span>
                      )}
                      {b.total_size_bytes != null && (
                        <span>{formatBytes(b.total_size_bytes)}</span>
                      )}
                      {b.checksum_algorithm && (
                        <span className="font-mono">{b.checksum_algorithm}</span>
                      )}
                    </div>

                    {/* Checksum results inline */}
                    {checksumResults && verifyingId === null && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          {checksumResults.every((c) => c.matches) ? (
                            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-xs">
                              <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> All checksums valid
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <XCircle className="mr-1 h-2.5 w-2.5" /> {checksumResults.filter((c) => !c.matches).length} mismatch(es)
                            </Badge>
                          )}
                        </div>
                        <ScrollArea className="max-h-24">
                          <div className="space-y-0.5">
                            {checksumResults.map((c, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                                {c.matches ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-destructive shrink-0" />
                                )}
                                <span className="truncate">{c.file_path}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ---- Backup Confirmation Dialog ---- */}
      <Dialog open={showBackupConfirm} onOpenChange={setShowBackupConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Manual Backup?</DialogTitle>
            <DialogDescription>
              This will create a new backup of all encrypted documents and metadata
              to the configured backup drive. Large backups may take several minutes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBackupConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleStartBackup} disabled={!driveStatus?.available}>
              <Play className="mr-2 h-4 w-4" /> Start Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Restore Preview Dialog ---- */}
      <Dialog open={showRestoreConfirm} onOpenChange={(open) => { if (!open) { setShowRestoreConfirm(false); setRestorePreview(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore from Backup</DialogTitle>
            <DialogDescription>
              Review the contents of this backup before restoring.
            </DialogDescription>
          </DialogHeader>

          {restorePreview && (
            <div className="space-y-4">
              {restorePreview.warnings.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {restorePreview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-muted-foreground">Files</span>
                <span className="font-medium">{restorePreview.file_count}</span>
                <span className="text-muted-foreground">Total Size</span>
                <span className="font-medium">{formatBytes(restorePreview.total_size_bytes)}</span>
              </div>

              <Separator />

              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {restorePreview.files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="font-mono truncate max-w-[70%]">{f.path}</span>
                      <span className="text-muted-foreground ml-2 shrink-0">{formatBytes(f.size_bytes)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRestoreConfirm(false); setRestorePreview(null) }}>
              Cancel
            </Button>
            <AlertDialog open onOpenChange={(open) => { if (!open) return; }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <RotateCcw className="mr-2 h-4 w-4" /> Restore Backup
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Confirm Restore
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <strong>This will overwrite existing data.</strong> Restoring from a backup
                    replaces current documents and metadata. This action cannot be undone.
                    Make sure you have a current backup before proceeding.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleExecuteRestore}>
                    Yes, Restore Now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Restore Result Dialog ---- */}
      <Dialog open={showRestoreResult} onOpenChange={setShowRestoreResult}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore Complete</DialogTitle>
          </DialogHeader>
          {restoreResult && (
            <div className="space-y-4">
              {restoreResult.success ? (
                <Alert className="border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-emerald-700 dark:text-emerald-300">
                    Restore completed successfully.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    Restore completed with errors. Some files may not have been restored.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-muted-foreground">Restored</span>
                <span className="font-medium text-emerald-600">{restoreResult.restored_count}</span>
                <span className="text-muted-foreground">Failed</span>
                <span className="font-medium text-destructive">{restoreResult.failed_count}</span>
              </div>

              {restoreResult.errors.length > 0 && (
                <ScrollArea className="max-h-40">
                  <div className="space-y-1">
                    {restoreResult.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-destructive">
                        <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>{e}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowRestoreResult(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
