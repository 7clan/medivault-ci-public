'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ScanLine,
  Plus,
  RotateCw,
  Trash2,
  GripVertical,
  Upload,
  Loader2,
  XCircle,
  AlertTriangle,
  FileImage,
  Search,
  User,
  FileText,
  CheckCircle2,
} from 'lucide-react'
import {
  listScanners,
  scanSinglePage,
  rotatePage,
  removePage,
  createPdfFromPages,
  cleanupTempFiles,
  uploadDocument,
  searchPatients,
  friendlyMessage,
} from '@/lib/desktop/api'
import { useDesktopStore } from '@/lib/desktop/store'
import type {
  ScannerDevice,
  ScanConfig,
  ScanResult,
  ScanColorMode,
  ScanPaperSize,
  PatientSearchResult,
} from '@/lib/desktop/types'

// =================== SCANNER PANEL ===================

export function ScannerPanel() {
  const { settings } = useDesktopStore()

  // Scanner list
  const [scanners, setScanners] = useState<ScannerDevice[]>([])
  const [selectedScannerId, setSelectedScannerId] = useState<string>('')
  const [loadingScanners, setLoadingScanners] = useState(false)

  // Scan config
  const [dpi, setDpi] = useState<number>(settings.scan_default_config?.resolution_dpi ?? 300)
  const [colorMode, setColorMode] = useState<ScanColorMode>(
    (settings.scan_default_config?.color_mode as ScanColorMode) ?? 'color'
  )
  const [paperSize, setPaperSize] = useState<ScanPaperSize>(
    (settings.scan_default_config?.paper_size as ScanPaperSize) ?? 'auto'
  )

  // Scanned pages
  const [pages, setPages] = useState<ScanResult[]>([])

  // Scanning state
  const [scanning, setScanning] = useState(false)
  const [creatingPdf, setCreatingPdf] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Patient assignment
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([])
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null)
  const [searchingPatient, setSearchingPatient] = useState(false)

  // Document metadata
  const [docTitle, setDocTitle] = useState('')
  const [docCategory, setDocCategory] = useState('')

  // PDF path (after creation)
  const [pdfPath, setPdfPath] = useState<string | null>(null)

  // Error
  const [error, setError] = useState<string | null>(null)

  // ---- Load scanners ----
  const loadScanners = useCallback(async () => {
    setLoadingScanners(true)
    setError(null)
    try {
      const list = await listScanners()
      setScanners(list)
      if (list.length > 0 && !selectedScannerId) {
        const defaultScanner = list.find((s) => s.is_default) ?? list[0]
        setSelectedScannerId(defaultScanner.id)
      }
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setLoadingScanners(false)
    }
  }, [selectedScannerId])

  useEffect(() => {
    loadScanners()
  }, [loadScanners])

  // ---- Search patients (debounced) ----
  useEffect(() => {
    if (!patientQuery || patientQuery.length < 2) {
      setPatientResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearchingPatient(true)
      try {
        const res = await searchPatients(patientQuery, 1, 10)
        setPatientResults(res.items)
      } catch {
        // non-critical
      } finally {
        setSearchingPatient(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [patientQuery])

  // ---- Scan a page ----
  const handleScan = async () => {
    if (!selectedScannerId) {
      setError('No scanner selected. Please connect a scanner and refresh the list.')
      return
    }
    setScanning(true)
    setError(null)
    try {
      const config: ScanConfig = {
        resolution_dpi: dpi,
        color_mode: colorMode,
        paper_size: paperSize,
        duplex: false,
        quality: 'normal',
      }
      const result = await scanSinglePage(config, selectedScannerId)
      setPages((p) => [...p, result])
      setPdfPath(null) // invalidate previous PDF
    } catch (err) {
      const msg = friendlyMessage(err)
      if (msg.toLowerCase().includes('scanner') || msg.toLowerCase().includes('wia')) {
        setError(`Scanner error: ${msg}. Make sure the scanner is powered on and not in use by another application.`)
      } else {
        setError(msg)
      }
    } finally {
      setScanning(false)
    }
  }

  // ---- Rotate page ----
  const handleRotate = async (index: number, degrees: number) => {
    const page = pages[index]
    setError(null)
    try {
      const newPath = await rotatePage(page.page_path, degrees)
      const updated = [...pages]
      updated[index] = { ...page, page_path: newPath }
      setPages(updated)
      setPdfPath(null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }

  // ---- Remove page ----
  const handleRemovePage = async (index: number) => {
    const page = pages[index]
    setError(null)
    try {
      await removePage(page.page_path)
      setPages((p) => p.filter((_, i) => i !== index))
      setPdfPath(null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }

  // ---- Move page ----
  const handleMovePage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= pages.length) return
    const updated = [...pages]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)
    setPages(updated)
    setPdfPath(null)
  }

  // ---- Create PDF ----
  const handleCreatePdf = async () => {
    if (pages.length === 0) return
    setCreatingPdf(true)
    setError(null)
    try {
      const paths = pages.map((p) => p.page_path)
      const pdf = await createPdfFromPages(paths)
      setPdfPath(pdf)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setCreatingPdf(false)
    }
  }

  // ---- Upload ----
  const handleUpload = async () => {
    if (!pdfPath || !selectedPatient) return
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    try {
      // Simulate progress
      const interval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 10, 90))
      }, 200)

      await uploadDocument(
        selectedPatient.id,
        pdfPath,
        docTitle || undefined,
        docCategory || undefined
      )

      clearInterval(interval)
      setUploadProgress(100)

      // Cleanup temp files after upload
      const paths = pages.map((p) => p.page_path)
      if (pdfPath) paths.push(pdfPath)
      await cleanupTempFiles(paths).catch(() => {}) // best-effort

      // Reset
      setPages([])
      setPdfPath(null)
      setDocTitle('')
      setDocCategory('')
      setSelectedPatient(null)
      setPatientQuery('')
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // ---- Clear all ----
  const handleClearAll = async () => {
    const paths = pages.map((p) => p.page_path)
    if (pdfPath) paths.push(pdfPath)
    await cleanupTempFiles(paths).catch(() => {})
    setPages([])
    setPdfPath(null)
    setError(null)
  }

  // =================== RENDER ===================

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- Scanner Config + Scan Button ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4" /> Scanner
          </CardTitle>
          <CardDescription>Select scanner and configure scan settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Scanner selection */}
            <div className="space-y-1.5">
              <Label>Scanner</Label>
              <div className="flex gap-2">
                <Select value={selectedScannerId} onValueChange={setSelectedScannerId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select scanner" />
                  </SelectTrigger>
                  <SelectContent>
                    {scanners.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={loadScanners} disabled={loadingScanners} aria-label="Refresh scanner list">
                  {loadingScanners ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {scanners.length === 0 && !loadingScanners && (
                <p className="text-xs text-muted-foreground">No scanners detected. Connect a WIA-compatible scanner.</p>
              )}
            </div>

            {/* Resolution */}
            <div className="space-y-1.5">
              <Label>Resolution</Label>
              <Select value={dpi.toString()} onValueChange={(v) => setDpi(parseInt(v, 10))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[100, 150, 200, 300, 600].map((d) => (
                    <SelectItem key={d} value={d.toString()}>{d} DPI</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Color mode */}
            <div className="space-y-1.5">
              <Label>Color Mode</Label>
              <Select value={colorMode} onValueChange={(v) => setColorMode(v as ScanColorMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="color">Color</SelectItem>
                  <SelectItem value="grayscale">Grayscale</SelectItem>
                  <SelectItem value="monochrome">Black & White</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Paper size */}
            <div className="space-y-1.5">
              <Label>Paper Size</Label>
              <Select value={paperSize} onValueChange={(v) => setPaperSize(v as ScanPaperSize)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="letter">US Letter</SelectItem>
                  <SelectItem value="legal">US Legal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Scan button */}
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={handleScan}
                disabled={scanning || !selectedScannerId}
              >
                {scanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning Page {pages.length + 1}…
                  </>
                ) : (
                  <>
                    <ScanLine className="mr-2 h-4 w-4" />
                    Scan Page
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Page Preview Grid ---- */}
      {pages.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileImage className="h-4 w-4" /> Scanned Pages
                <Badge variant="secondary">{pages.length}</Badge>
              </CardTitle>
              <CardDescription>
                Rotate, reorder, or remove pages before creating the PDF.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add More Pages
              </Button>
              <Button size="sm" onClick={handleCreatePdf} disabled={creatingPdf || pdfPath !== null}>
                {creatingPdf ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="mr-1 h-3.5 w-3.5" />
                )}
                Create PDF
              </Button>
              <Button variant="ghost" size="icon" onClick={handleClearAll} aria-label="Clear all pages">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {pages.map((page, idx) => (
                  <div
                    key={page.page_path}
                    className="group relative rounded-lg border bg-muted/50 p-2 space-y-2"
                  >
                    {/* Page thumbnail placeholder */}
                    <div className="aspect-[3/4] rounded bg-background flex items-center justify-center">
                      <FileImage className="h-8 w-8 text-muted-foreground/40" />
                    </div>

                    {/* Page label */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Page {idx + 1}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {(page.file_size_bytes / 1024).toFixed(0)} KB
                      </span>
                    </div>

                    {/* Page actions */}
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleMovePage(idx, idx - 1)}
                        disabled={idx === 0}
                        aria-label="Move page up"
                      >
                        <GripVertical className="h-3 w-3 -rotate-90" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleRotate(idx, -90)}
                        aria-label="Rotate left"
                      >
                        <RotateCw className="h-3 w-3 rotate-90" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleRotate(idx, 90)}
                        aria-label="Rotate right"
                      >
                        <RotateCw className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleMovePage(idx, idx + 1)}
                        disabled={idx === pages.length - 1}
                        aria-label="Move page down"
                      >
                        <GripVertical className="h-3 w-3 rotate-90" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleRemovePage(idx)}
                        aria-label="Remove page"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ---- Upload Section ---- */}
      {pdfPath && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload Document
            </CardTitle>
            <CardDescription>
              Assign to a patient and provide metadata before uploading.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-700 dark:text-emerald-300">
                PDF created successfully with {pages.length} page{pages.length !== 1 ? 's' : ''}.
              </AlertDescription>
            </Alert>

            {/* Patient search */}
            <div className="space-y-1.5">
              <Label htmlFor="patient-search">Patient</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="patient-search"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Search by name, MRN, or date of birth…"
                  className="pl-9"
                  disabled={uploading}
                />
                {searchingPatient && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {/* Patient results dropdown */}
              {patientResults.length > 0 && !selectedPatient && (
                <div className="rounded-md border bg-popover p-1 shadow-md">
                  {patientResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left transition-colors"
                      onClick={() => {
                        setSelectedPatient(p)
                        setPatientQuery(p.full_name)
                        setPatientResults([])
                      }}
                    >
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium">{p.full_name}</span>
                      {p.mrn && <span className="text-xs text-muted-foreground">MRN: {p.mrn}</span>}
                      {p.date_of_birth && <span className="text-xs text-muted-foreground">DOB: {p.date_of_birth}</span>}
                    </button>
                  ))}
                </div>
              )}
              {selectedPatient && (
                <div className="flex items-center gap-2 rounded-md border p-2">
                  <User className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">{selectedPatient.full_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={() => {
                      setSelectedPatient(null)
                      setPatientQuery('')
                    }}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            {/* Document metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="doc-title">Title</Label>
                <Input
                  id="doc-title"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g., Lab Results — Blood Panel"
                  disabled={uploading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-category">Category</Label>
                <Select value={docCategory} onValueChange={setDocCategory} disabled={uploading}>
                  <SelectTrigger id="doc-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lab-result">Lab Result</SelectItem>
                    <SelectItem value="imaging">Imaging</SelectItem>
                    <SelectItem value="prescription">Prescription</SelectItem>
                    <SelectItem value="referral">Referral</SelectItem>
                    <SelectItem value="clinical-note">Clinical Note</SelectItem>
                    <SelectItem value="consent-form">Consent Form</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">Uploading… {uploadProgress}%</p>
              </div>
            )}

            {/* Upload button */}
            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={uploading || !selectedPatient}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {pages.length === 0 && !pdfPath && (
        <div className="text-center py-12 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-muted flex items-center justify-center">
            <ScanLine className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">Ready to Scan</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Select a scanner above and click &quot;Scan Page&quot; to begin. You can scan
            multiple pages, reorder them, and combine into a PDF for upload.
          </p>
        </div>
      )}
    </div>
  )
}
