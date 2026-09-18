'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type DocumentInfo, type PatientInfo } from '@/store/app-store'
import {
  formatFileSize,
  formatDateTime,
  formatAge,
  getPatientDisplayName,
  getCategoryColor,
} from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  ScanLine,
  Upload,
  Edit3,
  Loader2,
  Phone,
  Mail,
  Calendar,
  MapPin,
  StickyNote,
  FolderOpen,
  Filter,
  AlertTriangle,
  UserRoundX,
  CheckSquare,
  Square,
  ArrowUpDown,
  Archive,
  X,
  ArrowRight,
  Pill,
  FileBarChart,
  MessageSquare,
  Activity,
  Eye,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EditDocumentDialog } from './edit-document-dialog'
import { EditPatientDialog } from './edit-patient-dialog'
import { PatientHealthSummary } from './patient-health-summary'
import { VisitHistory } from './visit-history'
import { PrescriptionGenerator } from './prescription-generator'
import { PatientSummaryReport } from './patient-summary-report'
import { PrescriptionCard, type PrescriptionCardData } from './prescription-card'
import { ClinicalNotes } from './clinical-notes'
import { PatientTimeline } from './patient-timeline'
import { cn } from '@/lib/utils'
import JSZip from 'jszip'
import { useI18n } from '@/i18n'

interface PatientDetailProps {
  patient: PatientInfo
}

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'largest' | 'smallest'

const SORT_OPTIONS: { value: SortOption; labelKey: string }[] = [
  { value: 'newest', labelKey: 'patients.sort.newest' },
  { value: 'oldest', labelKey: 'patients.sort.oldest' },
  { value: 'name-asc', labelKey: 'patients.sort.nameAsc' },
  { value: 'name-desc', labelKey: 'patients.sort.nameDesc' },
  { value: 'largest', labelKey: 'patients.sort.largest' },
  { value: 'smallest', labelKey: 'patients.sort.smallest' },
]

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function isImageFile(mimeType: string): boolean {
  return IMAGE_TYPES.includes(mimeType)
}

// Category color map for start-side border bars (RTL-safe logical border)
function getCategoryBorderColor(category: string): string {
  const map: Record<string, string> = {
    'Lab Results': 'border-s-emerald-500',
    'Prescription': 'border-s-teal-500',
    'Imaging': 'border-s-amber-500',
    'Insurance': 'border-s-purple-500',
    'General': 'border-s-gray-400 dark:border-s-gray-500',
  }
  return map[category] || 'border-s-teal-500'
}

