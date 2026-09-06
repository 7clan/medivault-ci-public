'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDateTime } from '@/lib/utils-helpers'
import {
  Pill,
  ChevronDown,
  ChevronUp,
  Printer,
  CheckCircle2,
  XCircle,
  Trash2,
  Loader2,
  Clock,
} from 'lucide-react'
import { PrescriptionPrint, type PrescriptionPrintData } from './prescription-print'

export interface PrescriptionCardData {
  id: string
  patientId: string
  doctorId: string
  visitId?: string | null
  medications: string // JSON
  notes?: string | null
  status: string
  createdAt: string
  updatedAt: string
  patient?: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; phone: string | null; address: string | null }
  doctor?: { id: string; name: string; phone: string | null; specialty: string | null }
}

interface PrescriptionCardProps {
  prescription: PrescriptionCardData
  onStatusChange?: (id: string, status: string) => void
  onDelete?: (id: string) => void
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  active: {
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    icon: Pill,
  },
  discontinued: {
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    icon: XCircle,
  },
  completed: {
    color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    icon: CheckCircle2,
  },
}

function parseMedications(medicationsJson: string): Array<{ name: string; dosage: string; frequency: string; duration: string; instructions: string }> {
  try {
    return JSON.parse(medicationsJson)
  } catch {
    return []
  }
}

export function PrescriptionCard({ prescription, onStatusChange, onDelete }: PrescriptionCardProps) {
  const { toast } = useToast()
  const [expanded, setExpanded] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [printData, setPrintData] = useState<PrescriptionPrintData | null>(null)

  const meds = parseMedications(prescription.medications)
  const statusConfig = STATUS_CONFIG[prescription.status] || STATUS_CONFIG.active
  const StatusIcon = statusConfig.icon

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true)
    try {
      const res = await fetch(`/api/prescriptions/${prescription.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        toast({ title: `Prescription ${newStatus}` })
        onStatusChange?.(prescription.id, newStatus)
      }
    } catch {
      toast({ title: 'Error updating prescription', variant: 'destructive' })
    }
    setUpdating(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/prescriptions/${prescription.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Prescription deleted' })
        onDelete?.(prescription.id)
      }
    } catch {
      toast({ title: 'Error deleting prescription', variant: 'destructive' })
    }
    setDeleting(false)
  }

  const handlePrint = () => {
    const printData: PrescriptionPrintData = {
      prescription,
      medications: meds,
    }
    setPrintData(printData)
  }

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <Card className={`border-l-[3px] transition-all duration-200 ${
          prescription.status === 'active' ? 'border-l-emerald-500 hover:shadow-md' :
          prescription.status === 'discontinued' ? 'border-l-red-400 opacity-70' :
          'border-l-gray-400 opacity-60'
        }`}>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  prescription.status === 'active' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400' :
                  prescription.status === 'discontinued' ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400' :
                  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  <Pill className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 dark:text-white">
                      {meds.length} medication{meds.length !== 1 ? 's' : ''}
                    </span>
                    <Badge className={`text-[10px] rounded-full ${statusConfig.color}`}>
                      <StatusIcon className="h-3 w-3 mr-0.5" />
                      {prescription.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(prescription.createdAt)}
                  </div>
                  {/* Quick medication preview */}
                  <div className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                    {meds.map((m) => `${m.name} ${m.dosage}`).join(' • ')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handlePrint}
                  title="Print"
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
                {prescription.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                    onClick={() => handleStatusChange('completed')}
                    disabled={updating}
                    title="Mark Complete"
                  >
                    {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
                {prescription.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                    onClick={() => handleStatusChange('discontinued')}
                    disabled={updating}
                    title="Discontinue"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Delete"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            {/* Expanded medication details */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
                    {meds.map((med, idx) => (
                      <div key={idx} className="bg-gray-50 dark:bg-gray-800/50 rounded-md p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-900 dark:text-white">{med.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{med.dosage}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>{med.frequency}</span>
                          <span>•</span>
                          <span>{med.duration}</span>
                        </div>
                        {med.instructions && (
                          <p className="text-muted-foreground italic">{med.instructions}</p>
                        )}
                      </div>
                    ))}
                    {prescription.notes && (
                      <div className="text-xs text-muted-foreground mt-2 p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-md">
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">Notes: </span>
                        {prescription.notes}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* Print Preview */}
      {printData && (
        <PrescriptionPrint
          data={printData}
          open={!!printData}
          onClose={() => setPrintData(null)}
        />
      )}
    </>
  )
}
