'use client'

import { useState, useEffect } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type PatientInfo } from '@/store/app-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CalendarIcon, Loader2, Stethoscope, Clock, AlertCircle, ClipboardList, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const VISIT_TYPES = [
  { value: 'Checkup', label: 'Checkup', icon: Stethoscope, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  { value: 'Follow-up', label: 'Follow-up', icon: Clock, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300' },
  { value: 'Consultation', label: 'Consultation', icon: AlertCircle, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  { value: 'Emergency', label: 'Emergency', icon: Zap, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300' },
  { value: 'Procedure', label: 'Procedure', icon: ClipboardList, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
]

const VISIT_STATUSES = [
  { value: 'scheduled', label: 'Scheduled', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  { value: 'no-show', label: 'No-show', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
]

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let h = 8; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour = h.toString().padStart(2, '0')
      const min = m.toString().padStart(2, '0')
      slots.push(`${hour}:${min}`)
    }
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

export interface VisitData {
  id?: string
  patientId: string
  doctorId?: string
  visitDate: string
  visitTime: string | null
  visitType: string
  chiefComplaint: string | null
  diagnosis: string | null
  prescription: string | null
  followUpDate: string | null
  followUpNotes: string | null
  status: string
  notes: string | null
  createdAt?: string
  updatedAt?: string
  patient?: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; phone: string | null }
}

interface VisitSchedulerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient?: PatientInfo | null
  editVisit?: VisitData | null
  onSaved?: (visit: VisitData) => void
  defaultDate?: Date
  defaultComplaint?: string
  prefillPatientId?: string
}

export function VisitScheduler({
  open,
  onOpenChange,
  patient,
  editVisit,
  onSaved,
  defaultDate,
  defaultComplaint,
  prefillPatientId,
}: VisitSchedulerProps) {
  const { toast } = useToast()
  const [patientsList, setPatientsList] = useState<PatientInfo[]>([])
  const [visitDate, setVisitDate] = useState<Date | undefined>(
    editVisit?.visitDate ? new Date(editVisit.visitDate) : defaultDate || new Date()
  )
  const [visitTime, setVisitTime] = useState<string>(editVisit?.visitTime || '09:00')
  const [visitType, setVisitType] = useState<string>(editVisit?.visitType || 'Checkup')
  const [chiefComplaint, setChiefComplaint] = useState<string>(editVisit?.chiefComplaint || defaultComplaint || '')
  const [diagnosis, setDiagnosis] = useState<string>(editVisit?.diagnosis || '')
  const [prescription, setPrescription] = useState<string>(editVisit?.prescription || '')
  const [followUpDate, setFollowUpDate] = useState<Date | undefined>(
    editVisit?.followUpDate ? new Date(editVisit.followUpDate) : undefined
  )
  const [followUpNotes, setFollowUpNotes] = useState<string>(editVisit?.followUpNotes || '')
  const [status, setStatus] = useState<string>(editVisit?.status || 'scheduled')
  const [notes, setNotes] = useState<string>(editVisit?.notes || '')
  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    patient?.id || prefillPatientId || editVisit?.patientId || ''
  )
  const [saving, setSaving] = useState(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [followUpPickerOpen, setFollowUpPickerOpen] = useState(false)
  const isEditing = !!editVisit

  useEffect(() => {
    if (!patient && !editVisit && open) {
      const fetchPatients = async () => {
        try {
          const res = await fetch('/api/patients?limit=100', { credentials: 'include' })
          if (res.ok) {
            const data = await res.json()
            setPatientsList(data.patients || [])
          }
        } catch { /* ignore */ }
      }
      fetchPatients()
    }
  }, [patient, editVisit, open])

  const resetForm = () => {
    setVisitDate(defaultDate || new Date())
    setVisitTime('09:00')
    setVisitType('Checkup')
    setChiefComplaint(defaultComplaint || '')
    setDiagnosis('')
    setPrescription('')
    setFollowUpDate(undefined)
    setFollowUpNotes('')
    setStatus('scheduled')
    setNotes('')
    if (!patient && !prefillPatientId) {
      setSelectedPatientId('')
    }
  }

  const handleSave = async () => {
    const targetPatientId = patient?.id || prefillPatientId || selectedPatientId
    if (!targetPatientId) {
      toast({ title: 'Select a patient', variant: 'destructive' })
      return
    }
    if (!visitDate) {
      toast({ title: 'Select a date', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const body = {
        patientId: targetPatientId,
        visitDate: visitDate.toISOString().split('T')[0],
        visitTime: visitTime || null,
        visitType,
        chiefComplaint: chiefComplaint || null,
        diagnosis: diagnosis || null,
        prescription: prescription || null,
        followUpDate: followUpDate ? followUpDate.toISOString().split('T')[0] : null,
        followUpNotes: followUpNotes || null,
        status,
        notes: notes || null,
      }

      const url = isEditing ? `/api/visits/${editVisit!.id}` : '/api/visits'
      const res = await fetch(url,  { credentials: 'include',
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const saved = await res.json()
        toast({
          title: isEditing ? 'Visit Updated' : 'Visit Scheduled',
          description: isEditing ? 'Changes have been saved.' : `${visitType} scheduled successfully.`,
        })
        onSaved?.(saved)
        resetForm()
        onOpenChange(false)
      } else {
        const err = await res.json()
        toast({ title: err.error || 'Failed to save visit', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save visit.', variant: 'destructive' })
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <CalendarIcon className="h-4 w-4 text-white" />
            </div>
            {isEditing ? 'Edit Visit' : 'Schedule Visit'}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update visit details below.' : 'Schedule a new patient visit.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {!patient && !prefillPatientId && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Patient *</Label>
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a patient" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {patientsList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(patient || editVisit?.patient) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
              <Stethoscope className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {patient
                  ? `${patient.firstName} ${patient.lastName}`
                  : editVisit?.patient
                    ? `${editVisit.patient.firstName} ${editVisit.patient.lastName}`
                    : ''}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">Visit Date *</Label>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !visitDate && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {visitDate ? visitDate.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  }) : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={visitDate}
                  onSelect={(d) => { setVisitDate(d); setDatePickerOpen(false) }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Time</Label>
            <Select value={visitTime} onValueChange={setVisitTime}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {TIME_SLOTS.map((slot) => (
                  <SelectItem key={slot} value={slot}>
                    {slot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Visit Type *</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VISIT_TYPES.map((type) => {
                const Icon = type.icon
                return (
                  <motion.button
                    key={type.value}
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setVisitType(type.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200',
                      visitType === type.value
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm'
                        : 'border-transparent bg-gray-50 dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700',
                    )}
                  >
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', type.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn(
                      'text-xs font-medium',
                      visitType === type.value
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-gray-600 dark:text-gray-400',
                    )}>
                      {type.label}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Chief Complaint</Label>
            <Textarea
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Reason for visit..."
              rows={2}
              className="resize-none"
            />
          </div>

          {isEditing && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Status</Label>
              <div className="flex flex-wrap gap-2">
                {VISIT_STATUSES.map((s) => (
                  <motion.button
                    key={s.value}
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setStatus(s.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border',
                      status === s.value
                        ? `${s.color} border-current/20 ring-2 ring-current/10`
                        : 'bg-gray-50 dark:bg-gray-900 text-gray-500 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
                    )}
                  >
                    {s.label}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {(isEditing || status === 'completed') && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Diagnosis</Label>
              <Textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="Diagnosis notes..."
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          {(isEditing || status === 'completed') && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Prescription</Label>
              <Textarea
                value={prescription}
                onChange={(e) => setPrescription(e.target.value)}
                placeholder="Prescription details..."
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">Follow-up Date</Label>
            <Popover open={followUpPickerOpen} onOpenChange={setFollowUpPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !followUpDate && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {followUpDate ? followUpDate.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  }) : 'No follow-up scheduled'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={followUpDate}
                  onSelect={(d) => { setFollowUpDate(d); setFollowUpPickerOpen(false) }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {followUpDate && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Follow-up Notes</Label>
              <Textarea
                value={followUpNotes}
                onChange={(e) => setFollowUpNotes(e.target.value)}
                placeholder="Notes for follow-up visit..."
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">Additional Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false) }}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !visitDate}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isEditing ? 'Save Changes' : 'Schedule Visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
