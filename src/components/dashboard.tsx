'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type PatientInfo } from '@/store/app-store'
import { formatFileSize, formatDate, getPatientDisplayName, formatAge } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import { ActivityTimeline } from './activity-timeline'
import { RecentlyViewed } from './recently-viewed'
import {
  Search,
  Users,
  FileText,
  HardDrive,
  Clock,
  UserPlus,
  ChevronRight,
  Loader2,
  FolderOpen,
  ScanLine,
  TrendingUp,
  Activity,
  Download,
  Upload,
  BarChart3,
  ChevronDown,
  FileSearch,
  CircleDot,
  CalendarPlus,
  Stethoscope,
  Zap,
  AlertCircle,
  ArrowRight,
  Plus,
  Phone,
  Mail,
  Eye,
  X,
  ImageIcon,
  FileSpreadsheet,
} from 'lucide-react'
import { AddPatientDialog } from './add-patient-dialog'
import { ImportPatientsDialog } from './import-patients-dialog'
import { StatsCharts } from './stats-charts'
import { WelcomeBanner } from './welcome-banner'
import { AnalyticsDashboard } from './analytics-dashboard'
import { AppointmentCalendar } from './appointment-calendar'
import { VisitScheduler, type VisitData } from './visit-scheduler'
import { TodaysOverview } from './todays-overview'

interface RecentPatient {
  id: string
  firstName: string
  lastName: string
  createdAt: string
  updatedAt: string
  documents?: Array<{ id: string; fileName: string; scannedAt: string }>
  _count?: { documents: number }
}
interface RecentDocument {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  scannedAt: string
  category: string
  patient?: { id: string; firstName: string; lastName: string }
}
interface Stats {
  patientCount: number
  documentCount: number
  totalStorage: number
  recentPatients: RecentPatient[]
  recentDocuments: RecentDocument[]
  categoryBreakdown?: Array<{ category: string; count: number }>
  patientsByMonth?: Array<{ month: string; count: number }>
  documentsByMonth?: Array<{ month: string; count: number }>
  documentsByCategory?: Array<{ category: string; count: number }>
  storageByMonth?: Array<{ month: string; size: number }>
  recentActivity?: Array<{ date: string; uploads: number; newPatients: number }>
  todayData?: {
    todayVisits: number
    todayDocuments: number
    todayPatientsSeen: number
    nextAppointment: {
      id: string; visitDate: string; visitTime: string | null; visitType: string; chiefComplaint: string | null; patient: { id: string; firstName: string; lastName: string }
    } | null
  }
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
}

// Animated counter hook
function useAnimatedCounter(target: number, duration = 800) {
  const [count, setCount] = useState(target)
  const prevTarget = useRef(target)

  useEffect(() => {
    if (target === prevTarget.current) return
    prevTarget.current = target
    const start = count
    const startTime = Date.now()

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(start + (target - start) * eased))
      if (progress >= 1) clearInterval(timer)
    }, 16)

    return () => clearInterval(timer)
  }, [target, duration, count])

  return count
}

