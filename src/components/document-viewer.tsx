'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type DocumentInfo } from '@/store/app-store'
import { formatFileSize, formatDateTime, getCategoryColor, getPatientDisplayName } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Download,
 FileText,
 Printer,
 Maximize2,
  Minimize2,
 User,
 ChevronLeft,
 FileSearch,
 ZoomIn,
 ZoomOut,
 Info,
 Calendar,
 HardDrive,
 Tag,
 RotateCcw,
 MessageSquare,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { DocumentAnnotations } from './document-annotations'

interface DocumentViewerProps {
  document: DocumentInfo
}

export function DocumentViewer({ document: doc }: DocumentViewerProps) {
  const { toast } = useToast()
  const { goBack, selectedPatient, selectPatient } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [infoOpen, setInfoOpen] = useState(false)
  const [annotationsOpen, setAnnotationsOpen] = useState(false)

  const viewUrl = `/api/documents/${doc.id}/view`

  useEffect(() => {
    setLoading(true)
    setZoom(1)
  }, [doc.id])

  const handleDownload = async () => {
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
      toast({ title: 'Download Started', description: `"${doc.fileName}" is being downloaded.` })
    } catch {
      toast({ title: 'Download Failed', variant: 'destructive' })
    }
  }

  const handlePrint = () => {
    const printWindow = window.open(viewUrl, '_blank')
    if (printWindow) { printWindow.onload = () => { printWindow.print() } }
  }

  const handleBackToPatient = () => {
    if (selectedPatient && selectedPatient.id === doc.patientId) { goBack() }
    else if (doc.patient) { selectPatient({ id: doc.patient.id, firstName: doc.patient.firstName, lastName: doc.patient.lastName, doctorId: '', dateOfBirth: null, phone: null, email: null, address: null, notes: null, createdAt: '', updatedAt: '' }) }
    else { goBack() }
  }

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 3)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.25)), [])
  const resetZoom = useCallback(() => setZoom(1), [])

  return (
    <motion.div
      className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-gray-950' : 'max-w-5xl mx-auto px-4 md:px-6 py-6'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Fullscreen glass-morphism toolbar */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="absolute top-0 left-0 right-0 z-20 glass-strong"
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={handleBackToPatient} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20"><ArrowLeft className="h-4 w-4" /></Button>
                <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
                <h1 className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px] sm:max-w-md">{doc.title || doc.fileName}</h1>
              </div>
              <div className="flex items-center gap-1">
                <AnimatePresence>
                  {zoom !== 1 && (
                    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                      <Button variant="ghost" size="sm" onClick={resetZoom} className="text-xs tabular-nums h-7 px-2 text-emerald-600"><RotateCcw className="h-3 w-3 mr-1" />{Math.round(zoom * 100)}%</Button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <Button variant="ghost" size="icon" onClick={zoomOut} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" disabled={zoom <= 0.25}><ZoomOut className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={zoomIn} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" disabled={zoom >= 3}><ZoomIn className="h-4 w-4" /></Button>
                <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
                <Button variant="ghost" size="icon" onClick={handleDownload} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" title="Download"><Download className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={handlePrint} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" title="Print"><Printer className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setInfoOpen(!infoOpen)} className={`hover:bg-emerald-50 dark:hover:bg-emerald-950/20 ${infoOpen ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600' : ''}`} title="Info"><Info className="h-4 w-4" /></Button>
                <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
                <Button variant="ghost" size="icon" onClick={() => setAnnotationsOpen(!annotationsOpen)} className={`hover:bg-emerald-50 dark:hover:bg-emerald-950/20 ${annotationsOpen ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600' : ''}`} title="Annotations"><MessageSquare className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setFullscreen(false)} title="Exit Fullscreen" className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20"><Minimize2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info sidebar overlay in fullscreen */}
      <AnimatePresence>
        {fullscreen && infoOpen && (
          <motion.div
            className="absolute top-14 right-0 z-10 w-72 glass-strong border-l border-gray-200/50 dark:border-gray-700/50"
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            <div className="p-4 space-y-4">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white flex items-center gap-2"><Info className="h-4 w-4 text-emerald-600" />Document Info</h3>
              <div className="space-y-3">
                {[
                  { icon: FileText, label: 'Name', value: doc.title || doc.fileName },
                  { icon: Tag, label: 'Category', value: doc.category, badge: true },
                  { icon: HardDrive, label: 'Size', value: formatFileSize(doc.fileSize) },
                  { icon: Calendar, label: 'Scanned', value: formatDateTime(doc.scannedAt) },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-2.5">
                    <item.icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                      {item.badge ? (
                        <Badge className={`text-xs rounded-full mt-0.5 ${getCategoryColor(item.value)}`}>{item.value}</Badge>
                      ) : (
                        <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{item.value}</p>
                      )}
                    </div>
                  </div>
                ))}
                {doc.patient && (
                  <div className="flex items-start gap-2.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div><p className="text-[11px] text-muted-foreground uppercase tracking-wider">Patient</p><p className="text-sm font-medium text-gray-900 dark:text-white">{getPatientDisplayName(doc.patient)}</p></div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header (non-fullscreen) */}
      {!fullscreen && (
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={goBack} className="flex-shrink-0 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"><ChevronLeft className="h-5 w-5" /></Button></motion.div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{doc.title || doc.fileName}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge className={`text-xs rounded-full ${getCategoryColor(doc.category)}`}>{doc.category}</Badge>
              <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(doc.scannedAt)}</span>
            </div>
            {doc.patient && (
              <motion.button onClick={handleBackToPatient} className="flex items-center gap-1.5 mt-1 group" whileHover={{ x: 2 }}>
                <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center"><User className="h-3 w-3 text-emerald-600" /></div>
                <span className="text-xs text-muted-foreground group-hover:text-emerald-600 transition-colors">{getPatientDisplayName(doc.patient)}</span>
              </motion.button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <AnimatePresence>
              {zoom !== 1 && (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Button variant="ghost" size="sm" onClick={resetZoom} className="text-xs tabular-nums h-7 px-2 text-emerald-600"><RotateCcw className="h-3 w-3 mr-1" />{Math.round(zoom * 100)}%</Button>
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={zoomOut} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" disabled={zoom <= 0.25}><ZoomOut className="h-4 w-4" /></Button></motion.div>
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={zoomIn} className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20" disabled={zoom >= 3}><ZoomIn className="h-4 w-4" /></Button></motion.div>
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={handleDownload} title="Download" className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-600"><Download className="h-4 w-4" /></Button></motion.div>
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={handlePrint} title="Print" className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-600"><Printer className="h-4 w-4" /></Button></motion.div>
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}><Button variant="ghost" size="icon" onClick={() => setFullscreen(true)} title="Fullscreen" className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-600"><Maximize2 className="h-4 w-4" /></Button></motion.div>
          </div>
        </div>
      )}

      {/* Document Content */}
      <div className="flex-1 bg-gray-100 dark:bg-gray-900 rounded-2xl overflow-hidden min-h-[60vh] relative border border-gray-200/80 dark:border-gray-700/80 shadow-xl shadow-gray-200/50 dark:shadow-gray-900/50">
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading-skeleton"
              className="absolute inset-0 z-10 bg-white dark:bg-gray-900"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex flex-col items-center justify-center h-full p-8">
                <motion.div
                  className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mb-6"
                  animate={{ scale: [1, 1.05, 1], rotate: [0, 2, -2, 0] }}
                  transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {doc.mimeType === 'application/pdf' ? <FileSearch className="h-10 w-10 text-emerald-500" /> : <FileText className="h-10 w-10 text-emerald-500" />}
                </motion.div>
                <div className="w-full max-w-md space-y-4">
                  <div className="skeleton-shimmer h-5 rounded-md w-3/4" />
                  <div className="skeleton-shimmer h-5 rounded-md w-full" />
                  <div className="skeleton-shimmer h-5 rounded-md w-5/6" />
                  <div className="mt-6 space-y-3">
                    <div className="skeleton-shimmer h-4 rounded-md w-full" />
                    <div className="skeleton-shimmer h-4 rounded-md w-2/3" />
                    <div className="skeleton-shimmer h-4 rounded-md w-4/5" />
                    <div className="skeleton-shimmer h-4 rounded-md w-full" />
                    <div className="skeleton-shimmer h-4 rounded-md w-1/2" />
                  </div>
                  <div className="mt-6 space-y-3">
                    <div className="skeleton-shimmer h-4 rounded-md w-full" />
                    <div className="skeleton-shimmer h-4 rounded-md w-3/4" />
                    <div className="skeleton-shimmer h-4 rounded-md w-5/6" />
                  </div>
                </div>
                <motion.p
                  className="mt-8 text-sm text-muted-foreground font-medium"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ type: 'tween', duration: 1.5, repeat: Infinity }}
                >
                  Loading document...
                </motion.p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {doc.mimeType === 'application/pdf' ? (
          <div className="w-full h-full min-h-[70vh] relative">
            <iframe src={viewUrl} className="w-full h-full min-h-[70vh] border-0" title={doc.title || doc.fileName} onLoad={() => setLoading(false)} />
            {fullscreen && !loading && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 glass rounded-full px-3 py-1.5 flex items-center gap-2 pointer-events-none">
                <FileSearch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">PDF Document</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full min-h-[60vh] p-4 overflow-auto">
            <motion.img src={viewUrl} alt={doc.title || doc.fileName} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg smooth-zoom" style={{ transform: `scale(${zoom})` }} onLoad={() => setLoading(false)} />
          </div>
        )}

        {/* Dark mode edge gradients */}
        <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-gray-100/50 to-transparent dark:from-gray-900/80 dark:to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-100/50 to-transparent dark:from-gray-900/80 dark:to-transparent pointer-events-none" />

        {/* Annotations side panel (fullscreen only) */}
        <AnimatePresence>
          {fullscreen && annotationsOpen && (
            <motion.div
              className="absolute top-14 left-0 z-10 w-80 glass-strong border-r border-gray-200/50 dark:border-gray-700/50 overflow-y-auto"
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="p-4">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                  Annotations
                </h3>
                <DocumentAnnotations documentId={doc.id} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