export function PatientDetail({ patient }: PatientDetailProps) {
  const { t, tCategory } = useI18n()
  const { toast } = useToast()
  const {
    selectDocument,
    goBack,
    setCurrentView,
    setScanTargetPatientId,
    clearPatient,
    updateSelectedPatient,
  } = useAppStore()
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editPatientDialogOpen, setEditPatientDialogOpen] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [deleteDocConfirm, setDeleteDocConfirm] = useState<DocumentInfo | null>(null)
  const [deletePatientConfirm, setDeletePatientConfirm] = useState(false)
  const [editingDoc, setEditingDoc] = useState<DocumentInfo | null>(null)
  const [deletingPatient, setDeletingPatient] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [annotationCounts, setAnnotationCounts] = useState<Record<string, number>>({})

  // Timeline state
  const [showTimeline, setShowTimeline] = useState(false)
  const [timelineCount, setTimelineCount] = useState(0)

  // Prescription state
  const [prescriptions, setPrescriptions] = useState<PrescriptionCardData[]>([])
  const [prescriptionsLoading, setPrescriptionsLoading] = useState(true)
  const [prescriptionGenOpen, setPrescriptionGenOpen] = useState(false)
  const [prescriptionVisitId, setPrescriptionVisitId] = useState<string | null>(null)

  // Load ALL documents (filtering/sorting done client-side)
  const loadDocuments = useCallback(async () => {
    try {
      const url = `/api/patients/${patient.id}/documents`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data)
      }
    } catch (err) {
      console.error('Failed to load documents:', err)
    }
    setLoading(false)
  }, [patient.id])

  useEffect(() => {
    setLoading(true)
    loadDocuments()
  }, [loadDocuments])

  // Refetch the patient record on mount: entry points can pass partial or
  // stale snapshots — the activity timeline and the overview cards construct
  // skeletons (all data fields null) and the recently-viewed cards carry
  // pre-edit snapshots; without this refetch the detail view renders
  // "No contact information added yet" for a patient who HAS data.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/patients/${patient.id}`, { credentials: 'include' })
        if (res.ok && !cancelled) {
          const fresh = (await res.json()) as PatientInfo
          updateSelectedPatient(fresh)
        }
      } catch {
        // the passed-in object remains the fallback
      }
    })()
    return () => { cancelled = true }
  }, [patient.id, updateSelectedPatient])

  // Load annotation counts for documents
  useEffect(() => {
    if (documents.length === 0) {
      setAnnotationCounts({})
      return
    }
    Promise.all(
      documents.map(async (doc) => {
        try {
          const res = await fetch(`/api/documents/${doc.id}/annotations`)
          if (res.ok) {
            const data = await res.json()
            return { id: doc.id, count: data.length }
          }
        } catch { /* ignore */ }
        return { id: doc.id, count: 0 }
      })
    ).then((results) => {
      const counts: Record<string, number> = {}
      for (const r of results) {
        counts[r.id] = r.count
      }
      setAnnotationCounts(counts)
    })
  }, [documents])

  // Load prescriptions
  const loadPrescriptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/prescriptions?patientId=${patient.id}`)
      if (res.ok) {
        const data = await res.json()
        setPrescriptions(data)
      }
    } catch {
      console.error('Failed to load prescriptions')
    }
    setPrescriptionsLoading(false)
  }, [patient.id])

  useEffect(() => {
    setPrescriptionsLoading(true)
    loadPrescriptions()
  }, [loadPrescriptions])

  // Load timeline count
  useEffect(() => {
    const fetchTimelineCount = async () => {
      try {
        const res = await fetch(`/api/patients/${patient.id}/timeline`)
        if (res.ok) {
          const data = await res.json()
          setTimelineCount(data.length)
        }
      } catch { /* ignore */ }
    }
    fetchTimelineCount()
  }, [patient.id])

  // Compute category counts from all documents
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: documents.length }
    for (const doc of documents) {
      counts[doc.category] = (counts[doc.category] || 0) + 1
    }
    return counts
  }, [documents])

  const allCategories = useMemo(
    () => ['All', ...new Set(documents.map((d) => d.category))],
    [documents],
  )

  // Filter and sort documents
  const filteredAndSortedDocuments = useMemo(() => {
    const filtered = categoryFilter === 'All'
      ? documents
      : documents.filter((d) => d.category === categoryFilter)

    const sorted = [...filtered]
    switch (sortBy) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())
        break
      case 'oldest':
        sorted.sort((a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime())
        break
      case 'name-asc':
        sorted.sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName))
        break
      case 'name-desc':
        sorted.sort((a, b) => (b.title || b.fileName).localeCompare(a.title || a.fileName))
        break
      case 'largest':
        sorted.sort((a, b) => b.fileSize - a.fileSize)
        break
      case 'smallest':
        sorted.sort((a, b) => a.fileSize - b.fileSize)
        break
    }
    return sorted
  }, [documents, categoryFilter, sortBy])

  // Reset selection when filter/sort changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [categoryFilter, sortBy])

  // Exit select mode when no documents match
  useEffect(() => {
    if (selectMode && filteredAndSortedDocuments.length === 0) {
      setSelectMode(false)
    }
  }, [selectMode, filteredAndSortedDocuments.length])

  const toggleDocumentSelection = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const allSelected = filteredAndSortedDocuments.length > 0
    && filteredAndSortedDocuments.every((d) => selectedIds.has(d.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAndSortedDocuments.map((d) => d.id)))
    }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleDeleteDocument = async (doc: DocumentInfo) => {
    setDeletingDocId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
        toast({ title: t('documents.docDeletedTitle'), description: t('documents.docDeletedDesc', { name: doc.title || doc.fileName }) })
      } else {
        toast({ title: t('documents.deleteFailedTitle'), variant: 'destructive' })
      }
    } catch {
      toast({ title: t('auth.toast.errorTitle'), description: t('errors.deleteDocFailed'), variant: 'destructive' })
    }
    setDeletingDocId(null)
    setDeleteDocConfirm(null)
  }

  const handleBatchDelete = async () => {
    setBatchDeleting(true)
    let deleted = 0
    for (const docId of selectedIds) {
      try {
        const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
        if (res.ok) deleted++
      } catch { /* skip */ }
    }
    if (deleted > 0) {
      setDocuments((prev) => prev.filter((d) => !selectedIds.has(d.id)))
      toast({ title: deleted === 1 ? t('documents.oneDeleted') : t('documents.batchDeleted', { count: deleted }) })
    }
    setBatchDeleting(false)
    setBatchDeleteConfirm(false)
    exitSelectMode()
  }

  const handleExportSelected = async () => {
    setExporting(true)
    try {
      const zip = new JSZip()
      const docsToExport = documents.filter((d) => selectedIds.has(d.id))

      await Promise.all(
        docsToExport.map(async (doc) => {
          const res = await fetch(`/api/documents/${doc.id}`)
          if (res.ok) {
            const blob = await res.blob()
            zip.file(doc.fileName, blob)
          }
        }),
      )

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${patient.firstName}_${patient.lastName}_documents.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({ title: t('documents.exportCompleteTitle'), description: docsToExport.length === 1 ? t('documents.oneExported') : t('documents.exportCompleteDesc', { count: docsToExport.length }) })
    } catch {
      toast({ title: t('documents.exportFailedTitle'), description: t('documents.exportFailedDesc'), variant: 'destructive' })
    }
    setExporting(false)
  }

  const handleDownloadDocument = async (doc: DocumentInfo) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: t('documents.downloadFailedTitle'), variant: 'destructive' })
    }
  }

  const handleEditPatientSaved = (updated: PatientInfo) => {
    updateSelectedPatient(updated)
  }

  const handleDeletePatient = async () => {
    setDeletingPatient(true)
    try {
      const res = await fetch(`/api/patients/${patient.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({
          title: t('patients.deletedTitle'),
          description: t('patients.deletedDesc', { name: getPatientDisplayName(patient) }),
        })
        clearPatient()
        goBack()
      } else {
        toast({ title: t('documents.deleteFailedTitle'), variant: 'destructive' })
      }
    } catch {
      toast({ title: t('auth.toast.errorTitle'), description: t('errors.deletePatientFailed'), variant: 'destructive' })
    }
    setDeletingPatient(false)
  }

  const handleScanDocument = () => {
    setScanTargetPatientId(patient.id)
    setCurrentView('scan-capture')
  }

  const handleUploadDocument = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff,.tif'
    input.multiple = true
    input.style.display = 'none'
    // BUG-PD20 (wave rounds 4+6, shard E): a DETACHED file input opens the
    // picker but WKWebView never delivers the selection to its onchange in
    // the Tauri build — the panel closed with the file chosen and ZERO
    // upload POSTs fired (two independent rounds), while the identical
    // automation on the scan view's ATTACHED #file-upload input worked
    // flawlessly. Attach the input before clicking (the proven pattern),
    // then clean it up.
    document.body.appendChild(input)
    const cleanup = () => { input.remove() }
    input.onchange = async () => {
      try {
        const files = input.files
        if (!files) return
        let uploaded = 0
        for (const file of files) {
          if (file.size > 50 * 1024 * 1024) {
            toast({ title: t('documents.fileTooLargeTitle'), description: t('documents.fileTooLargeDesc', { name: file.name }), variant: 'destructive' })
            continue
          }
          const formData = new FormData()
          formData.append('file', file)
          formData.append('category', 'General')
          formData.append('title', file.name.replace(/\.[^/.]+$/, ''))

          try {
            const res = await fetch(`/api/patients/${patient.id}/documents`,  { credentials: 'include',
              method: 'POST',
              body: formData,
            })
            if (res.ok) uploaded++
            else if (res.status === 413) {
              toast({ title: t('documents.fileTooLargeTitle'), description: t('documents.fileTooLargeDesc', { name: file.name }), variant: 'destructive' })
            }
          } catch { /* skip */ }
        }
        loadDocuments()
        if (uploaded > 0) {
          toast({ title: uploaded === 1 ? t('documents.oneUploaded') : t('documents.uploadedCount', { count: uploaded }) })
        }
      } finally {
        cleanup()
      }
    }
    input.click()
  }

  return (
    <motion.div
      className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6 pb-28"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Patient Header with Mesh Gradient Background */}
      <motion.div
        data-qa="patient-detail-header"
        className="relative rounded-2xl overflow-hidden patient-header-mesh p-5 sm:p-6 text-white shadow-lg shadow-emerald-200/40 dark:shadow-emerald-900/30"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Animated decorative elements */}
        <motion.div
          className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-24 translate-x-16"
          animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.15, 0.1] }}
          transition={{ type: 'tween', duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-0 left-[30%] w-32 h-32 bg-white/5 rounded-full translate-y-16"
          animate={{ scale: [1, 1.15, 1], opacity: [0.05, 0.1, 0.05] }}
          transition={{ type: 'tween', duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
        {/* Subtle heartbeat line overlay */}
        <svg className="absolute bottom-2 left-0 right-0 w-full h-6 opacity-10 pointer-events-none" preserveAspectRatio="none" viewBox="0 0 400 20">
          <motion.path
            d="M0 10 L80 10 L100 3 L120 17 L140 5 L160 15 L180 10 L400 10"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2, delay: 0.5 }}
          />
        </svg>

        <div className="relative z-10 flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            className="mt-1 flex-shrink-0 text-white/80 hover:text-white hover:bg-white/20 btn-press"
          >
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 flex-wrap">
              <motion.div
                className="w-[68px] h-[68px] rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0 avatar-gradient-ring"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                whileHover={{ scale: 1.05 }}
              >
                <div className="w-[60px] h-[60px] rounded-full bg-gradient-to-br from-emerald-400/80 to-teal-500/80 flex items-center justify-center">
                  <span className="text-white font-bold text-2xl drop-shadow-sm">
                    {patient.firstName[0]}{patient.lastName[0]}
                  </span>
                </div>
              </motion.div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-gradient-white">
                  {getPatientDisplayName(patient)}
                </h1>
                <div className="flex items-center gap-4 mt-1 flex-wrap text-sm text-white/70">
                  {patient.phone && (
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{patient.phone}</span>
                  )}
                  {patient.email && (
                    <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{patient.email}</span>
                  )}
                  {patient.dateOfBirth && (
                    <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{t('patients.dob')}: {patient.dateOfBirth} <Badge variant="secondary" className="text-xs font-normal bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 ms-1">{formatAge(patient.dateOfBirth)}</Badge></span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <Button
              data-qa="patient-detail-report"
              variant="ghost"
              size="icon"
              onClick={() => setReportOpen(true)}
              title={t('patients.generateReport')}
              className="text-white/80 hover:text-white hover:bg-white/20 btn-press"
            >
              <FileBarChart className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditPatientDialogOpen(true)}
              title={t('patients.editPatient')}
              className="text-white/80 hover:text-white hover:bg-white/20 btn-press"
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-red-200 hover:bg-red-500/20 btn-press"
              onClick={() => setDeletePatientConfirm(true)}
              title={t('patients.deletePatient')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Patient Info - Glass Morphism Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {patient.phone && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ y: -2 }}
          >
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-2">
                <Phone className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-xs text-muted-foreground mb-0.5">{t('patients.phone')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{patient.phone}</p>
            </div>
          </motion.div>
        )}
        {patient.email && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            whileHover={{ y: -2 }}
          >
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center mx-auto mb-2">
                <Mail className="h-4 w-4 text-teal-600" />
              </div>
              <p className="text-xs text-muted-foreground mb-0.5">{t('patients.email')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{patient.email}</p>
            </div>
          </motion.div>
        )}
        {patient.dateOfBirth && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileHover={{ y: -2 }}
          >
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-2">
                <Calendar className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-xs text-muted-foreground mb-0.5">{t('patients.ageDob')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatAge(patient.dateOfBirth)}</p>
              <p className="text-[10px] text-muted-foreground">{patient.dateOfBirth}</p>
            </div>
          </motion.div>
        )}
        {patient.address && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            whileHover={{ y: -2 }}
          >
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center mx-auto mb-2">
                <MapPin className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-xs text-muted-foreground mb-0.5">{t('patients.address')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{patient.address}</p>
            </div>
          </motion.div>
        )}
        {patient.notes && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            whileHover={{ y: -2 }}
            className="sm:col-span-2 lg:col-span-4"
          >
            <div className="glass-card rounded-xl p-3">
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                  <StickyNote className="h-4 w-4 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('patients.notes')}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{patient.notes}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {!(patient.phone || patient.email || patient.dateOfBirth || patient.address || patient.notes) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="sm:col-span-2 lg:col-span-4"
          >
            <div className="glass-card rounded-xl p-6 text-center">
              <p className="text-sm text-muted-foreground">{t('patients.noContact')}</p>
              <Button variant="link" size="sm" className="mt-1 text-emerald-600" onClick={() => setEditPatientDialogOpen(true)}>
                <Edit3 className="h-3.5 w-3.5 me-1" />
                {t('patients.addDetails')}
              </Button>
            </div>
          </motion.div>
        )}
      </div>


      {/* Patient Health Summary */}
      {!loading && <PatientHealthSummary patient={patient} documents={documents} />}

      {/* Visit History */}
      <Card data-qa="patient-detail-visits" className="card-hover-lift-enhanced">
        <CardContent className="p-4">
          <VisitHistory
            patientId={patient.id}
            patientName={getPatientDisplayName(patient)}
            onCreatePrescription={(visitId) => {
              setPrescriptionVisitId(visitId)
              setPrescriptionGenOpen(true)
            }}
          />
        </CardContent>
      </Card>

      {/* Patient Timeline Toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTimeline((prev) => !prev)}
          className={cn(
            'border transition-all duration-300',
            showTimeline
              ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600'
          )}
        >
          <Activity className="h-3.5 w-3.5 me-1.5" />
          {t('patients.timeline')}
          {timelineCount > 0 && (
            <Badge variant="secondary" className="ms-1.5 text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400">
              {timelineCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Patient Timeline */}
      <AnimatePresence>
        {showTimeline && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <Card className="card-hover-lift-enhanced">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('patients.patientTimeline')}</h3>
                </div>
                <PatientTimeline patientId={patient.id} />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prescriptions */}
      <Card data-qa="patient-detail-prescriptions" className="card-hover-lift-enhanced">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Pill className="h-4 w-4 text-emerald-600" />
              {t('prescriptions.title')}
              <Badge variant="secondary" className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                {prescriptions.length}
              </Badge>
            </h3>
            <Button
              size="sm"
              onClick={() => { setPrescriptionVisitId(null); setPrescriptionGenOpen(true) }}
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
            >
              <Pill className="h-3.5 w-3.5 me-1.5" />
              {t('prescriptions.new')}
            </Button>
          </div>
          {prescriptionsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
          ) : prescriptions.length === 0 ? (
            <div className="text-center py-8">
              <motion.div
                className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mx-auto mb-3"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ type: 'tween', duration: 3, repeat: Infinity }}
              >
                <Pill className="h-7 w-7 text-emerald-400" />
              </motion.div>
              <p className="text-sm text-muted-foreground">{t('prescriptions.empty')}</p>
              <Button
                variant="link"
                size="sm"
                className="text-emerald-600"
                onClick={() => { setPrescriptionVisitId(null); setPrescriptionGenOpen(true) }}
              >
                {t('prescriptions.createFirst')}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 max-h-96 overflow-y-auto">
              <AnimatePresence>
                {prescriptions.map((rx) => (
                  <PrescriptionCard
                    key={rx.id}
                    prescription={rx}
                    onStatusChange={(id, status) => {
                      setPrescriptions((prev) =>
                        prev.map((p) => (p.id === id ? { ...p, status } : p))
                      )
                    }}
                    onDelete={(id) => {
                      setPrescriptions((prev) => prev.filter((p) => p.id !== id))
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clinical Notes */}
      <Card data-qa="patient-detail-clinical-notes" className="card-hover-lift-enhanced">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <StickyNote className="h-4 w-4 text-emerald-600" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('clinical.title')}</h3>
          </div>
          <ClinicalNotes patientId={patient.id} />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button data-qa="patient-detail-upload" onClick={handleUploadDocument} className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20 group">
            <Upload className="h-4 w-4 me-2 transition-transform group-hover:rotate-180 duration-300" />
            {t('documents.uploadFiles')}
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button variant="outline" onClick={handleScanDocument} className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 group">
            <ScanLine className="h-4 w-4 me-2 transition-transform group-hover:rotate-180 duration-300" />
            {t('documents.scanWithCamera')}
          </Button>
        </motion.div>
        <AnimatePresence>
          {documents.length > 0 && !selectMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectMode(true)}
                className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
              >
                <CheckSquare className="h-4 w-4 me-1.5" />
                {t('common.select')}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Category Filter Pills + Sort Dropdown */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex gap-1.5 flex-wrap">
            <AnimatePresence mode="popLayout">
              {allCategories.map((cat) => {
                const count = categoryCounts[cat] || 0
                const isActive = categoryFilter === cat
                return (
                  <motion.div
                    key={cat}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      className={`rounded-full transition-all duration-300 gap-1.5 ${
                        isActive
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-sm shadow-emerald-200/30 dark:shadow-emerald-900/20'
                          : 'hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600'
                      }`}
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat === 'All' ? t('documents.allCategories') : tCategory(cat)}
                      <span className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {count}
                      </span>
                    </Button>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Sort and Document Count Row */}
        <div data-qa="patient-detail-documents" className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('documents.count', { count: filteredAndSortedDocuments.length })}
          </h2>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger
                size="sm"
                className="w-[160px] border-emerald-200 dark:border-emerald-800 focus:ring-emerald-500/20 focus:border-emerald-400"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Documents */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : filteredAndSortedDocuments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-dashed border-2 border-gray-300 dark:border-gray-700">
              <CardContent className="flex flex-col items-center justify-center py-16">
                {/* Animated document illustration */}
                <motion.div
                  className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mb-4 relative"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <FolderOpen className="h-10 w-10 text-emerald-400" />
                  {/* Animated arrow pointing up */}
                  <motion.div
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shadow-md"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ type: 'tween', duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <ArrowRight className="h-3.5 w-3.5 text-white -rotate-45" />
                  </motion.div>
                </motion.div>
                <h3 className="text-lg font-medium text-muted-foreground">{t('documents.noDocumentsYet')}</h3>
                <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
                  {t('documents.uploadOrScan')}
                </p>
                <div className="flex gap-2 mt-4">
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button onClick={handleUploadDocument} className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white">
                      <Upload className="h-4 w-4 me-2" />
                      {t('documents.uploadFirst')}
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button variant="outline" onClick={handleScanDocument} className="border-emerald-200 dark:border-emerald-800 text-emerald-600">
                      <ScanLine className="h-4 w-4 me-2" />
                      {t('nav.scan')}
                    </Button>
                  </motion.div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence>
              {filteredAndSortedDocuments.map((doc, index) => {
                const isSelected = selectedIds.has(doc.id)
                const isImg = isImageFile(doc.mimeType)
                return (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20, height: 0 }}
                    transition={{ duration: 0.25, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    layout
                  >
                    <Card
                      className={`group relative border-s-[3px] ${getCategoryBorderColor(doc.category)} hover:shadow-md transition-all duration-200 card-hover-lift ${
                        isSelected
                          ? 'ring-2 ring-emerald-500 border-s-emerald-500'
                          : ''
                      }`}
                    >
                      {/* File type icon badge - top end */}
                      <div className="absolute top-2 end-2 z-10">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shadow-sm ${
                          isImg
                            ? 'bg-gradient-to-br from-sky-400 to-sky-500'
                            : doc.mimeType === 'application/pdf'
                              ? 'bg-gradient-to-br from-rose-400 to-rose-500'
                              : 'bg-gradient-to-br from-gray-400 to-gray-500'
                        }`}>
                          {isImg ? (
                            <ImageIcon className="h-3.5 w-3.5 text-white" />
                          ) : doc.mimeType === 'application/pdf' ? (
                            <FileText className="h-3.5 w-3.5 text-white" />
                          ) : (
                            <ImageIcon className="h-3.5 w-3.5 text-white" />
                          )}
                        </div>
                      </div>
                      {/* Quick-view overlay on hover */}
                      <div className="doc-hover-overlay rounded-lg">
                        <Eye className="h-5 w-5 text-white" />
                        <span className="text-[10px] text-white font-medium">{t('documents.quickView')}</span>
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3 sm:gap-4">
                          {/* Checkbox in select mode */}
                          <AnimatePresence>
                            {selectMode && (
                              <motion.div
                                initial={{ opacity: 0, width: 0, scale: 0.5 }}
                                animate={{ opacity: 1, width: 'auto', scale: 1 }}
                                exit={{ opacity: 0, width: 0, scale: 0.5 }}
                                transition={{ duration: 0.2 }}
                                className="flex-shrink-0 overflow-hidden"
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleDocumentSelection(doc.id)}
                                  className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 h-5 w-5 rounded"
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <button
                            onClick={() => selectDocument(doc)}
                            className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 text-start"
                          >
                            {/* Thumbnail or Icon with zoom on hover */}
                            <motion.div
                              className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/30 dark:to-emerald-900/30 flex items-center justify-center flex-shrink-0 doc-thumb-zoom overflow-hidden"
                              whileHover={{ scale: 1.08 }}
                            >
                              {isImg ? (
                                <img
                                  src={`/api/documents/${doc.id}/view`}
                                  alt={doc.title || doc.fileName}
                                  className="w-full h-full object-cover rounded-lg"
                                  loading="lazy"
                                />
                              ) : doc.mimeType === 'application/pdf' ? (
                                <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" />
                              ) : (
                                <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" />
                              )}
                            </motion.div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900 dark:text-white truncate text-sm sm:text-base">
                                {doc.title || doc.fileName}
                              </p>
                              <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
                                <Badge className={`text-xs rounded-full bg-gradient-to-r ${
                                  doc.category === 'Lab Results' ? 'from-emerald-100 to-emerald-50 dark:from-emerald-900 dark:to-emerald-950/50 text-emerald-700 dark:text-emerald-300' :
                                  doc.category === 'Prescription' ? 'from-amber-100 to-amber-50 dark:from-amber-900 dark:to-amber-950/50 text-amber-700 dark:text-amber-300' :
                                  doc.category === 'Imaging' ? 'from-sky-100 to-sky-50 dark:from-sky-900 dark:to-sky-950/50 text-sky-700 dark:text-sky-300' :
                                  doc.category === 'X-Ray' ? 'from-purple-100 to-purple-50 dark:from-purple-900 dark:to-purple-950/50 text-purple-700 dark:text-purple-300' :
                                  doc.category === 'MRI/CT' ? 'from-indigo-100 to-indigo-50 dark:from-indigo-900 dark:to-indigo-950/50 text-indigo-700 dark:text-indigo-300' :
                                  doc.category === 'Referral' ? 'from-rose-100 to-rose-50 dark:from-rose-900 dark:to-rose-950/50 text-rose-700 dark:text-rose-300' :
                                  doc.category === 'Insurance' ? 'from-teal-100 to-teal-50 dark:from-teal-900 dark:to-teal-950/50 text-teal-700 dark:text-teal-300' :
                                  'from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900/50 text-gray-700 dark:text-gray-300'
                                }`}>
                                  {tCategory(doc.category)}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
                                <span className="text-xs text-muted-foreground hidden sm:inline">{formatDateTime(doc.scannedAt)}</span>
                              </div>
                              {/* File size visual bar */}
                              <div className="file-size-bar mt-1.5">
                                <motion.div
                                  className="file-size-bar-fill"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min((doc.fileSize / (10 * 1024 * 1024)) * 100, 100)}%` }}
                                  transition={{ duration: 0.6, delay: index * 0.04 }}
                                />
                              </div>
                            </div>
                          </button>
                          {/* Action buttons */}
                          <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                              onClick={() => setEditingDoc(doc)}
                              title={t('documents.editDocument')}
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                              onClick={() => handleDownloadDocument(doc)}
                              title={t('documents.download')}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                              onClick={() => setDeleteDocConfirm(doc)}
                              disabled={deletingDocId === doc.id}
                              title={t('common.delete')}
                            >
                              {deletingDocId === doc.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete Document Confirmation */}
      <Dialog open={!!deleteDocConfirm} onOpenChange={() => setDeleteDocConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              {t('documents.deleteDocument')}
            </DialogTitle>
            <DialogDescription>
              {t('documents.deleteConfirm', { name: deleteDocConfirm?.title || deleteDocConfirm?.fileName || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteDocConfirm && handleDeleteDocument(deleteDocConfirm)}
              disabled={!!deletingDocId}
            >
              {deletingDocId ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Confirmation */}
      <Dialog open={batchDeleteConfirm} onOpenChange={setBatchDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              {t('documents.deleteSelectedTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('documents.deleteSelectedConfirm', { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              {t('documents.deleteCountAction', { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Patient Confirmation */}
      <Dialog open={deletePatientConfirm} onOpenChange={setDeletePatientConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <UserRoundX className="h-5 w-5" />
              {t('patients.deletePatient')}
            </DialogTitle>
            <DialogDescription>
              {t('patients.deleteConfirmPrefix')} <strong>{getPatientDisplayName(patient)}</strong> {t('patients.deleteConfirmSuffix', { count: documents.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePatientConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={handleDeletePatient}
              disabled={deletingPatient}
            >
              {deletingPatient ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              {t('patients.deleteAllAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Document Dialog */}
      <EditDocumentDialog
        document={editingDoc}
        open={!!editingDoc}
        onOpenChange={(open) => { if (!open) setEditingDoc(null) }}
        onSaved={(updated) => {
          setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
          setEditingDoc(null)
        }}
      />

      {/* Edit Patient Dialog */}
      <EditPatientDialog
        patient={patient}
        open={editPatientDialogOpen}
        onOpenChange={setEditPatientDialogOpen}
        onSaved={handleEditPatientSaved}
      />

      {/* Prescription Generator Dialog */}
      <PrescriptionGenerator
        open={prescriptionGenOpen}
        onOpenChange={(open) => {
          setPrescriptionGenOpen(open)
          if (!open) setPrescriptionVisitId(null)
        }}
        patientId={patient.id}
        patientName={getPatientDisplayName(patient)}
        visitId={prescriptionVisitId}
        onSaved={() => loadPrescriptions()}
      />

      {/* Patient Summary Report Dialog */}
      <PatientSummaryReport
        patient={patient}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />

      {/* Floating Batch Action Bar */}
      <AnimatePresence>
        {selectMode && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-40 md:left-1/2 md:-translate-x-1/2 md:max-w-2xl md:px-6"
          >
            <div className="mx-3 mb-3 md:mx-0 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-2xl shadow-emerald-900/10 dark:shadow-emerald-500/5 backdrop-blur-lg px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={exitSelectMode}
                    className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4 me-1" />
                    {t('common.close')}
                  </Button>
                  <div className="h-4 w-px bg-border flex-shrink-0" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="flex-shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  >
                    {allSelected ? (
                      <Square className="h-4 w-4 me-1.5" />
                    ) : (
                      <CheckSquare className="h-4 w-4 me-1.5" />
                    )}
                    {allSelected ? t('common.deselectAll') : t('common.selectAll')}
                  </Button>
                  <Badge
                    variant="secondary"
                    className={`rounded-full text-xs flex-shrink-0 ${
                      selectedIds.size > 0
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                        : ''
                    }`}
                  >
                    {t('documents.selectedCount', { count: selectedIds.size })}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportSelected}
                    disabled={selectedIds.size === 0 || exporting}
                    className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin me-1.5" />
                    ) : (
                      <Archive className="h-4 w-4 me-1.5" />
                    )}
                    <span className="hidden sm:inline">{t('common.export')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setBatchDeleteConfirm(true)}
                    disabled={selectedIds.size === 0}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    <Trash2 className="h-4 w-4 me-1.5" />
                    <span className="hidden sm:inline">{t('common.delete')}</span>
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
