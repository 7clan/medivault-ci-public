'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Clock,
  Stethoscope,
  AlertCircle,
  ClipboardList,
  Zap,
  CheckCircle2,
  XCircle,
  UserX,
  Loader2,
  CalendarPlus,
  Edit3,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  Pill,
  MessageSquare,
} from 'lucide-react'
import { VisitScheduler, type VisitData } from './visit-scheduler'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

const VISIT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'Checkup': Stethoscope,
  'Follow-up': Clock,
  'Consultation': AlertCircle,
  'Emergency': Zap,
  'Procedure': ClipboardList,
}

const VISIT_TYPE_COLORS: Record<string, string> = {
  'Checkup': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  'Follow-up': 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  'Consultation': 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'Emergency': 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'Procedure': 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
}

const STATUS_STYLES: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'completed': { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300', icon: CheckCircle2 },
  'scheduled': { color: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300', icon: Clock },
  'cancelled': { color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', icon: XCircle },
  'no-show': { color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', icon: UserX },
}

interface VisitHistoryProps {
  patientId: string
  patientName: string
  onCreatePrescription?: (visitId: string) => void
}

export function VisitHistory({ patientId, patientName, onCreatePrescription }: VisitHistoryProps) {
  const { toast } = useToast()
  const [visits, setVisits] = useState<VisitData[]>([])
  const [loading, setLoading] = useState(true)
  const [schedulerOpen, setSchedulerOpen] = useState(false)
  const [editVisit, setEditVisit] = useState<VisitData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<VisitData | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [followUpPatientId, setFollowUpPatientId] = useState<string | null>(null)
  const [followUpComplaint, setFollowUpComplaint] = useState('')

  useEffect(() => {
    let cancelled = false
    const fetchVisits = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/visits`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setVisits(data)
        }
      } catch {
        console.error('Failed to load visits')
      }
      if (!cancelled) setLoading(false)
    }
    fetchVisits()
    return () => { cancelled = true }
  }, [patientId])

  const handleMarkComplete = async (visit: VisitData) => {
    try {
      const res = await fetch(`/api/visits/${visit.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (res.ok) {
        const updated = await res.json()
        setVisits((prev) => prev.map((v) => (v.id === visit.id ? updated : v)))
        toast({ title: 'Visit Completed' })
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    }
  }

  const handleCancel = async (visit: VisitData) => {
    try {
      const res = await fetch(`/api/visits/${visit.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (res.ok) {
        const updated = await res.json()
        setVisits((prev) => prev.map((v) => (v.id === visit.id ? updated : v)))
        toast({ title: 'Visit Cancelled' })
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm?.id) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/visits/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        setVisits((prev) => prev.filter((v) => v.id !== deleteConfirm.id))
        toast({ title: 'Visit Deleted' })
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    }
    setDeleting(false)
    setDeleteConfirm(null)
  }

  const handleVisitSaved = (saved: VisitData) => {
    if (editVisit) {
      setVisits((prev) => prev.map((v) => (v.id === saved.id ? saved : v)))
    } else {
      setVisits((prev) => [saved, ...prev])
    }
    setEditVisit(null)
    // Reload visits to ensure consistency
    const fetchVisits = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/visits`)
        if (res.ok) {
          const data = await res.json()
          setVisits(data)
        }
      } catch { /* ignore */ }
    }
    fetchVisits()
  }

  const handleScheduleFollowUp = (visit: VisitData) => {
    setFollowUpPatientId(patientId)
    setFollowUpComplaint(`Follow-up for ${visit.visitType} on ${formatDate(visit.visitDate)}`)
    setSchedulerOpen(true)
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Calendar className="h-4 w-4 text-emerald-600" />
          Visit History
          <Badge variant="secondary" className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
            {visits.length}
          </Badge>
        </h3>
        <Button
          size="sm"
          onClick={() => { setEditVisit(null); setSchedulerOpen(true) }}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
        >
          <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
          Schedule Visit
        </Button>
      </div>

      {visits.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-dashed border-2 border-gray-300 dark:border-gray-700">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <motion.div
                className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mb-3"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ type: 'tween', duration: 3, repeat: Infinity }}
              >
                <Calendar className="h-8 w-8 text-emerald-400" />
              </motion.div>
              <p className="text-sm text-muted-foreground">No visits recorded yet</p>
              <Button
                variant="link"
                size="sm"
                className="mt-1 text-emerald-600"
                onClick={() => { setEditVisit(null); setSchedulerOpen(true) }}
              >
                Schedule first visit
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="relative">
          {/* Gradient Timeline line */}
          <div className="gradient-timeline-line" />

          <AnimatePresence>
            {visits.map((visit, index) => {
              const TypeIcon = VISIT_TYPE_ICONS[visit.visitType] || Stethoscope
              const statusStyle = STATUS_STYLES[visit.status] || STATUS_STYLES['scheduled']
              const StatusIcon = statusStyle.icon
              const isExpanded = expandedId === visit.id

              return (
                <motion.div
                  key={visit.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2, delay: index * 0.04 }}
                  className="relative pl-10 pb-4"
                >
                  {/* Timeline dot with gradient ring */}
                  <div className="absolute left-[7px] top-3">
                    <motion.div
                      className={`w-4 h-4 rounded-full border-[2.5px] ${
                        visit.status === 'completed' ? 'border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-400 to-emerald-600' :
                        visit.status === 'scheduled' ? 'border-sky-200 dark:border-sky-800 bg-gradient-to-br from-sky-400 to-sky-600' :
                        visit.status === 'cancelled' ? 'border-red-200 dark:border-red-800 bg-gradient-to-br from-red-400 to-red-600' : 'border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-400 to-gray-500'
                      } shadow-sm`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, delay: index * 0.04 }}
                    />
                  </div>

                  <Card className={`hover:shadow-md transition-all duration-200 ${
                    visit.status === 'completed' ? 'border-l-[3px] border-l-emerald-500' :
                    visit.status === 'scheduled' ? 'border-l-[3px] border-l-sky-500' :
                    visit.status === 'cancelled' ? 'border-l-[3px] border-l-red-400 opacity-70' :
                    'border-l-[3px] border-l-gray-400 opacity-60'
                  }`}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${VISIT_TYPE_COLORS[visit.visitType] || 'bg-gray-100 text-gray-600'}`}>
                            <TypeIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-900 dark:text-white">
                                {visit.visitType}
                              </span>
                              <Badge className={`text-[10px] rounded-full bg-gradient-to-r ${statusStyle.color}`}>
                                <StatusIcon className="h-3 w-3 mr-0.5" />
                                {visit.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(visit.visitDate)}
                              </span>
                              {visit.visitTime && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {visit.visitTime}
                                </span>
                              )}
                            </div>
                            {visit.chiefComplaint && (
                              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                                {visit.chiefComplaint}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => toggleExpand(visit.id!)}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => { setEditVisit(visit); setSchedulerOpen(true) }}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                            onClick={() => setDeleteConfirm(visit)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Expanded details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
                              {visit.diagnosis && (
                                <div className="flex items-start gap-2">
                                  <FileText className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Diagnosis</p>
                                    <p className="text-xs text-muted-foreground">{visit.diagnosis}</p>
                                  </div>
                                </div>
                              )}
                              {visit.prescription && (
                                <div className="flex items-start gap-2">
                                  <Pill className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Prescription</p>
                                    <p className="text-xs text-muted-foreground">{visit.prescription}</p>
                                  </div>
                                </div>
                              )}
                              {visit.followUpDate && (
                                <div className="flex items-center gap-2">
                                  <CalendarPlus className="h-3.5 w-3.5 text-teal-600 flex-shrink-0" />
                                  <p className="text-xs text-muted-foreground">
                                    Follow-up: {formatDate(visit.followUpDate)}
                                    {visit.followUpNotes ? ` — ${visit.followUpNotes}` : ''}
                                  </p>
                                </div>
                              )}
                              {visit.notes && (
                                <div className="flex items-start gap-2">
                                  <MessageSquare className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Notes</p>
                                    <p className="text-xs text-muted-foreground">{visit.notes}</p>
                                  </div>
                                </div>
                              )}

                              {/* Quick actions */}
                              <div className="flex gap-2 pt-2">
                                {visit.status === 'scheduled' && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                      onClick={() => handleMarkComplete(visit)}
                                    >
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Mark Complete
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 border-red-200 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                      onClick={() => handleCancel(visit)}
                                    >
                                      <XCircle className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                    {onCreatePrescription && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs h-7 border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                        onClick={() => onCreatePrescription(visit.id!)}
                                      >
                                        <Pill className="h-3 w-3 mr-1" />
                                        Create Prescription
                                      </Button>
                                    )}
                                  </>
                                )}
                                {visit.status === 'completed' && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 border-teal-200 dark:border-teal-800 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/20"
                                      onClick={() => handleScheduleFollowUp(visit)}
                                    >
                                      <CalendarPlus className="h-3 w-3 mr-1" />
                                      Schedule Follow-up
                                    </Button>
                                    {onCreatePrescription && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs h-7 border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                        onClick={() => onCreatePrescription(visit.id!)}
                                      >
                                        <Pill className="h-3 w-3 mr-1" />
                                        Create Prescription
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Visit Scheduler Dialog */}
      <VisitScheduler
        open={schedulerOpen}
        onOpenChange={(open) => {
          setSchedulerOpen(open)
          if (!open) { setEditVisit(null); setFollowUpPatientId(null); setFollowUpComplaint('') }
        }}
        patient={followUpPatientId ? { id: patientId, firstName: '', lastName: patientName } as any : undefined}
        editVisit={editVisit}
        onSaved={handleVisitSaved}
        defaultComplaint={followUpComplaint || undefined}
        prefillPatientId={followUpPatientId || patientId}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Visit</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {deleteConfirm?.visitType || ''} visit on {deleteConfirm ? formatDate(deleteConfirm.visitDate) : ''}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
