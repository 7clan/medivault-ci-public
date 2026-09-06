'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type PatientInfo } from '@/store/app-store'
import { DOCUMENT_CATEGORIES } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Camera,
  Upload,
  FileUp,
  Loader2,
  X,
  Image as ImageIcon,
  Aperture,
  SwitchCamera,
  ScanLine,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

export function ScanCapture() {
  const { toast } = useToast()
  const { goBack, scanTargetPatientId, setCurrentView } = useAppStore()
  const [patients, setPatients] = useState<PatientInfo[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState(scanTargetPatientId || '')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('General')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [capturedImages, setCapturedImages] = useState<File[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment')
  const [isDragging, setIsDragging] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const [recentlyScanned, setRecentlyScanned] = useState<{name: string; time: string}[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('medivault-recently-scanned')
      if (stored) return JSON.parse(stored)
    } catch { /* ignore */ }
    return []
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (scanTargetPatientId) {
        setSelectedPatientId(scanTargetPatientId)
        return
      }
      try {
        const res = await fetch('/api/patients?limit=100', { credentials: 'include' })
        if (res.ok && mounted) {
          const data = await res.json()
          setPatients(data.patients)
        }
      } catch (err) {
        console.error('Failed to load patients:', err)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream }
      setCameraActive(true)
    } catch (err) {
      console.error('Camera error:', err)
      toast({ title: 'Camera Access Denied', description: 'Please allow camera access to scan documents.', variant: 'destructive' })
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    setFlashActive(true)
    setTimeout(() => setFlashActive(false), 400)
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' })
          setCapturedImages((prev) => [...prev, file])
          setUploadedFiles((prev) => [...prev, file])
          toast({ title: 'Captured!', description: 'Document page captured.' })
          const newEntry = { name: `Scan ${new Date().toLocaleTimeString()}`, time: new Date().toISOString() }
          setRecentlyScanned((prev) => {
            const updated = [newEntry, ...prev].slice(0, 5)
            try { localStorage.setItem('medivault-recently-scanned', JSON.stringify(updated)) } catch { /* ignore */ }
            return updated
          })
        }
      },
      'image/jpeg',
      0.95
    )
  }

  const toggleCamera = () => {
    setCameraFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
    if (cameraActive) { stopCamera(); setTimeout(() => startCamera(), 300) }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const MAX_FILE_SIZE = 50 * 1024 * 1024
    const newFiles = Array.from(files)
    const oversized = newFiles.filter(f => f.size > MAX_FILE_SIZE)
    if (oversized.length > 0) {
      toast({ title: 'File Too Large', description: `${oversized.map(f => f.name).join(', ')} exceed the 50 MiB upload limit.`, variant: 'destructive' })
    }
    setUploadedFiles((prev) => [...prev, ...newFiles.filter(f => f.size <= MAX_FILE_SIZE)])
    if (!title && newFiles.length === 1) { setTitle(newFiles[0].name.replace(/\.[^/.]+$/, '')) }
    newFiles.forEach((f) => {
      const newEntry = { name: f.name, time: new Date().toISOString() }
      setRecentlyScanned((prev) => {
        const updated = [newEntry, ...prev].slice(0, 5)
        try { localStorage.setItem('medivault-recently-scanned', JSON.stringify(updated)) } catch { /* ignore */ }
        return updated
      })
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const MAX_FILE_SIZE = 50 * 1024 * 1024
    const files = Array.from(e.dataTransfer.files)
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE)
    if (oversized.length > 0) {
      toast({ title: 'File Too Large', description: `${oversized.map(f => f.name).join(', ')} exceed the 50 MiB upload limit.`, variant: 'destructive' })
    }
    setUploadedFiles((prev) => [...prev, ...files.filter(f => f.size <= MAX_FILE_SIZE)])
    if (!title && files.length === 1) { setTitle(files[0].name.replace(/\.[^/.]+$/, '')) }
  }

  const removeFile = (index: number) => { setUploadedFiles((prev) => prev.filter((_, i) => i !== index)) }

  const handleUpload = async () => {
    if (!selectedPatientId) { toast({ title: 'Select Patient', description: 'Please select a patient first.', variant: 'destructive' }); return }
    if (uploadedFiles.length === 0) { toast({ title: 'No Files', description: 'Please capture or upload at least one file.', variant: 'destructive' }); return }
    setUploading(true)
    let successCount = 0
    let failCount = 0
    for (const file of uploadedFiles) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title || file.name.replace(/\.[^/.]+$/, ''))
      formData.append('category', category)
      formData.append('notes', notes)
      try {
        const res = await fetch(`/api/patients/${selectedPatientId}/documents`, { method: 'POST', body: formData, credentials: 'include' })
        if (res.ok) {
          successCount++
        } else {
          failCount++
          if (res.status === 413) {
            toast({ title: 'File Too Large', description: `${file.name} exceeds the 50 MiB upload limit.`, variant: 'destructive' })
          }
        }
      } catch { failCount++ }
    }
    stopCamera()
    setUploading(false)
    if (failCount === 0) {
      toast({ title: 'Upload Complete!', description: `${successCount} document${successCount > 1 ? 's' : ''} saved successfully.` })
      goBack()
    } else {
      toast({ title: 'Partial Upload', description: `${successCount} succeeded, ${failCount} failed.`, variant: 'destructive' })
    }
  }

  const totalSize = uploadedFiles.reduce((sum, f) => sum + f.size, 0)

  return (
    <motion.div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      {/* Header with scanned count badge */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { stopCamera(); goBack() }}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Scan & Upload</h1>
            <AnimatePresence>
              {uploadedFiles.length > 0 && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }} key={uploadedFiles.length}>
                  <Badge className="bg-emerald-500 text-white border-0 shadow-sm">
                    <ScanLine className="h-3 w-3 mr-1" />
                    <motion.span key={`count-${uploadedFiles.length}`} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="tabular-nums">{uploadedFiles.length}</motion.span>
                  </Badge>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="text-sm text-muted-foreground">Capture or upload documents for a patient</p>
        </div>
      </div>

      {/* Patient Selection */}
      {!scanTargetPatientId && (
        <motion.div className="space-y-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Label>Select Patient *</Label>
          <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
            <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"><SelectValue placeholder="Choose a patient..." /></SelectTrigger>
            <SelectContent>{patients.map((p) => (<SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>))}</SelectContent>
          </Select>
        </motion.div>
      )}

      {/* Camera Section */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card className="shadow-md"><CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Camera className="h-4 w-4 text-emerald-600" />Camera Capture</h3>
            <div className="flex gap-2">
              {cameraActive && (
                <AnimatePresence>
                  <motion.div key="switch" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <Button variant="outline" size="icon" onClick={toggleCamera} title="Switch Camera" className="hover:bg-emerald-50 dark:hover:bg-emerald-950/20"><SwitchCamera className="h-4 w-4" /></Button>
                  </motion.div>
                  <motion.div key="close" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <Button variant="outline" size="icon" onClick={stopCamera} className="hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600"><X className="h-4 w-4" /></Button>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>

          {!cameraActive ? (
            <motion.button onClick={startCamera} className="w-full aspect-video rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border-2 border-dashed border-emerald-300 dark:border-emerald-700 flex flex-col items-center justify-center gap-3 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all duration-300 group relative overflow-hidden" whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
              <div className="absolute inset-0 rounded-xl animated-dashed-border pointer-events-none" />
              <motion.div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <motion.div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center camera-bounce" whileHover={{ scale: 1.1, rotate: 5 }}>
                <Aperture className="h-8 w-8 text-emerald-600" />
              </motion.div>
              <div className="text-center relative z-10">
                <p className="font-medium text-gray-900 dark:text-white">Open Camera</p>
                <p className="text-sm text-muted-foreground">Use your device camera to scan documents</p>
              </div>
            </motion.button>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                {/* Flash animation */}
                <AnimatePresence>
                  {flashActive && (<motion.div className="absolute inset-0 bg-white pointer-events-none" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} />)}
                </AnimatePresence>
                {/* Viewfinder corners */}
                <div className="absolute inset-6 pointer-events-none">
                  <motion.div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-emerald-400 rounded-tl-lg" animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut' }} />
                  <motion.div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-emerald-400 rounded-tr-lg" animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} />
                  <motion.div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-emerald-400 rounded-bl-lg" animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }} />
                  <motion.div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-emerald-400 rounded-br-lg" animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }} />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"><motion.div className="w-6 h-6 border border-white/20 rounded-full" animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }} transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut' }} /></div>
                </div>
                <div className="absolute inset-4 border border-white/10 rounded-lg pointer-events-none" />
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <motion.button onClick={captureFrame} className="relative w-16 h-16 rounded-full bg-white border-4 border-emerald-500 flex items-center justify-center shadow-lg group" whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
                    <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-0 group-hover:opacity-30" />
                    <span className="absolute inset-[-4px] rounded-full border border-emerald-300/30 animate-pulse" />
                    <motion.div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600" whileTap={{ scale: 0.85 }} />
                  </motion.button>
                </div>
              </div>
              <motion.div whileTap={{ scale: 0.98 }}><Button onClick={captureFrame} className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20"><Camera className="h-4 w-4 mr-2" />Capture Document</Button></motion.div>
            </div>
          )}

          <AnimatePresence>
            {capturedImages.length > 0 && (
              <motion.div className="space-y-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }}>
                <p className="text-sm font-medium text-muted-foreground">Captured: {capturedImages.length} page{capturedImages.length > 1 ? 's' : ''}</p>
                <div className="grid grid-cols-3 gap-2">
                  {capturedImages.map((img, i) => (
                    <motion.div key={i} className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 ring-1 ring-emerald-200/50 dark:ring-emerald-800/50" initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: i * 0.1, type: 'spring' }}>
                      <img src={URL.createObjectURL(img)} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                      <Badge className="absolute top-1 left-1 text-xs bg-emerald-600 text-white rounded-md">Page {i + 1}</Badge>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent></Card>
      </motion.div>

      {/* File Upload Section */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="shadow-md"><CardContent className="p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4 text-emerald-600" />File Upload</h3>
          <motion.div className={`relative rounded-xl p-8 text-center cursor-pointer transition-all duration-300 overflow-hidden ${isDragging ? 'bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-400 dark:border-emerald-600 scale-[1.01]' : 'bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-800/50 dark:to-gray-900/50'}`} onClick={() => document.getElementById('file-upload')?.click()} onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
            <div className="absolute inset-0 rounded-xl animated-dashed-border pointer-events-none" />
            <div className="relative z-10">
              <motion.div animate={isDragging ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300 }}>
                <FileUp className={`h-10 w-10 mx-auto mb-3 transition-colors duration-300 ${isDragging ? 'text-emerald-500' : 'text-emerald-600'}`} />
              </motion.div>
              <p className="font-medium text-gray-900 dark:text-white">{isDragging ? 'Drop files here!' : 'Drop files here or click to browse'}</p>
              <p className="text-sm text-muted-foreground mt-1">PDF, JPG, PNG, HEIC, TIFF supported · Max 50 MiB per file</p>
            </div>
            <input id="file-upload" type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff,.tif" multiple onChange={handleFileUpload} />
          </motion.div>
          <AnimatePresence>
            {uploadedFiles.length > 0 && (
              <motion.div className="space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <p className="text-sm font-medium text-muted-foreground">{uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''} selected ({(totalSize / 1024 / 1024).toFixed(1)} MB)</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {uploadedFiles.map((file, i) => (
                    <motion.div key={`${file.name}-${i}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 group hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10 transition-colors" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20, height: 0 }} transition={{ duration: 0.2, delay: i * 0.05 }} layout>
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/30 dark:to-emerald-900/30 flex items-center justify-center flex-shrink-0">{file.type === 'application/pdf' ? <FileUp className="h-5 w-5 text-teal-600" /> : <ImageIcon className="h-5 w-5 text-teal-600" />}</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p></div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all" onClick={() => removeFile(i)}><X className="h-4 w-4" /></Button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent></Card>
      </motion.div>

      {/* Document Details */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card className="shadow-md"><CardContent className="p-4 space-y-4">
          <h3 className="font-semibold">Document Details</h3>
          <div className="space-y-2"><Label>Title</Label><Input placeholder="Document title (e.g. Lab Results - Blood Work)" value={title} onChange={(e) => setTitle(e.target.value)} className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400" /></div>
          <div className="space-y-2"><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"><SelectValue /></SelectTrigger><SelectContent>{DOCUMENT_CATEGORIES.map((cat) => (<SelectItem key={cat} value={cat}>{cat}</SelectItem>))}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Notes</Label><Textarea placeholder="Any additional notes about this document..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400" /></div>
        </CardContent></Card>
      </motion.div>

      {/* Upload Button */}
      <motion.div whileTap={{ scale: 0.98 }}>
        <Button className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white h-12 text-base shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20 transition-all duration-300 hover:shadow-lg disabled:opacity-50" disabled={uploading || uploadedFiles.length === 0 || !selectedPatientId} onClick={handleUpload}>
          {uploading ? (<><Loader2 className="h-5 w-5 mr-2 animate-spin" />Uploading {uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''}...</>) : (<><Upload className="h-5 w-5 mr-2" />Upload {uploadedFiles.length} Document{uploadedFiles.length !== 1 ? 's' : ''}</>)}
        </Button>
      </motion.div>

      {/* Recently Scanned strip */}
      <AnimatePresence>
        {recentlyScanned.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: 0.3 }}>
            <Card className="shadow-sm"><CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2"><ScanLine className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs font-medium text-muted-foreground">Recently Scanned</span></div>
              <div className="flex gap-2 overflow-x-auto scrollbar-none">
                {recentlyScanned.map((item, i) => (
                  <motion.div key={`${item.time}-${i}`} className="flex-shrink-0 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 min-w-[120px]" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0"><FileUp className="h-3 w-3 text-emerald-600" /></div>
                      <p className="text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{item.name}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 pl-[26px]">{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </motion.div>
                ))}
              </div>
            </CardContent></Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
