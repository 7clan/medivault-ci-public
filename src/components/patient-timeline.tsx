'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { formatDateTime, formatDate, formatFileSize, getCategoryColor } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  FileText,
  Pill,
  StickyNote,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Pin,
  Filter,
  Activity,
  ImageIcon,
  Eye,
} from 'lucide-react'
import { useAppStore, type PatientInfo } from '@/store/app-store'

// ─── Data Model ─────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string
  type: 'visit' | 'document' | 'prescription' | 'note' | 'annotation'
  title: string
  description: string
  timestamp: string
  details: Record<string, any>
}

interface PatientTimelineProps {
  patientId: string
}

// ─── Type Configuration ─────────────────────────────────────────────────────

type EventType = TimelineEvent['type']

interface EventTypeConfig {
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  dotColor: string
  iconBg: string
  iconColor: string
  borderLeft: string
}

const EVENT_TYPE_CONFIG: Record<EventType, EventTypeConfig> = {
  visit: {
    labelKey: 'timeline.type.visits',
    icon: Calendar,
    dotColor: 'bg-emerald-500',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    borderLeft: 'border-s-emerald-500',
  },
  document: {
    labelKey: 'timeline.type.documents',
    icon: FileText,
    dotColor: 'bg-teal-500',
    iconBg: 'bg-teal-100 dark:bg-teal-900/40',
    iconColor: 'text-teal-600 dark:text-teal-400',
    borderLeft: 'border-s-teal-500',
  },
  prescription: {
    labelKey: 'timeline.type.prescriptions',
    icon: Pill,
    dotColor: 'bg-amber-500',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    borderLeft: 'border-s-amber-500',
  },
  note: {
    labelKey: 'timeline.type.notes',
    icon: StickyNote,
    dotColor: 'bg-purple-500',
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    iconColor: 'text-purple-600 dark:text-purple-400',
    borderLeft: 'border-s-purple-500',
  },
  annotation: {
    labelKey: 'timeline.type.annotations',
    icon: MessageSquare,
    dotColor: 'bg-rose-500',
    iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
    borderLeft: 'border-s-rose-500',
  },
}

const FILTER_TYPES: EventType[] = ['visit', 'document', 'prescription', 'note', 'annotation']

// ─── Visit Status Styles ─────────────────────────────────────────────────────

