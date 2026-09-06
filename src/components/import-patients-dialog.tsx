'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  FileSpreadsheet,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileDown,
  Users,
  AlertTriangle,
  CloudUpload,
} from 'lucide-react'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  totalErrors: number
}

interface ImportPatientsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
}

type ImportPhase = 'idle' | 'uploading' | 'processing' | 'complete' | 'error'

export function ImportPatientsDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportPatientsDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const { toast } = useToast()

  const resetState = useCallback(() => {
    setFile(null)
    setPhase('idle')
    setProgress(0)
    setResult(null)
    setError('')
    setIsDragging(false)
    dragCounterRef.current = 0
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handleClose = useCallback(() => {
    if (phase === 'uploading' || phase === 'processing') return
    resetState()
    onOpenChange(false)
  }, [phase, resetState, onOpenChange])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const validateFile = useCallback((selectedFile: File): string | null => {
    if (!selectedFile) return 'No file selected.'
    if (!selectedFile.name.endsWith('.csv')) {
      return 'Only CSV files are accepted. Please select a .csv file.'
    }
    if (selectedFile.size === 0) {
      return 'The selected file is empty.'
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      return 'File size exceeds 10 MB limit.'
    }
    return null
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)

      if (phase !== 'idle' && phase !== 'complete' && phase !== 'error') return

      const droppedFile = e.dataTransfer.files?.[0]
      if (!droppedFile) return

      const validationError = validateFile(droppedFile)
      if (validationError) {
        setError(validationError)
        return
      }

      setFile(droppedFile)
      setError('')
      setPhase('idle')
      setResult(null)
    },
    [phase, validateFile]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0]
      if (!selectedFile) return

      const validationError = validateFile(selectedFile)
      if (validationError) {
        setError(validationError)
        return
      }

      setFile(selectedFile)
      setError('')
      setPhase('idle')
      setResult(null)
    },
    [validateFile]
  )

  const handleDownloadTemplate = useCallback(() => {
    const headers = 'firstName,lastName,dateOfBirth,phone,email,address,notes'
    const sampleRows = [
      'John,Doe,1990-05-15,555-123-4567,john.doe@email.com,"123 Main St, Springfield",Regular checkup patient',
      'Jane,Smith,1985-11-22,555-987-6543,jane.smith@email.com,"456 Oak Ave, Riverside",Diabetic patient',
    ]
    const csv = `${headers}\n${sampleRows.join('\n')}\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'medivault-patient-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImport = useCallback(async () => {
    if (!file) return

    setPhase('uploading')
    setProgress(0)
    setError('')

    // Simulate upload progress (the API doesn't stream progress, so we animate)
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 80) {
          clearInterval(progressInterval)
          return 80
        }
        return prev + Math.random() * 15 + 5
      })
    }, 200)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/patients/import',  { credentials: 'include',
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)
      setProgress(90)

      const data = await res.json()
      setProgress(100)

      // Small delay for the progress bar to fill visually
      await new Promise((resolve) => setTimeout(resolve, 400))

      if (!res.ok) {
        setError(data.error || 'An unexpected error occurred during import.')
        setPhase('error')
        toast({
          title: 'Import Failed',
          description: data.error || 'An unexpected error occurred.',
          variant: 'destructive',
        })
        return
      }

      setResult({
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        errors: data.errors || [],
        totalErrors: data.totalErrors || 0,
      })
      setPhase('complete')

      toast({
        title: 'Import Complete',
        description: `Successfully imported ${data.imported} patient${data.imported !== 1 ? 's' : ''}.${data.skipped > 0 ? ` ${data.skipped} row${data.skipped !== 1 ? 's' : ''} skipped.` : ''}`,
      })

      if (data.errors && data.errors.length > 0) {
        toast({
          title: `${data.totalErrors || data.errors.length} Error${(data.totalErrors || data.errors.length) !== 1 ? 's' : ''} During Import`,
          description:
            data.errors.slice(0, 3).join('\n') +
            (data.errors.length > 3
              ? `\n...and ${(data.totalErrors || data.errors.length) - 3} more`
              : ''),
          variant: 'destructive',
        })
      }

      onImportComplete()
    } catch {
      clearInterval(progressInterval)
      setPhase('error')
      setError('Network error. Please check your connection and try again.')
      toast({
        title: 'Import Failed',
        description: 'Network error. Please check your connection and try again.',
        variant: 'destructive',
      })
    }
  }, [file, toast, onImportComplete])

  const handleReset = useCallback(() => {
    resetState()
  }, [resetState])

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isUploading = phase === 'uploading' || phase === 'processing'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        showCloseButton={!isUploading}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Upload className="h-4 w-4 text-white" />
            </div>
            Import Patients
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk import patient records into MediVault
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-2">
            {/* Template download link */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60"
            >
              <FileDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-700 dark:text-emerald-300">
                Need a template?
              </span>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 underline underline-offset-2 transition-colors ml-auto"
              >
                Download CSV template
              </button>
            </motion.div>

            {/* Drag & Drop Area */}
            <AnimatePresence mode="wait">
              {(phase === 'idle' || phase === 'error') && (
                <motion.div
                  key="dropzone"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className={`
                    relative rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300
                    ${
                      isDragging
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 scale-[1.02]'
                        : file
                          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }
                  `}
                  onClick={() => {
                    if (phase !== 'idle' && phase !== 'error') return
                    fileInputRef.current?.click()
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  {/* Animated dashed border on drag */}
                  {isDragging && (
                    <motion.div
                      className="absolute inset-0 rounded-xl border-2 border-emerald-400 dark:border-emerald-500 pointer-events-none"
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        scale: { duration: 0.2 },
                        opacity: { duration: 0.15 },
                      }}
                    />
                  )}

                  <AnimatePresence mode="wait">
                    {file ? (
                      <motion.div
                        key="file-selected"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="space-y-3"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                          <FileSpreadsheet className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[280px] mx-auto">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setFile(null)
                            setError('')
                            setResult(null)
                            setPhase('idle')
                            if (fileInputRef.current) {
                              fileInputRef.current.value = ''
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                        >
                          <X className="h-3 w-3" />
                          Remove file
                        </button>
                      </motion.div>
                    ) : isDragging ? (
                      <motion.div
                        key="dragging"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="space-y-3"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-200 dark:bg-emerald-800/50 flex items-center justify-center">
                          <motion.div
                            animate={{ y: [0, -4, 0] }}
                            transition={{ type: 'tween', repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                          >
                            <CloudUpload className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                          </motion.div>
                        </div>
                        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          Drop your CSV file here
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="space-y-3"
                      >
                        <div className="mx-auto w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          <Upload className="h-7 w-7 text-gray-400 dark:text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Drag & drop your CSV file here
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            or click to browse — .csv files up to 10 MB
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* Uploading / Processing Phase */}
              {(phase === 'uploading' || phase === 'processing') && (
                <motion.div
                  key="uploading"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700 p-8 text-center bg-emerald-50/50 dark:bg-emerald-950/20 space-y-4"
                >
                  <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                    >
                      <Loader2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                    </motion.div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {phase === 'uploading' ? 'Uploading file...' : 'Processing patients...'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {file?.name}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Progress
                      value={Math.min(progress, 100)}
                      className="h-2 bg-emerald-100 dark:bg-emerald-900/40"
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {Math.min(Math.round(progress), 100)}%
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Complete Phase */}
              {phase === 'complete' && result && (
                <motion.div
                  key="complete"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-4"
                >
                  {/* Success banner */}
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-5"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center"
                      >
                        <CheckCircle2 className="h-5 w-5 text-white" />
                      </motion.div>
                      <div>
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                          Import Successful
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          {result.imported > 0
                            ? `${result.imported} patient${result.imported !== 1 ? 's' : ''} imported successfully`
                            : 'No new patients were imported'}
                        </p>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-white dark:bg-gray-900 p-3 text-center border border-emerald-100 dark:border-emerald-900/50">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-xs text-muted-foreground">Imported</span>
                        </div>
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2 }}
                          className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums"
                        >
                          {result.imported}
                        </motion.span>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-gray-900 p-3 text-center border border-amber-100 dark:border-amber-900/50">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-xs text-muted-foreground">Skipped</span>
                        </div>
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums"
                        >
                          {result.skipped}
                        </motion.span>
                      </div>
                    </div>
                  </motion.div>

                  {/* Errors section */}
                  {result.errors.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-red-500" />
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">
                          {result.totalErrors > result.errors.length
                            ? `Showing ${result.errors.length} of ${result.totalErrors} errors`
                            : `${result.errors.length} Error${result.errors.length !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <ScrollArea className="max-h-32">
                        <ul className="space-y-1">
                          {result.errors.map((err, idx) => (
                            <motion.li
                              key={idx}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              className="text-xs text-red-600 dark:text-red-400 bg-red-100/60 dark:bg-red-900/20 rounded px-2 py-1.5"
                            >
                              {err}
                            </motion.li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Validation Errors (phase === 'error' but from file validation, not upload) */}
            <AnimatePresence>
              {error && phase === 'error' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm flex items-start gap-2"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* CSV format hint */}
            {(phase === 'idle' || phase === 'error') && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3"
              >
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Required CSV format:
                </p>
                <code className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 block whitespace-pre-wrap">
                  firstName,lastName,dateOfBirth,phone,email,address,notes
                </code>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Only <span className="font-medium">firstName</span> and{' '}
                  <span className="font-medium">lastName</span> are required.
                  Maximum 1,000 rows per import.
                </p>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 pt-2 border-t border-gray-100 dark:border-gray-800 mt-2 -mx-6 px-6 pb-1">
          {phase === 'complete' ? (
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1 transition-all duration-200"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Another
              </Button>
              <Button
                onClick={handleClose}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/40 dark:shadow-emerald-900/30 transition-all duration-300"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Done
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isUploading}
                className="transition-all duration-200"
              >
                Cancel
              </Button>
              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={handleImport}
                  disabled={!file || isUploading}
                  className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/40 dark:shadow-emerald-900/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Import Patients
                    </>
                  )}
                </Button>
              </motion.div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