// Simple SVG Sparkline component
function Sparkline({ data, color, gradientEnd = 'rgba(255,255,255,0.05)' }: { data: number[]; color: string; gradientEnd?: string }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 60
  const h = 24
  const padding = 2

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (w - padding * 2)
    const y = padding + (1 - (val - min) / range) * (h - padding * 2)
    return `${x},${y}`
  }).join(' ')

  const areaPoints = `${padding},${h} ${points} ${w - padding},${h}`

  return (
    <svg width={w} height={h} className="opacity-60">
      <polygon points={areaPoints} fill={color} opacity={0.15} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Dashboard() {
  const { toast } = useToast()
  const { selectPatient, selectDocument, setCurrentView, setScanTargetPatientId, searchQuery, setSearchQuery } =
    useAppStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [patients, setPatients] = useState<PatientInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [addPatientOpen, setAddPatientOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<PatientInfo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [importPatientsOpen, setImportPatientsOpen] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [upcomingVisits, setUpcomingVisits] = useState<VisitData[]>([])
  const [visitSchedulerOpen, setVisitSchedulerOpen] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }, [])

  const loadRecentPatients = useCallback(async () => {
    try {
      const res = await fetch('/api/patients?limit=50', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setPatients(data.patients)
      }
    } catch (err) {
      console.error('Failed to load patients:', err)
    }
  }, [])

  const loadUpcomingVisits = useCallback(async () => {
    try {
      const res = await fetch('/api/visits?upcoming=true', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUpcomingVisits(data.slice(0, 5))
      }
    } catch (err) {
      console.error('Failed to load upcoming visits:', err)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([loadStats(), loadRecentPatients(), loadUpcomingVisits()])
      setLoading(false)
    }
    load()
  }, [loadStats, loadRecentPatients, loadUpcomingVisits])

  // Listen for FAB custom events
  useEffect(() => {
    const handleAddPatient = () => setAddPatientOpen(true)
    const handleQuickUpload = () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff,.tif'
      input.multiple = true
      input.click()
    }
    window.addEventListener('medivault:add-patient', handleAddPatient)
    window.addEventListener('medivault:quick-upload', handleQuickUpload)
    return () => {
      window.removeEventListener('medivault:add-patient', handleAddPatient)
      window.removeEventListener('medivault:quick-upload', handleQuickUpload)
    }
  }, [])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(searchQuery)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.patients)
        }
      } catch (err) {
        console.error('Search failed:', err)
      }
      setIsSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleImportComplete = () => {
    loadRecentPatients()
    loadStats()
    loadUpcomingVisits()
  }

  const handlePatientCreated = (patient: PatientInfo) => {
    setAddPatientOpen(false)
    loadRecentPatients()
    loadStats()
    loadUpcomingVisits()
    toast({ title: 'Patient Added', description: `${getPatientDisplayName(patient)} has been added.` })
  }

  const handleScanDocument = () => {
    setScanTargetPatientId(null)
    setCurrentView('scan-capture')
  }

  // Animated counters
  const animatedPatients = useAnimatedCounter(stats?.patientCount || 0)
  const animatedDocuments = useAnimatedCounter(stats?.documentCount || 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          className="text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading your clinic data...</p>
        </motion.div>
      </div>
    )
  }

  const displayPatients = searchQuery.trim() ? searchResults : patients

  // Get category-based accent bar color
  const getCategoryAccent = (patient: PatientInfo) => {
    if (patient.documents && patient.documents.length > 0) {
      const lastDoc = patient.documents[0]
      const cat = (lastDoc.category || '').toLowerCase()
      if (cat.includes('lab')) return 'border-l-purple-500'
      if (cat.includes('prescription')) return 'border-l-emerald-500'
      if (cat.includes('x-ray') || cat.includes('xray')) return 'border-l-blue-500'
      if (cat.includes('mri') || cat.includes('ct')) return 'border-l-red-500'
      if (cat.includes('referral')) return 'border-l-amber-500'
      if (cat.includes('insurance')) return 'border-l-teal-500'
      if (cat.includes('identity')) return 'border-l-orange-500'
      if (cat.includes('consent')) return 'border-l-yellow-500'
    }
    const count = patient._count?.documents || 0
    if (count >= 10) return 'border-l-emerald-500'
    if (count >= 5) return 'border-l-teal-500'
    if (count >= 2) return 'border-l-amber-500'
    return 'border-l-gray-300 dark:border-l-gray-600'
  }

  // Get name-based avatar ring color
  const getAvatarRingColor = (firstName: string) => {
    if (!firstName) return 'ring-emerald-200/50 dark:ring-emerald-800/50'
    const code = firstName.charCodeAt(0)
    const idx = code % 6
    const colors = [
      'ring-emerald-300/60 dark:ring-emerald-700/60',
      'ring-purple-300/60 dark:ring-purple-700/60',
      'ring-amber-300/60 dark:ring-amber-700/60',
      'ring-teal-300/60 dark:ring-teal-700/60',
      'ring-rose-300/60 dark:ring-rose-700/60',
      'ring-blue-300/60 dark:ring-blue-700/60',
    ]
    return colors[idx]
  }

  // Get name-based avatar gradient
  const getAvatarGradient = (firstName: string) => {
    if (!firstName) return 'from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50'
    const code = firstName.charCodeAt(0)
    const idx = code % 6
    const gradients = [
      'from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50',
      'from-purple-100 to-violet-100 dark:from-purple-900/50 dark:to-violet-900/50',
      'from-amber-100 to-orange-100 dark:from-amber-900/50 dark:to-orange-900/50',
      'from-teal-100 to-cyan-100 dark:from-teal-900/50 dark:to-cyan-900/50',
      'from-rose-100 to-pink-100 dark:from-rose-900/50 dark:to-pink-900/50',
      'from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50',
    ]
    return gradients[idx]
  }

  // Highlight matching text in patient name
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} className="search-highlight">{part}</span>
      ) : (
        part
      )
    )
  }

  // Sparkline sample data (deterministic)
  const patientSparkData = [3, 5, 4, 7, 6, 9, 8]
  const docSparkData = [8, 12, 10, 15, 14, 18, 16]
  const storageSparkData = [1, 2, 2, 3, 4, 3, 5]

  return (
    <motion.div
      className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Welcome Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'},{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">{useAppStore.getState().doctorName || 'Doctor'}</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={showAnalytics ? 'default' : 'outline'}
            onClick={() => { setShowAnalytics(!showAnalytics); if (showCalendar) setShowCalendar(false) }}
            className={`transition-all duration-200 ${showAnalytics ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Analytics
            <motion.div
              animate={{ rotate: showAnalytics ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </motion.div>
          </Button>
          <Button
            variant={showCalendar ? 'default' : 'outline'}
            onClick={() => { setShowCalendar(!showCalendar); if (showAnalytics) setShowAnalytics(false) }}
            className={`transition-all duration-200 ${showCalendar ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <CalendarPlus className="h-4 w-4 mr-1.5" />
            Calendar
            <motion.div
              animate={{ rotate: showCalendar ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </motion.div>
          </Button>
          <Button onClick={() => setAddPatientOpen(true)} className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/40 transition-all duration-300 hover:shadow-lg">
            <UserPlus className="h-4 w-4 mr-2" />
            Add Patient
          </Button>
          <Button variant="outline" onClick={handleScanDocument} className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all duration-200">
            <ScanLine className="h-4 w-4 mr-2" />
            Scan Document
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportPatientsOpen(true)}
            className="border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-200"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = '/api/patients/export'
            }}
            className="border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-200"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </motion.div>

      {/* Analytics Dashboard - Expandable */}
      <AnimatePresence>
        {showAnalytics && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <AnalyticsDashboard />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar View - Expandable */}
      <AnimatePresence>
        {showCalendar && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <AppointmentCalendar />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Today's Overview Widget */}
      <motion.div variants={itemVariants}>
        <TodaysOverview
          onScheduleVisit={() => setVisitSchedulerOpen(true)}
          onAddPatient={() => setAddPatientOpen(true)}
          onViewPatient={(patient) => selectPatient({ id: patient.id, firstName: patient.firstName, lastName: patient.lastName, doctorId: '', dateOfBirth: null, phone: null, email: null, address: null, notes: null, createdAt: '', updatedAt: '' })}
        />
      </motion.div>

      {/* Onboarding Banner */}
      <motion.div variants={itemVariants}>
        <WelcomeBanner />
      </motion.div>

      {/* Stats Cards - Enhanced with gradient border, inner shadow, spring hover, sparkline overlay */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <Card className="gradient-border border-0 shadow-lg shadow-emerald-200/40 dark:shadow-none bg-gradient-to-br from-emerald-500 to-emerald-600 text-white overflow-hidden relative group glow-shadow-hover transition-shadow duration-300 shadow-inner-subtle">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
            <div className="absolute bottom-2 right-2"><Sparkline data={patientSparkData} color="rgba(255,255,255,0.45)" /></div>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-100 font-medium">Patients</p>
                  <p className="text-2xl font-bold tabular-nums">{animatedPatients}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Users className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <Card className="gradient-border border-0 shadow-lg shadow-teal-200/40 dark:shadow-none bg-gradient-to-br from-teal-500 to-teal-600 text-white overflow-hidden relative group glow-shadow-teal transition-shadow duration-300 shadow-inner-subtle">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
            <div className="absolute bottom-2 right-2"><Sparkline data={docSparkData} color="rgba(255,255,255,0.45)" /></div>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-teal-100 font-medium">Documents</p>
                  <p className="text-2xl font-bold tabular-nums">{animatedDocuments}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <FileText className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <Card className="gradient-border border-0 shadow-lg shadow-amber-200/40 dark:shadow-none bg-gradient-to-br from-amber-500 to-amber-600 text-white overflow-hidden relative group glow-shadow-amber transition-shadow duration-300 shadow-inner-subtle">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
            <div className="absolute bottom-2 right-2"><Sparkline data={storageSparkData} color="rgba(255,255,255,0.45)" /></div>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-100 font-medium">Storage Used</p>
                  <p className="text-2xl font-bold">{formatFileSize(stats?.totalStorage || 0)}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <HardDrive className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <Card className="gradient-border border-0 shadow-lg shadow-rose-200/40 dark:shadow-none bg-gradient-to-br from-rose-500 to-rose-600 text-white overflow-hidden relative group glow-shadow-rose transition-shadow duration-300 shadow-inner-subtle">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
            <div className="absolute bottom-2 right-2"><Sparkline data={patientSparkData} color="rgba(255,255,255,0.45)" /></div>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-rose-100 font-medium">Recent Uploads</p>
                  <p className="text-2xl font-bold">{stats?.recentDocuments?.length || 0}</p>
                  <p className="text-xs text-rose-200">documents today</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Activity className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Category Distribution Chart */}
      {stats?.categoryBreakdown && stats.categoryBreakdown.length > 0 && (
        <motion.div variants={itemVariants}>
          <StatsCharts categoryBreakdown={stats.categoryBreakdown} />
        </motion.div>
      )}

      {/* Search Bar - Enhanced with animated results counter */}
      <motion.div variants={itemVariants} className="relative">
        <Search className={`absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground transition-all duration-300 z-10 ${searchFocused ? 'text-emerald-500 scale-110' : ''}`} />
        <motion.div
          animate={{
            scale: searchFocused ? 1.01 : 1,
            boxShadow: searchFocused
              ? '0 0 0 3px rgba(16, 185, 129, 0.1), 0 4px 16px rgba(16, 185, 129, 0.08)'
              : '0 1px 2px rgba(0,0,0,0.05)',
          }}
          transition={{ duration: 0.25 }}
          className="relative"
        >
          <Input
            placeholder="Search patients by name, phone, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={`pl-12 pr-20 h-12 text-base rounded-xl border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-all duration-300 ${
              searchFocused
                ? 'border-emerald-400 dark:border-emerald-600 ring-2 ring-emerald-500/20'
                : 'hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery.trim() && !isSearching && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => { setSearchQuery('') }}
                className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-muted-foreground hover:text-foreground transition-colors duration-150"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </motion.button>
            )}
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            ) : !searchQuery.trim() && (
              <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 text-[10px] font-mono text-muted-foreground">
                Ctrl+K
              </kbd>
            )}
          </div>
        </motion.div>

        {/* Animated search results counter */}
        <AnimatePresence>
          {searchQuery.trim() && !isSearching && (
            <motion.div
              initial={{ opacity: 0, y: -4, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 px-1 flex items-center gap-2">
                {searchResults.length > 0 ? (
                  <>
                    <motion.span
                      key={`count-${searchResults.length}`}
                      initial={{ scale: 1.2 }}
                      animate={{ scale: 1 }}
                      className="text-sm font-semibold text-emerald-600 tabular-nums"
                    >
                      {searchResults.length}
                    </motion.span>
                    <span className="text-sm text-muted-foreground">
                      result{searchResults.length !== 1 ? 's' : ''} found
                    </span>
                  </>
                ) : (
                  <>
                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">No results found</span>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Recently Viewed */}
      <motion.div variants={itemVariants}>
        <RecentlyViewed />
      </motion.div>

      {/* Upcoming Visits */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-emerald-600" />
            Upcoming Visits
          </h2>
          <Button
            size="sm"
            onClick={() => setVisitSchedulerOpen(true)}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
          >
            <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
            Schedule Visit
          </Button>
        </div>
        {upcomingVisits.length === 0 ? (
          <Card className="border-dashed border-gray-300 dark:border-gray-700">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-3">
                <CalendarPlus className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="text-sm text-muted-foreground">No upcoming visits</p>
              <Button
                variant="link"
                size="sm"
                className="text-emerald-600 mt-1"
                onClick={() => setVisitSchedulerOpen(true)}
              >
                Schedule your first visit
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence>
              {upcomingVisits.map((visit, index) => {
                const VisitTypeIcon =
                  visit.visitType === 'Emergency' ? Zap :
                  visit.visitType === 'Consultation' ? AlertCircle : Stethoscope
                return (
                  <motion.div
                    key={visit.id}
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.04 }}
                    layout
                  >
                    <Card
                      className="cursor-pointer border-l-[3px] border-l-sky-500 hover:border-l-emerald-500 transition-all duration-200 hover:shadow-md group"
                      onClick={() => {
                        if (visit.patient) {
                          selectPatient({
                            id: visit.patient.id,
                            firstName: visit.patient.firstName,
                            lastName: visit.patient.lastName,
                            doctorId: '',
                            dateOfBirth: visit.patient.dateOfBirth,
                            phone: visit.patient.phone,
                            email: null,
                            address: null,
                            notes: null,
                            createdAt: '',
                            updatedAt: '',
                          })
                        }
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                              <VisitTypeIcon className="h-5 w-5 text-sky-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                </span>
                                <h3 className="font-medium text-gray-900 dark:text-white truncate text-sm">
                                  {visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : 'Unknown Patient'}
                                </h3>
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(visit.visitDate)}
                                  {visit.visitTime ? ` at ${visit.visitTime}` : ''}
                                </span>
                                <Badge variant="secondary" className="text-xs bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
                                  {visit.visitType}
                                </Badge>
                              </div>
                              {visit.chiefComplaint && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{visit.chiefComplaint}</p>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* Patient List - Enhanced with category accent, name-based avatar, staggered entrance */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            {searchQuery.trim() ? 'Search Results' : 'Recent Patients'}
          </h2>
          <Badge variant="secondary" className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
            <motion.span
              key={`badge-${displayPatients.length}`}
              initial={{ scale: 1.15 }}
              animate={{ scale: 1 }}
              className="inline-block tabular-nums"
            >
              {displayPatients.length}
            </motion.span>
            {' '}patient{displayPatients.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        <AnimatePresence mode="popLayout">
          {displayPatients.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <Card className="border-dashed border-gray-300 dark:border-gray-700">
                <CardContent className="flex flex-col items-center justify-center py-16">
                  {searchQuery.trim() ? (
                    <>
                      <motion.div
                        className="w-20 h-20 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center mb-4"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      >
                        <FileSearch className="h-10 w-10 text-gray-400" />
                      </motion.div>
                      <h3 className="text-lg font-medium text-muted-foreground">No patients found</h3>
                      <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
                        Try adjusting your search terms or check the spelling
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Animated medical illustration */}
                      <motion.svg
                        width="120"
                        height="120"
                        viewBox="0 0 120 120"
                        className="mb-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6 }}
                      >
                        {/* Pulsing background circle */}
                        <motion.circle
                          cx="60" cy="60" r="50"
                          fill="none"
                          stroke="oklch(0.696 0.17 162.48 / 15%)"
                          strokeWidth="2"
                          animate={{ r: [48, 52, 48], opacity: [0.3, 0.6, 0.3] }}
                          transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        {/* Stethoscope icon path */}
                        <motion.path
                          d="M45 30 C45 30, 40 45, 45 55 L45 70 C45 80, 55 80, 55 70 L55 55 C60 45, 55 30, 55 30"
                          fill="none"
                          stroke="oklch(0.696 0.17 162.48)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 1.5, ease: 'easeInOut' }}
                        />
                        {/* Heart pulse line */}
                        <motion.path
                          d="M20 60 L35 60 L40 50 L48 70 L53 45 L58 65 L63 60 L100 60"
                          fill="none"
                          stroke="oklch(0.696 0.17 162.48 / 50%)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
                        />
                        {/* Plus cross */}
                        <motion.g
                          animate={{ rotate: 360 }}
                          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                          style={{ transformOrigin: '90px 35px' }}
                        >
                          <line x1="85" y1="35" x2="95" y2="35" stroke="oklch(0.696 0.17 162.48 / 40%)" strokeWidth="2" strokeLinecap="round" />
                          <line x1="90" y1="30" x2="90" y2="40" stroke="oklch(0.696 0.17 162.48 / 40%)" strokeWidth="2" strokeLinecap="round" />
                        </motion.g>
                        {/* Floating dots */}
                        <motion.circle cx="30" cy="35" r="3" fill="oklch(0.696 0.17 162.48 / 30%)" animate={{ cy: [35, 30, 35] }} transition={{ type: 'tween', duration: 2.5, repeat: Infinity, ease: 'easeInOut' }} />
                        <motion.circle cx="85" cy="80" r="2" fill="oklch(0.6 0.118 184.704 / 30%)" animate={{ cx: [85, 90, 85] }} transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }} />
                      </motion.svg>
                      <h3 className="text-lg font-medium text-muted-foreground">No patients yet</h3>
                      <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
                        Add your first patient to start managing their medical documents
                      </p>
                      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                        <Button
                          onClick={() => setAddPatientOpen(true)}
                          className="mt-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20 transition-all duration-300"
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          Get Started
                          <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </motion.div>
                    </>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="grid gap-3">
              {displayPatients.map((patient, index) => (
                <motion.div
                  key={patient.id}
                  layout
                  initial={{ opacity: 0, y: 15, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  transition={{
                    duration: 0.3,
                    delay: index * 0.04,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <Card
                    className={`cursor-pointer border-l-[3px] ${getCategoryAccent(patient)} hover:border-l-emerald-500 transition-all duration-200 hover:shadow-md card-hover-lift group`}
                    onClick={() => selectPatient(patient)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <motion.div
                            className={`w-12 h-12 rounded-full bg-gradient-to-br ${getAvatarGradient(patient.firstName)} flex items-center justify-center flex-shrink-0 ring-2 ${getAvatarRingColor(patient.firstName)} group-hover:ring-emerald-400 dark:group-hover:ring-emerald-600 transition-all`}
                            whileHover={{ scale: 1.08 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          >
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-lg">
                              {patient.firstName[0]}{patient.lastName[0]}
                            </span>
                          </motion.div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                              {searchQuery.trim()
                                ? highlightMatch(getPatientDisplayName(patient), searchQuery)
                                : getPatientDisplayName(patient)}
                            </h3>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {patient.phone && (
                                <span className="text-sm text-muted-foreground">
                                  {searchQuery.trim()
                                    ? highlightMatch(patient.phone, searchQuery)
                                    : patient.phone}
                                </span>
                              )}
                              {patient.dateOfBirth && (
                                <span className="text-xs text-muted-foreground hidden sm:inline">
                                  DOB: {patient.dateOfBirth}
                                </span>
                              )}
                              {patient.dateOfBirth && (
                                <Badge variant="secondary" className="text-xs font-normal bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                                  {formatAge(patient.dateOfBirth)}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs">
                                <FileText className="h-3 w-3 mr-1" />
                                {patient._count?.documents || 0} doc{(patient._count?.documents || 0) !== 1 ? 's' : ''}
                              </Badge>
                              {patient.documents && patient.documents[0] && (
                                <span className="text-xs text-muted-foreground">
                                  Last: {formatDate(patient.documents[0].scannedAt)}
                                </span>
                              )}
                            </div>
                            {/* Quick action row - appears on hover */}
                            <div className="quick-action-row border-t border-gray-100 dark:border-gray-800 mt-2 flex items-center gap-1">
                              {patient.phone && (
                                <motion.button
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                  whileTap={{ scale: 0.95 }}
                                  onClick={(e) => { e.stopPropagation() }}
                                >
                                  <Phone className="h-3 w-3" />
                                  <span className="hidden sm:inline">Call</span>
                                </motion.button>
                              )}
                              {patient.email && (
                                <motion.button
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                  whileTap={{ scale: 0.95 }}
                                  onClick={(e) => { e.stopPropagation() }}
                                >
                                  <Mail className="h-3 w-3" />
                                  <span className="hidden sm:inline">Email</span>
                                </motion.button>
                              )}
                              <motion.button
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                whileTap={{ scale: 0.95 }}
                                onClick={(e) => { e.stopPropagation(); selectPatient(patient) }}
                              >
                                <Eye className="h-3 w-3" />
                                <span className="hidden sm:inline">View</span>
                              </motion.button>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Recent Activity */}
      {stats?.recentDocuments && stats.recentDocuments.length > 0 && !searchQuery.trim() && (
        <motion.div variants={itemVariants}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600" />
            Recent Documents
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.recentDocuments.map((doc: any) => {
              const isImage = doc.mimeType?.startsWith('image/')
              const isPdf = doc.mimeType === 'application/pdf'
              return (
                <motion.div
                  key={doc.id}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Card
                    className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-all duration-200 hover:shadow-md group"
                    onClick={() => {
                      useAppStore.getState().selectPatient({ id: doc.patient.id, ...doc.patient })
                      selectDocument(doc)
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform ${
                          isImage
                            ? 'bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/30 dark:to-blue-900/30'
                            : isPdf
                              ? 'bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-900/30 dark:to-red-900/30'
                              : 'bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/30 dark:to-emerald-900/30'
                        }`}>
                          {isImage ? (
                            <ImageIcon className="h-5 w-5 text-sky-600" />
                          ) : isPdf ? (
                            <FileText className="h-5 w-5 text-rose-600" />
                          ) : (
                            <FileText className="h-5 w-5 text-teal-600" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-sm truncate">{doc.title || doc.fileName}</p>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider flex-shrink-0 ${
                              isPdf
                                ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
                                : isImage
                                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                            }`}>
                              {isPdf ? 'PDF' : isImage ? 'IMG' : 'DOC'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {doc.patient.firstName} {doc.patient.lastName}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-emerald-600 font-medium">{formatDate(doc.scannedAt)}</p>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <p className="text-[10px] text-muted-foreground">{formatFileSize(doc.fileSize)}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Activity Timeline */}
      {!searchQuery.trim() && (
        <motion.div variants={itemVariants}>
          <ActivityTimeline />
        </motion.div>
      )}

      {/* Add Patient Dialog */}
      <AddPatientDialog open={addPatientOpen} onOpenChange={setAddPatientOpen} onCreated={handlePatientCreated} />

      {/* Import Patients Dialog */}
      <ImportPatientsDialog
        open={importPatientsOpen}
        onOpenChange={setImportPatientsOpen}
        onImportComplete={handleImportComplete}
      />

      {/* Visit Scheduler Dialog */}
      <VisitScheduler
        open={visitSchedulerOpen}
        onOpenChange={(open) => { setVisitSchedulerOpen(open); if (!open) loadUpcomingVisits() }}
        onSaved={() => loadUpcomingVisits()}
      />
    </motion.div>
  )
}