const VISIT_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  scheduled: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  'no-show': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const PRESCRIPTION_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  completed: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  discontinued: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const NOTE_CATEGORY_COLORS: Record<string, string> = {
  General: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  Diagnosis: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  'Treatment Plan': 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  'Lab Results': 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'Follow-up': 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  Referral: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// ─── Relative Time Helper ────────────────────────────────────────────────────

function getRelativeTime(dateString: string): string {
  const now = new Date()
  const date = new Date(dateString)
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  const isAr = typeof document !== 'undefined' && document.documentElement.lang === 'ar'
  if (diffSecs < 60) return isAr ? 'الآن' : 'just now'
  if (diffMins < 60) return isAr ? `قبل ${diffMins} د` : `${diffMins}m ago`
  if (diffHours < 24) return isAr ? `قبل ${diffHours} س` : `${diffHours}h ago`
  if (diffDays < 7) return isAr ? `قبل ${diffDays} يوم` : `${diffDays}d ago`
  if (diffWeeks < 5) return isAr ? `قبل ${diffWeeks} أسبوع` : `${diffWeeks}w ago`
  if (diffMonths < 12) return isAr ? `قبل ${diffMonths} شهر` : `${diffMonths}mo ago`
  return formatDate(dateString)
}

// ─── Date Group Helper ────────────────────────────────────────────────────

function getDateGroup(dateString: string): string {
  const now = new Date()
  const date = new Date(dateString)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const isAr = typeof document !== 'undefined' && document.documentElement.lang === 'ar'
  if (dateOnly.getTime() === today.getTime()) return isAr ? 'اليوم' : 'Today'
  if (dateOnly.getTime() === yesterday.getTime()) return isAr ? 'أمس' : 'Yesterday'
  return formatDate(dateString)
}

// ─── Main Component ────────────────────────────────────────────────────────

export function PatientTimeline({ patientId }: PatientTimelineProps) {
  const { selectDocument } = useAppStore()
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(
    new Set(FILTER_TYPES)
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(20)

  // Fetch all timeline events
  useEffect(() => {
    let cancelled = false
    const fetchTimeline = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/timeline`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setEvents(data)
        }
      } catch {
        console.error('Failed to load timeline')
      }
      if (!cancelled) setLoading(false)
    }
    fetchTimeline()
    return () => { cancelled = true }
  }, [patientId])

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => activeFilters.has(e.type))
  }, [events, activeFilters])

  // Group events by date
  const { t, tCategory } = useI18n()
  const groupedEvents = useMemo(() => {
    const groups: { label: string; events: TimelineEvent[] }[] = []
    let currentGroup: { label: string; events: TimelineEvent[] } | null = null

    for (const event of filteredEvents) {
      const groupLabel = getDateGroup(event.timestamp)
      if (!currentGroup || currentGroup.label !== groupLabel) {
        currentGroup = { label: groupLabel, events: [] }
        groups.push(currentGroup)
      }
      currentGroup.events.push(event)
    }
    return groups
  }, [filteredEvents])

  // Event count by type
  const countsByType = useMemo(() => {
    const counts: Record<EventType, number> = {
      visit: 0,
      document: 0,
      prescription: 0,
      note: 0,
      annotation: 0,
    }
    for (const event of events) {
      counts[event.type]++
    }
    return counts
  }, [events])

  // Visible events for "load more"
  const visibleGroups = useMemo(() => {
    let count = 0
    const result: { label: string; events: TimelineEvent[] }[] = []
    for (const group of groupedEvents) {
      if (count >= visibleCount) break
      const remaining = visibleCount - count
      if (remaining >= group.events.length) {
        result.push(group)
        count += group.events.length
      } else {
        result.push({ ...group, events: group.events.slice(0, remaining) })
        count += remaining
      }
    }
    return result
  }, [groupedEvents, visibleCount])

  const hasMore = visibleCount < filteredEvents.length

  const toggleFilter = (type: EventType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        // Don't allow deselecting the last filter
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const totalVisibleEvents = visibleGroups.reduce((sum, g) => sum + g.events.length, 0)

  // ─── Loading State ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Filter pills skeleton */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full flex-shrink-0" />
          ))}
        </div>
        {/* Timeline skeleton */}
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="w-0.5 flex-1 mt-1" />
              </div>
              <div className="flex-1 space-y-2 pb-4">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Empty State ──────────────────────────────────────────────────────

  if (events.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex flex-col items-center justify-center py-12">
          <motion.div
            className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mb-4 relative"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Activity className="h-10 w-10 text-emerald-400" />
            <motion.div
              className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-md"
              animate={{ y: [0, -3, 0] }}
              transition={{ type: 'tween', duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Clock className="h-3 w-3 text-white" />
            </motion.div>
          </motion.div>
          <h3 className="text-lg font-medium text-muted-foreground">{t('timeline.empty')}</h3>
          <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
            {t('timeline.emptyHint')}
          </p>
        </div>
      </motion.div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex gap-1.5 flex-wrap">
          <AnimatePresence mode="popLayout">
            {FILTER_TYPES.map((type) => {
              const config = EVENT_TYPE_CONFIG[type]
              const Icon = config.icon
              const isActive = activeFilters.has(type)
              const count = countsByType[type]

              return (
                <motion.button
                  key={type}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => toggleFilter(type)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 border',
                    isActive
                      ? 'border-transparent shadow-sm'
                      : 'bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-gray-200 dark:border-gray-700 text-muted-foreground hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                  style={
                    isActive
                      ? {
                          backgroundColor: 'transparent',
                          boxShadow: undefined,
                        }
                      : undefined
                  }
                >
                  {isActive ? (
                    <span className={cn('inline-flex items-center gap-1.5 px-0 py-0')}>
                      <span className={cn('w-5 h-5 rounded-full flex items-center justify-center', config.iconBg)}>
                        <Icon className={cn('h-3 w-3', config.iconColor)} />
                      </span>
                      <span className={config.iconColor}>{t(config.labelKey)}</span>
                      <span className={cn('text-[10px] leading-none px-1.5 py-0.5 rounded-full', config.iconBg, config.iconColor)}>
                        {count}
                      </span>
                    </span>
                  ) : (
                    <>
                      <Icon className="h-3 w-3" />
                      {t(config.labelKey)}
                      <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-muted-foreground">
                        {count}
                      </span>
                    </>
                  )}
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8"
        >
          <p className="text-sm text-muted-foreground">
            {t('timeline.noMatch')}
          </p>
        </motion.div>
      ) : (
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute start-[15px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-emerald-300 via-teal-300 to-teal-400 dark:from-emerald-700 dark:via-teal-700 dark:to-teal-600 opacity-60" />

          {visibleGroups.map((group) => (
            <div key={group.label}>
              {/* Date Group Header */}
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative ps-10 mb-3 first:mt-0 mt-6"
              >
                <div className={cn(
                  'absolute start-[7px] top-1 w-[18px] h-[18px] rounded-full border-2 border-white dark:border-gray-900 bg-gradient-to-br from-emerald-400 to-teal-400 dark:from-emerald-600 dark:to-teal-600 flex items-center justify-center',
                  'z-10'
                )}>
                  <Calendar className="h-2.5 w-2.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  {group.label}
                </span>
              </motion.div>

              {/* Events in this group */}
              <div className="space-y-0">
                {group.events.map((event, index) => (
                  <TimelineEventCard
                    key={event.id}
                    event={event}
                    isExpanded={expandedId === event.id}
                    index={index}
                    onToggleExpand={() => toggleExpand(event.id)}
                    onNavigate={() => handleEventNavigation(event)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex justify-center pt-2"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((prev) => prev + 20)}
            className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
          >
            {t('timeline.loadMore', { count: filteredEvents.length - totalVisibleEvents })}
          </Button>
        </motion.div>
      )}
    </div>
  )
}

// ─── Navigation Handler ────────────────────────────────────────────────────

function handleEventNavigation(event: TimelineEvent) {
  // Navigation is handled by the parent via event callbacks
}

// ─── Event Card Component ───────────────────────────────────────────────────

interface TimelineEventCardProps {
  event: TimelineEvent
  isExpanded: boolean
  index: number
  onToggleExpand: () => void
  onNavigate: (event: TimelineEvent) => void
}

function TimelineEventCard({
  event,
  isExpanded,
  index,
  onToggleExpand,
  onNavigate,
}: TimelineEventCardProps) {
  const { selectDocument } = useAppStore()
  const { t, tCategory } = useI18n()
  const config = EVENT_TYPE_CONFIG[event.type]
  const Icon = config.icon
  const relativeTime = getRelativeTime(event.timestamp)
  const fullTime = formatDateTime(event.timestamp)

  const handleClick = () => {
    if (event.type === 'document' && event.details.documentId) {
      selectDocument({
        id: event.details.documentId,
        patientId: '',
        fileName: event.details.fileName || '',
        filePath: '',
        fileSize: event.details.fileSize || 0,
        mimeType: event.details.mimeType || '',
        title: event.title,
        category: event.details.category || 'General',
        notes: null,
        scannedAt: event.timestamp,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
    } else {
      onToggleExpand()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="relative ps-10 pb-4"
    >
      {/* Timeline dot */}
      <div className={cn(
        'absolute start-[9px] top-4 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 z-10',
        config.dotColor
      )} />

      <motion.div
        whileHover={{ scale: 1.01 }}
        transition={{ duration: 0.15 }}
      >
        <Card className={cn(
          'hover:shadow-md transition-all duration-200 border-s-[3px]',
          config.borderLeft
        )}>
          <CardContent className="p-3 sm:p-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                  config.iconBg
                )}>
                  <Icon className={cn('h-4 w-4', config.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleClick}
                      className={cn(
                        'font-medium text-sm text-gray-900 dark:text-white transition-colors',
                        event.type === 'document' ? 'hover:text-emerald-600 cursor-pointer' : 'hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer'
                      )}
                    >
                      {event.title}
                    </button>
                    {/* Type-specific badges (stored values localize; custom/user-typed values pass through verbatim) */}
                    {renderEventBadges(event, t, tCategory)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1" title={fullTime}>
                      <Clock className="h-3 w-3" />
                      {relativeTime}
                    </span>
                  </div>
                  {!isExpanded && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={onToggleExpand}
              >
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {/* Expanded Details */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <EventDetails event={event} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}

// ─── Event Badges ──────────────────────────────────────────────────────────

function renderEventBadges(
  event: TimelineEvent,
  t: (key: string) => string,
  tCategory: (category: string) => string,
) {
  // Stored-value label: the catalog map localizes standard values; anything
  // user-typed has no catalog entry and passes through verbatim (never
  // machine-localized medical record content).
  const storedLabel = (key: string, fallback: string) => {
    const label = t(key)
    return label === key ? fallback : label
  }
  switch (event.type) {
    case 'visit': {
      const status = event.details.status as string
      const style = VISIT_STATUS_STYLES[status] || VISIT_STATUS_STYLES.scheduled
      return (
        <Badge className={cn('text-[10px] rounded-full', style)}>
          {storedLabel(`visits.status.${status}`, status)}
        </Badge>
      )
    }
    case 'document': {
      const category = event.details.category as string
      return (
        <Badge className={cn('text-[10px] rounded-full', getCategoryColor(category))}>
          {tCategory(category)}
        </Badge>
      )
    }
    case 'prescription': {
      const status = event.details.status as string
      const style = PRESCRIPTION_STATUS_STYLES[status] || PRESCRIPTION_STATUS_STYLES.active
      return (
        <Badge className={cn('text-[10px] rounded-full', style)}>
          {storedLabel(`prescriptions.statusValue.${status}`, status)}
        </Badge>
      )
    }
    case 'note': {
      const category = event.details.category as string
      const style = NOTE_CATEGORY_COLORS[category] || NOTE_CATEGORY_COLORS.General
      return (
        <>
          <Badge className={cn('text-[10px] rounded-full', style)}>
            {storedLabel(`clinical.category.${category}`, category)}
          </Badge>
          {event.details.isPinned && (
            <Pin className="h-3 w-3 text-amber-500" />
          )}
        </>
      )
    }
    case 'annotation': {
      return (
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: event.details.color || '#10b981' }}
          title={t('timeline.annotationColor')}
        />
      )
    }
    default:
      return null
  }
}

// ─── Event Details ─────────────────────────────────────────────────────────

interface EventDetailsProps {
  event: TimelineEvent
}

function EventDetails({ event }: EventDetailsProps) {
  switch (event.type) {
    case 'visit':
      return <VisitDetails event={event} />
    case 'document':
      return <DocumentDetails event={event} />
    case 'prescription':
      return <PrescriptionDetails event={event} />
    case 'note':
      return <NoteDetails event={event} />
    case 'annotation':
      return <AnnotationDetails event={event} />
    default:
      return null
  }
}

function VisitDetails({ event }: EventDetailsProps) {
  const { t } = useI18n()
  const d = event.details
  return (
    <div className="space-y-2">
      {/* Visit type and time */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.type')}:</span> {d.visitType}
        </span>
        {d.visitTime && (
          <span className="text-muted-foreground">
            <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.time')}:</span> {d.visitTime}
          </span>
        )}
      </div>
      {/* Chief complaint */}
      {d.chiefComplaint && (
        <div className="flex items-start gap-2">
          <StickyNote className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('visits.chiefComplaint')}</p>
            <p className="text-xs text-muted-foreground">{d.chiefComplaint}</p>
          </div>
        </div>
      )}
      {/* Diagnosis */}
      {d.diagnosis && (
        <div className="flex items-start gap-2">
          <FileText className="h-3.5 w-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('visits.diagnosis')}</p>
            <p className="text-xs text-muted-foreground">{d.diagnosis}</p>
          </div>
        </div>
      )}
      {/* Follow-up */}
      {d.followUpDate && (
        <div className="flex items-start gap-2">
          <Calendar className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('visits.followUp')}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(d.followUpDate)}
              {d.followUpNotes ? ` — ${d.followUpNotes}` : ''}
            </p>
          </div>
        </div>
      )}
      {/* Full date */}
      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {formatDateTime(event.timestamp)}
      </p>
    </div>
  )
}

function DocumentDetails({ event }: EventDetailsProps) {
  const { t } = useI18n()
  const d = event.details
  const isImage = d.mimeType && IMAGE_TYPES.includes(d.mimeType)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.file')}:</span> {d.fileName}
        </span>
        {d.fileSize && (
          <span className="text-muted-foreground">
            <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.size')}:</span> {formatFileSize(d.fileSize)}
          </span>
        )}
      </div>
      {/* Image thumbnail */}
      {isImage && (
        <div className="mt-1">
          <div className="relative w-full h-32 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800">
            <img
              src={`/api/documents/${d.documentId}/view`}
              alt={d.fileName || 'Document'}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
      {d.notes && (
        <div className="flex items-start gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('patients.notes')}</p>
            <p className="text-xs text-muted-foreground">{d.notes}</p>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {t('timeline.uploaded', { date: formatDateTime(event.timestamp) })}
      </p>
    </div>
  )
}

function PrescriptionDetails({ event }: EventDetailsProps) {
  const { t } = useI18n()
  const d = event.details
  let medications: any[] = []
  try {
    const parsed = JSON.parse(d.medications || '[]')
    medications = Array.isArray(parsed) ? parsed : []
  } catch {
    // ignore
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('prescriptions.medications')}:</span> {d.medicationCount}
        </span>
        <span className="text-muted-foreground">
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('prescriptions.status')}:</span>{' '}
          <Badge className={cn('text-[10px] rounded-full ml-0.5', PRESCRIPTION_STATUS_STYLES[d.status] || PRESCRIPTION_STATUS_STYLES.active)}>
            {d.status}
          </Badge>
        </span>
      </div>
      {/* Medication list */}
      {medications.length > 0 && (
        <div className="space-y-1.5">
          {medications.map((med: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-md px-2.5 py-1.5">
              <Pill className="h-3 w-3 text-amber-600 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 font-medium">{med.name || med.medicineName || 'Unknown'}</span>
              {med.dosage && (
                <span className="text-muted-foreground">— {med.dosage}</span>
              )}
              {med.frequency && (
                <span className="text-muted-foreground">— {med.frequency}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {d.notes && (
        <div className="flex items-start gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('patients.notes')}</p>
            <p className="text-xs text-muted-foreground">{d.notes}</p>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {t('timeline.created', { date: formatDateTime(event.timestamp) })}
      </p>
    </div>
  )
}

function NoteDetails({ event }: EventDetailsProps) {
  const { t } = useI18n()
  const d = event.details
  return (
    <div className="space-y-2">
      {d.isPinned && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <Pin className="h-3 w-3" />
          <span className="font-medium">{t('timeline.pinned')}</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <Badge className={cn('text-[10px] rounded-full', NOTE_CATEGORY_COLORS[d.category] || NOTE_CATEGORY_COLORS.General)}>
          {d.category}
        </Badge>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
        {d.content}
      </p>
      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {formatDateTime(event.timestamp)}
      </p>
    </div>
  )
}

function AnnotationDetails({ event }: EventDetailsProps) {
  const { t } = useI18n()
  const d = event.details
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: d.color || '#10b981' }}
          />
          <span className="text-muted-foreground">
            <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.color')}:</span>
          </span>
        </div>
        {d.page && (
          <span className="text-muted-foreground">
            <span className="font-medium text-gray-700 dark:text-gray-300">{t('timeline.page')}:</span> {d.page}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-rose-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('timeline.annotation')}</p>
          <p className="text-xs text-muted-foreground">{d.content}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-teal-600 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          {t('timeline.onDocument')}: <span className="text-gray-700 dark:text-gray-300">{d.documentName}</span>
        </p>
      </div>
      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {t('timeline.annotated', { date: formatDateTime(event.timestamp) })}
      </p>
    </div>
  )
}
