'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getPatientDisplayName } from '@/lib/utils-helpers'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  User,
  Stethoscope,
  CheckCircle2,
  XCircle,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Loader2,
  AlertCircle,
  Activity,
  ShieldCheck,
  FlaskConical,
} from 'lucide-react'

// ---------- Types ----------

interface CalendarVisit {
  id: string
  patientId: string
  doctorId: string
  visitDate: string
  visitTime: string | null
  visitType: string
  chiefComplaint: string | null
  status: string
  patient: {
    id: string
    firstName: string
    lastName: string
    dateOfBirth: string | null
    phone: string | null
  }
}

type CalendarMode = 'month' | 'week'

// ---------- Constants ----------

const VISIT_TYPE_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string; darkBg: string; darkBorder: string }> = {
  'Checkup': {
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/60',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500',
    darkBg: 'dark:bg-emerald-950/60',
    darkBorder: 'dark:border-emerald-800',
  },
  'Follow-up': {
    color: 'text-teal-700 dark:text-teal-300',
    bg: 'bg-teal-50 dark:bg-teal-950/60',
    border: 'border-teal-200 dark:border-teal-800',
    dot: 'bg-teal-500',
    darkBg: 'dark:bg-teal-950/60',
    darkBorder: 'dark:border-teal-800',
  },
  'Consultation': {
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/60',
    border: 'border-amber-200 dark:border-amber-800',
    dot: 'bg-amber-500',
    darkBg: 'dark:bg-amber-950/60',
    darkBorder: 'dark:border-amber-800',
  },
  'Emergency': {
    color: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-950/60',
    border: 'border-rose-200 dark:border-rose-800',
    dot: 'bg-rose-500',
    darkBg: 'dark:bg-rose-950/60',
    darkBorder: 'dark:border-rose-800',
  },
  'Procedure': {
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/60',
    border: 'border-purple-200 dark:border-purple-800',
    dot: 'bg-purple-500',
    darkBg: 'dark:bg-purple-950/60',
    darkBorder: 'dark:border-purple-800',
  },
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  completed: { label: 'Completed', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  cancelled: { label: 'Cancelled', color: 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-400' },
  'no-show': { label: 'No Show', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400' },
}

const VISIT_TYPE_ICONS: Record<string, typeof Stethoscope> = {
  'Checkup': Stethoscope,
  'Follow-up': Activity,
  'Consultation': ShieldCheck,
  'Emergency': AlertCircle,
  'Procedure': FlaskConical,
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const TIME_SLOTS = Array.from({ length: 11 }, (_, i) => i + 8) // 8:00 - 18:00

// ---------- Helpers ----------

function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  // Monday = 0, Sunday = 6
  let startDay = firstDay.getDay() - 1
  if (startDay < 0) startDay = 6

  const grid: Date[] = []
  const start = new Date(year, month, 1 - startDay)
  const today = new Date()

  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    grid.push(d)
  }
  return grid
}

function getWeekDays(date: Date): Date[] {
  const d = new Date(date)
  // Get Monday of the week
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(d)
    day.setDate(d.getDate() + i)
    days.push(day)
  }
  return days
}

function formatTime12(time: string | null): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function getHourFromTime(time: string | null): number {
  if (!time) return 8
  return parseInt(time.split(':')[0], 10) || 8
}

function getMinuteFromTime(time: string | null): number {
  if (!time) return 0
  return parseInt(time.split(':')[1] || '0', 10)
}

// ---------- Animation Variants ----------

const cellVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1 },
}

const popoverVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1 },
}

const visitItemVariants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0 },
}

// ---------- Main Component ----------

