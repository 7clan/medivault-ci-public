'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, type Variants } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Clock,
  CalendarDays,
  UserCheck,
  FileUp,
  CalendarPlus,
  UserPlus,
  ChevronRight,
  CheckCircle2,
  Stethoscope,
  Loader2,
} from 'lucide-react'

interface TodayData {
  todayVisits: number
  todayDocuments: number
  todayPatientsSeen: number
  nextAppointment: {
    id: string
    visitDate: string
    visitTime: string | null
    visitType: string
    chiefComplaint: string | null
    patient: {
      firstName: string
      lastName: string
      id: string
    }
  } | null
}

interface TodaysOverviewProps {
  onScheduleVisit?: () => void
  onAddPatient?: () => void
  onViewPatient?: (patient: { id: string; firstName: string; lastName: string }) => void
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 25, delay: 0.1 },
  },
}

const childVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.2 + i * 0.08, duration: 0.4, ease: 'easeOut' as const },
  }),
}

function useLiveClock(intervalMs = 60000) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return time
}

function formatTimeRemaining(visitDate: string, visitTime: string | null): string {
  const now = new Date()
  let target: Date

  if (visitTime) {
    const [hours, minutes] = visitTime.split(':').map(Number)
    target = new Date()
    target.setHours(hours, minutes, 0, 0)
  } else {
    target = new Date(visitDate)
  }

  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Now'

  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `In ${diffMins} min`
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  return `In ${hours}h ${mins}m`
}

function getVisitTypeColor(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('check')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
  if (t.includes('follow')) return 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300'
  if (t.includes('consult')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
  if (t.includes('emergency')) return 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
  if (t.includes('procedure')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
  return 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
}

export function TodaysOverview({ onScheduleVisit, onAddPatient, onViewPatient }: TodaysOverviewProps) {
  const liveTime = useLiveClock()
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const fetchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadTodayData = useCallback(async () => {
    try {
      const res = await fetch('/api/stats?include=today', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setTodayData(data.todayData)
      }
    } catch (err) {
      console.error('Failed to load today overview:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTodayData()
    // Refresh data every 2 minutes
    fetchIntervalRef.current = setInterval(loadTodayData, 120000)
    return () => {
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current)
    }
  }, [loadTodayData])

  const timeString = liveTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const dateString = liveTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const dayOfMonth = liveTime.getDate()
  const dayName = liveTime.toLocaleDateString('en-US', { weekday: 'short' })
  const monthName = liveTime.toLocaleDateString('en-US', { month: 'short' })

  const isAllCaughtUp = todayData && todayData.todayVisits === 0 && !todayData.nextAppointment

  const getVisitsBadgeColor = (count: number) => {
    if (count === 0) return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    if (count <= 3) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
    if (count <= 6) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
  }

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="show"
      className="w-full"
    >
      <Card className="relative overflow-hidden border-0 shadow-xl dark:shadow-none">
        {/* Gradient accent border on top */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500" />

        {/* Glass morphism background */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/80 to-emerald-50/40 dark:from-gray-900/80 dark:to-emerald-950/30 backdrop-blur-xl" />

        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: `radial-gradient(circle at 25% 25%, currentColor 1px, transparent 1px),
                              radial-gradient(circle at 75% 75%, currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative p-4 sm:p-6">
          {/* Main layout: flex on desktop, stacked on mobile */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">

            {/* Left section: Date/Time + Mini calendar badge */}
            <motion.div
              custom={0}
              variants={childVariants}
              className="flex items-start gap-4 sm:min-w-0"
            >
              {/* Mini calendar date badge */}
              <div className="flex-shrink-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/40 flex flex-col items-center justify-center">
                  <span className="text-[10px] sm:text-xs font-semibold uppercase leading-tight opacity-90">{monthName}</span>
                  <span className="text-xl sm:text-2xl font-bold leading-tight">{dayOfMonth}</span>
                  <span className="text-[10px] sm:text-xs font-medium uppercase leading-tight opacity-90">{dayName}</span>
                </div>
              </div>

              {/* Date/Time display */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {timeString}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {dateString}
                </p>
              </div>
            </motion.div>

            {/* Divider (desktop) */}
            <div className="hidden lg:block w-px bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent self-stretch" />

            {/* Middle section: Quick stats + Appointment preview */}
            <motion.div
              custom={1}
              variants={childVariants}
              className="flex-1 flex flex-col sm:flex-row gap-3 sm:gap-4 min-w-0"
            >
              {/* Quick stats row */}
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                {/* Today's appointments */}
                <Badge
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border-0 ${getVisitsBadgeColor(todayData?.todayVisits || 0)}`}
                >
                  <CalendarDays className="h-3 w-3 mr-1" />
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>{todayData?.todayVisits ?? 0} visits today</>
                  )}
                </Badge>

                {/* Patients seen */}
                <Badge className="px-2.5 py-1 text-xs font-medium rounded-lg border-0 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <UserCheck className="h-3 w-3 mr-1" />
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>{todayData?.todayPatientsSeen ?? 0} seen</>
                  )}
                </Badge>

                {/* Documents uploaded */}
                <Badge className="px-2.5 py-1 text-xs font-medium rounded-lg border-0 bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400">
                  <FileUp className="h-3 w-3 mr-1" />
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>{todayData?.todayDocuments ?? 0} docs</>
                  )}
                </Badge>
              </div>

              {/* Upcoming appointment preview */}
              <div className="flex-shrink-0">
                {loading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading appointments...
                  </div>
                ) : isAllCaughtUp ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      All caught up!
                    </span>
                  </div>
                ) : todayData?.nextAppointment ? (
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-100 dark:border-emerald-900/50 cursor-pointer hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-950/50 dark:hover:to-teal-950/50 transition-colors group"
                    onClick={() => onViewPatient?.(todayData.nextAppointment!.patient)}
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                      <Stethoscope className="h-3 w-3 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                        Next: {todayData.nextAppointment.patient.firstName} {todayData.nextAppointment.patient.lastName}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {todayData.nextAppointment.visitTime ? formatTimeRemaining(todayData.nextAppointment.visitDate, todayData.nextAppointment.visitTime) : formatTimeRemaining(todayData.nextAppointment.visitDate, null)}
                        {' · '}
                        <span className={`inline-block px-1 py-0.5 rounded text-[10px] font-medium ${getVisitTypeColor(todayData.nextAppointment.visitType)}`}>
                          {todayData.nextAppointment.visitType}
                        </span>
                      </p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
                    <CalendarDays className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      No appointments today
                    </span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Divider (desktop) */}
            <div className="hidden lg:block w-px bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent self-stretch" />

            {/* Right section: Quick action buttons */}
            <motion.div
              custom={2}
              variants={childVariants}
              className="flex items-center gap-2 flex-shrink-0 lg:flex-shrink"
            >
              <Button
                size="sm"
                onClick={onScheduleVisit}
                className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/40 dark:shadow-emerald-900/30 transition-all duration-200 text-xs sm:text-sm"
              >
                <CalendarPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                Schedule Visit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onAddPatient}
                className="border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all duration-200 text-xs sm:text-sm"
              >
                <UserPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                Add Patient
              </Button>
            </motion.div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