export function AppointmentCalendar() {
  const [mode, setMode] = useState<CalendarMode>('month')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [visits, setVisits] = useState<CalendarVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [actionDialogOpen, setActionDialogOpen] = useState(false)
  const [actionVisit, setActionVisit] = useState<CalendarVisit | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [direction, setDirection] = useState<1 | -1>(1)
  const { toast } = useToast()
  const { selectPatient } = useAppStore()
  const slideKey = useRef(0)

  // Fetch visits for visible date range
  const fetchVisits = useCallback(async (start: Date, end: Date) => {
    setLoading(true)
    try {
      const startDate = formatDateKey(start)
      const endDate = formatDateKey(end)
      const res = await fetch(`/api/visits?dateFrom=${startDate}&dateTo=${endDate}`)
      if (res.ok) {
        const data = await res.json()
        setVisits(data)
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [])

  // Build date range based on current view
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (mode === 'month') {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()
      const start = new Date(year, month, 1)
      const end = new Date(year, month + 1, 0)
      // Extend a few days for week view edge days
      start.setDate(start.getDate() - 7)
      end.setDate(end.getDate() + 7)
      return { rangeStart: start, rangeEnd: end }
    } else {
      const weekDays = getWeekDays(currentDate)
      return {
        rangeStart: weekDays[0],
        rangeEnd: weekDays[6],
      }
    }
  }, [mode, currentDate])

  useEffect(() => {
    fetchVisits(rangeStart, rangeEnd)
  }, [fetchVisits, rangeStart, rangeEnd])

  // Build visit lookup map
  const visitsByDate = useMemo(() => {
    const map: Record<string, CalendarVisit[]> = {}
    for (const v of visits) {
      const key = formatDateKey(new Date(v.visitDate))
      if (!map[key]) map[key] = []
      map[key].push(v)
    }
    // Sort visits within each day by time
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.visitTime || '').localeCompare(b.visitTime || ''))
    }
    return map
  }, [visits])

  // Navigation handlers
  const goToPrev = () => {
    setDirection(-1)
    slideKey.current++
    if (mode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    } else {
      const d = new Date(currentDate)
      d.setDate(d.getDate() - 7)
      setCurrentDate(d)
    }
  }

  const goToNext = () => {
    setDirection(1)
    slideKey.current++
    if (mode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    } else {
      const d = new Date(currentDate)
      d.setDate(d.getDate() + 7)
      setCurrentDate(d)
    }
  }

  const goToToday = () => {
    setDirection(1)
    slideKey.current++
    setCurrentDate(new Date())
  }

  // Visit actions
  const handleMarkComplete = async () => {
    if (!actionVisit) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/visits/${actionVisit.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (res.ok) {
        toast({ title: 'Visit marked as completed', description: `${getPatientDisplayName(actionVisit.patient)}'s visit completed.` })
        fetchVisits(rangeStart, rangeEnd)
      } else {
        toast({ title: 'Error', description: 'Failed to update visit status.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Network error.', variant: 'destructive' })
    } finally {
      setActionLoading(false)
      setActionDialogOpen(false)
      setActionVisit(null)
    }
  }

  const handleCancel = async () => {
    if (!actionVisit) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/visits/${actionVisit.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (res.ok) {
        toast({ title: 'Visit cancelled', description: `${getPatientDisplayName(actionVisit.patient)}'s visit has been cancelled.` })
        fetchVisits(rangeStart, rangeEnd)
      } else {
        toast({ title: 'Error', description: 'Failed to cancel visit.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Network error.', variant: 'destructive' })
    } finally {
      setActionLoading(false)
      setActionDialogOpen(false)
      setActionVisit(null)
    }
  }

  const handleGoToPatient = (visit: CalendarVisit) => {
    setPopoverOpen(false)
    selectPatient({
      id: visit.patient.id,
      firstName: visit.patient.firstName,
      lastName: visit.patient.lastName,
      dateOfBirth: visit.patient.dateOfBirth,
      phone: visit.patient.phone,
      email: null,
      address: null,
      notes: null,
      createdAt: '',
      updatedAt: '',
      doctorId: visit.doctorId,
    })
  }

  const openActionDialog = (visit: CalendarVisit) => {
    setActionVisit(visit)
    setActionDialogOpen(true)
  }

  // Header label
  const headerLabel = useMemo(() => {
    if (mode === 'month') {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    } else {
      const weekDays = getWeekDays(currentDate)
      const start = weekDays[0]
      const end = weekDays[6]
      if (start.getMonth() === end.getMonth()) {
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
      } else if (start.getFullYear() === end.getFullYear()) {
        return `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} - ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${start.getFullYear()}`
      } else {
        return `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}, ${start.getFullYear()} - ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`
      }
    }
  }, [mode, currentDate])

  // Total visits in visible range
  const totalVisits = useMemo(() => {
    let count = 0
    for (const key of Object.keys(visitsByDate)) {
      if (new Date(key) >= rangeStart && new Date(key) <= rangeEnd) {
        count += visitsByDate[key].length
      }
    }
    return count
  }, [visitsByDate, rangeStart, rangeEnd])

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="card-medical overflow-hidden border-0 shadow-md">
        <CardContent className="p-0">
          {/* Calendar Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 pt-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <CalendarIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Appointment Calendar</h2>
                <p className="text-xs text-muted-foreground">
                  {totalVisits} visit{totalVisits !== 1 ? 's' : ''} in view
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Mode Toggle */}
              <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-0.5">
                <button
                  onClick={() => setMode('month')}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
                    mode === 'month'
                      ? 'bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                  Month
                </button>
                <button
                  onClick={() => setMode('week')}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
                    mode === 'week'
                      ? 'bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  Week
                </button>
              </div>

              <Separator orientation="vertical" className="h-6 hidden sm:block" />

              {/* Navigation */}
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPrev}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs font-semibold" onClick={goToToday}>
                  Today
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNext}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Date label */}
          <div className="px-4 sm:px-6 pb-3">
            <AnimatePresence mode="wait">
              <motion.p
                key={slideKey.current}
                initial={{ opacity: 0, x: direction * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -20 }}
                transition={{ duration: 0.25 }}
                className="text-sm font-semibold text-gray-700 dark:text-gray-300"
              >
                {headerLabel}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Calendar Body */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Loading visits...</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${mode}-${slideKey.current}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
              >
                {mode === 'month' ? (
                  <MonthView
                    currentDate={currentDate}
                    visitsByDate={visitsByDate}
                    selectedDate={selectedDate}
                    onSelectDate={(date, hasVisits) => {
                      setSelectedDate(date)
                      if (hasVisits) setPopoverOpen(true)
                    }}
                    popoverOpen={popoverOpen}
                    onPopoverOpenChange={setPopoverOpen}
                    onVisitAction={openActionDialog}
                    onGoToPatient={handleGoToPatient}
                  />
                ) : (
                  <WeekView
                    currentDate={currentDate}
                    visitsByDate={visitsByDate}
                    onVisitAction={openActionDialog}
                    onGoToPatient={handleGoToPatient}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Legend */}
          <div className="px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="font-medium text-gray-500 dark:text-gray-400">Visit Types:</span>
              {Object.entries(VISIT_TYPE_CONFIG).map(([type, config]) => {
                const Icon = VISIT_TYPE_ICONS[type] || Stethoscope
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <span className={cn('w-2 h-2 rounded-full', config.dot)} />
                    <span>{type}</span>
                  </div>
                )
              })}
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Today</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span>Completed</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visit Action Dialog (Mark Complete / Cancel) */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="sm:max-w-md glass-strong">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" />
              </div>
              Visit Actions
            </DialogTitle>
            <DialogDescription>
              {actionVisit
                ? `${getPatientDisplayName(actionVisit.patient)} — ${actionVisit.visitType} on ${formatDateKey(new Date(actionVisit.visitDate))}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {actionVisit && (
            <div className="flex flex-col gap-2 mt-2">
              {actionVisit.status === 'scheduled' && (
                <Button
                  onClick={handleMarkComplete}
                  disabled={actionLoading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white justify-start gap-2"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Mark as Completed
                </Button>
              )}
              {actionVisit.status === 'scheduled' && (
                <Button
                  onClick={handleCancel}
                  disabled={actionLoading}
                  variant="outline"
                  className="border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 justify-start gap-2"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Cancel Visit
                </Button>
              )}
              <Button
                onClick={() => {
                  handleGoToPatient(actionVisit)
                  setActionDialogOpen(false)
                }}
                variant="outline"
                className="justify-start gap-2 mt-1"
              >
                <User className="w-4 h-4" />
                Go to Patient
                <ArrowRight className="w-3.5 h-3.5 ml-auto" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}

// ---------- Month View ----------

interface MonthViewProps {
  currentDate: Date
  visitsByDate: Record<string, CalendarVisit[]>
  selectedDate: Date | null
  onSelectDate: (date: Date, hasVisits: boolean) => void
  popoverOpen: boolean
  onPopoverOpenChange: (open: boolean) => void
  onVisitAction: (visit: CalendarVisit) => void
  onGoToPatient: (visit: CalendarVisit) => void
}

function MonthView({
  currentDate,
  visitsByDate,
  selectedDate,
  onSelectDate,
  popoverOpen,
  onPopoverOpenChange,
  onVisitAction,
  onGoToPatient,
}: MonthViewProps) {
  const grid = useMemo(
    () => getMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate]
  )
  const currentMonth = currentDate.getMonth()
  const currentYear = currentDate.getFullYear()
  const today = new Date()

  return (
    <div className="px-2 sm:px-4 pb-2">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_NAMES.map((day) => (
          <div
            key={day}
            className="text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px bg-gray-100 dark:bg-gray-800/50 rounded-lg overflow-hidden">
        {grid.map((date, index) => {
          const isCurrentMonth = date.getMonth() === currentMonth && date.getFullYear() === currentYear
          const key = formatDateKey(date)
          const dayVisits = visitsByDate[key] || []
          const hasVisits = dayVisits.length > 0
          const todayMatch = isToday(date)
          const selected = selectedDate && isSameDay(date, selectedDate)
          const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const allCompleted = hasVisits && dayVisits.every((v) => v.status === 'completed' || v.status === 'cancelled')

          // Get first 3 unique visit type dots
          const dotVisits = dayVisits.slice(0, 3)
          const extraCount = dayVisits.length - 3

          return (
            <Popover
              key={key}
              open={selected && hasVisits && popoverOpen ? true : undefined}
              onOpenChange={(open) => {
                if (open) {
                  onSelectDate(date, hasVisits)
                } else {
                  onPopoverOpenChange(false)
                }
              }}
            >
              <PopoverTrigger asChild>
                <motion.button
                  variants={cellVariants}
                  initial="hidden"
                  animate="show"
                  transition={{ delay: index * 0.008, duration: 0.25 }}
                  className={cn(
                    'relative flex flex-col items-center justify-start pt-1.5 pb-1 min-h-[3.5rem] sm:min-h-[4.5rem] transition-all duration-200 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 focus:outline-none',
                    isCurrentMonth
                      ? 'bg-white dark:bg-gray-950'
                      : 'bg-gray-50/80 dark:bg-gray-900/50',
                    selected && 'bg-emerald-50 dark:bg-emerald-950/30',
                    !isCurrentMonth && 'opacity-40'
                  )}
                  onClick={() => onSelectDate(date, hasVisits)}
                  disabled={!hasVisits}
                >
                  {/* Today ring */}
                  {todayMatch && (
                    <div className="absolute inset-1 rounded-lg ring-2 ring-emerald-400 dark:ring-emerald-500 pointer-events-none" />
                  )}

                  {/* Day number */}
                  <span
                    className={cn(
                      'text-xs sm:text-sm font-medium relative z-10 w-6 h-6 flex items-center justify-center rounded-full transition-colors',
                      todayMatch
                        ? 'bg-amber-400 text-white font-bold'
                        : isCurrentMonth
                          ? 'text-gray-800 dark:text-gray-200'
                          : 'text-gray-400 dark:text-gray-600',
                      selected && !todayMatch && 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                    )}
                  >
                    {date.getDate()}
                  </span>

                  {/* Visit dots / count */}
                  {hasVisits && isCurrentMonth && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {dotVisits.map((v, i) => {
                        const config = VISIT_TYPE_CONFIG[v.visitType]
                        const dotColor = allCompleted
                          ? 'bg-gray-400 dark:bg-gray-500'
                          : todayMatch
                            ? 'bg-amber-600 dark:bg-amber-400'
                            : config?.dot || 'bg-emerald-500'
                        return (
                          <span
                            key={v.id}
                            className={cn('w-1.5 h-1.5 rounded-full', dotColor)}
                            style={{ animationDelay: `${i * 50}ms` }}
                          />
                        )
                      })}
                      {extraCount > 0 && (
                        <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400 ml-0.5">
                          +{extraCount}
                        </span>
                      )}
                    </div>
                  )}
                </motion.button>
              </PopoverTrigger>

              {/* Visit details popover */}
              {selected && hasVisits && (
                <PopoverContent
                  className="glass-strong w-80 sm:w-96 p-0 border-emerald-200/50 dark:border-emerald-800/50"
                  align="start"
                  sideOffset={4}
                >
                  <motion.div
                    variants={popoverVariants}
                    initial="hidden"
                    animate="show"
                    transition={{ duration: 0.2 }}
                  >
                    <VisitDayList
                      date={date}
                      visits={dayVisits}
                      onVisitAction={onVisitAction}
                      onGoToPatient={onGoToPatient}
                    />
                  </motion.div>
                </PopoverContent>
              )}
            </Popover>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Week View ----------

interface WeekViewProps {
  currentDate: Date
  visitsByDate: Record<string, CalendarVisit[]>
  onVisitAction: (visit: CalendarVisit) => void
  onGoToPatient: (visit: CalendarVisit) => void
}

function WeekView({ currentDate, visitsByDate, onVisitAction, onGoToPatient }: WeekViewProps) {
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = new Date()

  // Auto-scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [currentDate])

  return (
    <div className="pb-2">
      {/* Week day headers */}
      <div className="grid grid-cols-8 border-b border-gray-200 dark:border-gray-700">
        {/* Time column header */}
        <div className="w-14 sm:w-16 shrink-0" />
        {weekDays.map((date, i) => {
          const todayMatch = isToday(date)
          return (
            <div
              key={i}
              className={cn(
                'text-center py-2 sm:py-3 border-l border-gray-100 dark:border-gray-800',
                todayMatch && 'bg-emerald-50/60 dark:bg-emerald-950/20'
              )}
            >
              <div className={cn(
                'text-[10px] sm:text-xs font-medium uppercase tracking-wider',
                todayMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'
              )}>
                {WEEKDAY_NAMES[i]}
              </div>
              <div className={cn(
                'text-lg sm:text-xl font-bold mt-0.5',
                todayMatch
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-gray-800 dark:text-gray-200'
              )}>
                {date.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="overflow-y-auto max-h-[420px] sm:max-h-[520px]">
        {TIME_SLOTS.map((hour) => (
          <div key={hour} className="grid grid-cols-8 min-h-[3rem]">
            {/* Time label */}
            <div className="w-14 sm:w-16 shrink-0 pr-2 text-right">
              <span className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-500 font-medium">
                {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
              </span>
            </div>

            {/* Day columns */}
            {weekDays.map((date, dayIndex) => {
              const key = formatDateKey(date)
              const dayVisits = visitsByDate[key] || []
              const todayMatch = isToday(date)

              // Find visits at this hour
              const hourVisits = dayVisits.filter((v) => getHourFromTime(v.visitTime) === hour)

              return (
                <div
                  key={dayIndex}
                  className={cn(
                    'border-l border-b border-gray-100 dark:border-gray-800/80 relative',
                    todayMatch && 'bg-emerald-50/30 dark:bg-emerald-950/10'
                  )}
                >
                  {/* Hour line indicator */}
                  <div className="absolute top-0 left-0 right-0 h-px bg-gray-100 dark:bg-gray-800" />

                  {/* Visit blocks */}
                  {hourVisits.length > 0 && (
                    <div className="relative flex flex-col gap-0.5 p-0.5">
                      {hourVisits.map((visit, vIndex) => {
                        const config = VISIT_TYPE_CONFIG[visit.visitType] || VISIT_TYPE_CONFIG['Checkup']
                        const Icon = VISIT_TYPE_ICONS[visit.visitType] || Stethoscope
                        const minute = getMinuteFromTime(visit.visitTime)
                        const topOffset = (minute / 60) * 100

                        return (
                          <Tooltip key={visit.id}>
                            <TooltipTrigger asChild>
                              <motion.button
                                variants={visitItemVariants}
                                initial="hidden"
                                animate="show"
                                transition={{ delay: vIndex * 0.05, duration: 0.2 }}
                                onClick={() => onGoToPatient(visit)}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  onVisitAction(visit)
                                }}
                                className={cn(
                                  'w-full text-left rounded-md px-1.5 py-1 text-[10px] sm:text-xs font-medium transition-all duration-200 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] border cursor-pointer truncate',
                                  config.bg,
                                  config.border,
                                  config.color,
                                  visit.status === 'completed' && 'opacity-50 line-through',
                                  visit.status === 'cancelled' && 'opacity-40 line-through'
                                )}
                                style={{ marginTop: `${topOffset * 0.3}px` }}
                              >
                                <div className="flex items-center gap-1">
                                  <Icon className="w-3 h-3 shrink-0" />
                                  <span className="truncate font-semibold">
                                    {getPatientDisplayName(visit.patient).split(' ')[0]}
                                  </span>
                                </div>
                                {visit.visitTime && (
                                  <div className="text-[9px] opacity-70 flex items-center gap-0.5 mt-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {formatTime12(visit.visitTime)}
                                  </div>
                                )}
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="glass-strong text-xs max-w-[200px]">
                              <div className="font-semibold">{getPatientDisplayName(visit.patient)}</div>
                              <div className="text-muted-foreground">{visit.visitType} • {formatTime12(visit.visitTime)}</div>
                              {visit.chiefComplaint && (
                                <div className="text-muted-foreground mt-0.5 truncate">{visit.chiefComplaint}</div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Visit Day List (Popover Content) ----------

interface VisitDayListProps {
  date: Date
  visits: CalendarVisit[]
  onVisitAction: (visit: CalendarVisit) => void
  onGoToPatient: (visit: CalendarVisit) => void
}

function VisitDayList({ date, visits, onVisitAction, onGoToPatient }: VisitDayListProps) {
  const scheduledVisits = visits.filter((v) => v.status === 'scheduled')
  const completedVisits = visits.filter((v) => v.status !== 'scheduled')

  return (
    <div>
      {/* Popover header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              {WEEKDAY_FULL[date.getDay() === 0 ? 6 : date.getDay() - 1]}
            </p>
            <p className="text-xs text-muted-foreground">
              {MONTH_NAMES[date.getMonth()]} {date.getDate()}, {date.getFullYear()}
            </p>
          </div>
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            {visits.length} visit{visits.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Visit list */}
      <ScrollArea className="max-h-72">
        <div className="p-2 space-y-1.5">
          {visits.map((visit, index) => {
            const config = VISIT_TYPE_CONFIG[visit.visitType] || VISIT_TYPE_CONFIG['Checkup']
            const Icon = VISIT_TYPE_ICONS[visit.visitType] || Stethoscope
            const statusConfig = STATUS_CONFIG[visit.status] || STATUS_CONFIG.scheduled

            return (
              <motion.div
                key={visit.id}
                variants={visitItemVariants}
                initial="hidden"
                animate="show"
                transition={{ delay: index * 0.06, duration: 0.2 }}
                className={cn(
                  'rounded-lg border p-3 transition-all duration-200 hover:shadow-sm cursor-pointer',
                  config.bg,
                  config.border,
                  'group'
                )}
                onClick={() => onGoToPatient(visit)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                      config.bg,
                      'border',
                      config.border
                    )}>
                      <Icon className={cn('w-4 h-4', config.color)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {getPatientDisplayName(visit.patient)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0 h-4', statusConfig.color)}>
                          {statusConfig.label}
                        </Badge>
                        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4 border-current/20', config.color)}>
                          {visit.visitType}
                        </Badge>
                      </div>
                      {visit.visitTime && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatTime12(visit.visitTime)}
                        </div>
                      )}
                      {visit.chiefComplaint && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {visit.chiefComplaint}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-current/10">
                  {visit.status === 'scheduled' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onVisitAction(visit)
                      }}
                      className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Complete
                    </button>
                  )}
                  {visit.status === 'scheduled' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onVisitAction(visit)
                      }}
                      className="flex items-center gap-1 text-[10px] font-medium text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 px-1.5 py-0.5 rounded hover:bg-rose-100/50 dark:hover:bg-rose-900/30 transition-colors"
                    >
                      <XCircle className="w-3 h-3" />
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onGoToPatient(visit)
                    }}
                    className={cn('flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ml-auto', config.color)}
                  >
                    <User className="w-3 h-3" />
                    Patient
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}

          {visits.length === 0 && (
            <div className="text-center py-6">
              <CalendarIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No visits scheduled</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
