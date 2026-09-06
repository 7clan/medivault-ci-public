'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { motion } from 'framer-motion'
import { formatDate } from '@/lib/utils-helpers'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Printer,
  X,
  Pill,
  Clock,
  Infinity,
  ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PrescriptionPrintData {
  prescription: {
    id: string
    patientId: string
    medications: string
    notes?: string | null
    status: string
    createdAt: string
    patient?: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; phone: string | null; address: string | null }
    doctor?: { id: string; name: string; phone: string | null; specialty: string | null }
  }
  medications: Array<{ name: string; dosage: string; frequency: string; duration: string; instructions: string }>
}

interface PrescriptionPrintProps {
  data: PrescriptionPrintData
  open: boolean
  onClose: () => void
}

export function PrescriptionPrint({ data, open, onClose }: PrescriptionPrintProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const { prescription, medications } = data
  const patient = prescription.patient
  const doctor = prescription.doctor

  // Compute medication summary stats
  const ongoingCount = medications.filter((m) => m.duration === 'Ongoing').length
  const shortTermCount = medications.length - ongoingCount

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Prescription - ${patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 40px;
            color: #1a1a1a;
            position: relative;
          }
          body::before {
            content: 'MediVault';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 80px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.04);
            pointer-events: none;
            white-space: nowrap;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #10b981;
            padding-bottom: 20px;
            margin-bottom: 24px;
          }
          .doctor-info h1 {
            font-size: 22px;
            font-weight: 700;
            color: #065f46;
            margin-bottom: 4px;
          }
          .doctor-info p {
            font-size: 13px;
            color: #666;
            margin: 2px 0;
          }
          .prescription-title {
            text-align: right;
          }
          .prescription-title h2 {
            font-size: 18px;
            font-weight: 600;
            color: #059669;
            margin-bottom: 4px;
          }
          .prescription-title p {
            font-size: 12px;
            color: #888;
          }
          .patient-section {
            display: flex;
            justify-content: space-between;
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 16px;
          }
          .patient-section .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #059669;
            font-weight: 600;
            margin-bottom: 6px;
          }
          .patient-section .value {
            font-size: 14px;
            color: #1a1a1a;
            font-weight: 500;
          }
          .patient-section .value p {
            margin: 2px 0;
          }
          .medication-summary {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
          }
          .medication-summary .stat {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 10px 16px;
            text-align: center;
            min-width: 100px;
          }
          .medication-summary .stat .stat-value {
            font-size: 22px;
            font-weight: 700;
            color: #059669;
          }
          .medication-summary .stat .stat-label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          .medications-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          .medications-table thead th {
            background: #059669;
            color: white;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 12px 12px;
            text-align: left;
            font-weight: 600;
          }
          .medications-table thead th:first-child {
            border-radius: 8px 0 0 0;
            width: 36px;
          }
          .medications-table thead th:last-child {
            border-radius: 0 8px 0 0;
          }
          .medications-table tbody td {
            padding: 12px 12px;
            font-size: 13px;
            border-bottom: 1px solid #e5e7eb;
            vertical-align: top;
          }
          .medications-table tbody tr:last-child td {
            border-bottom: none;
          }
          .medications-table tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          .med-name {
            font-weight: 600;
            color: #1a1a1a;
          }
          .med-name + .med-dosage {
            display: block;
            font-size: 11px;
            color: #059669;
            font-weight: 500;
            margin-top: 2px;
          }
          .med-instructions {
            font-style: italic;
            color: #6b7280;
            max-width: 200px;
            line-height: 1.4;
          }
          .med-duration-ongoing {
            display: inline-block;
            background: #dbeafe;
            color: #1d4ed8;
            padding: 2px 8px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 600;
          }
          .med-duration-limited {
            color: #374151;
          }
          .notes-section {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 24px;
          }
          .notes-section .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #d97706;
            font-weight: 600;
            margin-bottom: 6px;
          }
          .notes-section .value {
            font-size: 13px;
            color: #4a4a4a;
            line-height: 1.5;
          }
          .signature-section {
            display: flex;
            justify-content: flex-end;
            align-items: flex-end;
            margin-top: 40px;
            padding-top: 20px;
          }
          .signature-line {
            text-align: center;
          }
          .signature-line .line {
            width: 200px;
            border-bottom: 1px solid #333;
            margin-bottom: 6px;
          }
          .signature-line .label {
            font-size: 11px;
            color: #666;
          }
          .footer {
            margin-top: 30px;
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            font-size: 10px;
            color: #999;
          }
          @media print {
            body { padding: 20px; }
          }
          @media (max-width: 600px) {
            .medications-table thead th,
            .medications-table tbody td {
              padding: 8px 6px;
              font-size: 11px;
            }
            .medication-summary .stat {
              min-width: 80px;
              padding: 8px 10px;
            }
            .medication-summary .stat .stat-value {
              font-size: 18px;
            }
            .patient-section {
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-emerald-600" />
            Print Prescription
          </DialogTitle>
        </DialogHeader>

        {/* Print Preview */}
        <div
          ref={printRef}
          className="bg-white border border-gray-200 rounded-lg p-6 sm:p-8 shadow-sm relative overflow-hidden"
          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          {/* Watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span className="text-7xl font-bold text-gray-100 -rotate-[30deg] opacity-50">
              MediVault
            </span>
          </div>

          <div className="relative z-10">
            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-emerald-500 pb-4 mb-6">
              <div>
                <h1 className="text-lg font-bold text-emerald-800">
                  {doctor?.name || 'Doctor'}
                </h1>
                {doctor?.specialty && (
                  <p className="text-xs text-gray-500 mt-0.5">{doctor.specialty}</p>
                )}
                {doctor?.phone && (
                  <p className="text-xs text-gray-500">{doctor.phone}</p>
                )}
              </div>
              <div className="text-right">
                <h2 className="text-base font-semibold text-emerald-700">PRESCRIPTION</h2>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(prescription.createdAt)}</p>
                <p className="text-xs text-gray-400">#{prescription.id.slice(0, 8)}</p>
              </div>
            </div>

            {/* Patient Info */}
            <div className="flex flex-wrap justify-between gap-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 mb-4">
              <div className="min-w-[120px]">
                <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Patient</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {patient ? `${patient.firstName} ${patient.lastName}` : 'N/A'}
                </p>
                {patient?.dateOfBirth && (
                  <p className="text-xs text-gray-500">DOB: {patient.dateOfBirth}</p>
                )}
              </div>
              {patient?.phone && (
                <div className="min-w-[100px]">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Phone</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{patient.phone}</p>
                </div>
              )}
              {patient?.address && (
                <div className="min-w-[120px] flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Address</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300">{patient.address}</p>
                </div>
              )}
            </div>

            {/* Medication Summary Stats */}
            {medications.length > 1 && (
              <div className="flex gap-2.5 mb-4">
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-center"
                >
                  <div className="flex items-center justify-center gap-1">
                    <ListChecks className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-lg font-bold text-emerald-600">{medications.length}</span>
                  </div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Total Meds</p>
                </motion.div>
                {ongoingCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="flex-1 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 text-center"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Infinity className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-lg font-bold text-blue-600">{ongoingCount}</span>
                    </div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Ongoing</p>
                  </motion.div>
                )}
                {shortTermCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-center"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-lg font-bold text-amber-600">{shortTermCount}</span>
                    </div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Short-term</p>
                  </motion.div>
                )}
              </div>
            )}

            {/* Medications Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mb-5">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left w-9">#</th>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left min-w-[140px]">Medication</th>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left w-20">Dosage</th>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left min-w-[100px]">Frequency</th>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left w-24">Duration</th>
                    <th className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide font-semibold px-3 py-2.5 text-left min-w-[160px]">Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {medications.map((med, idx) => (
                    <tr
                      key={idx}
                      className={cn(
                        idx % 2 === 0
                          ? 'bg-white dark:bg-gray-900'
                          : 'bg-gray-50 dark:bg-gray-800/40',
                        idx === medications.length - 1 && 'last:rounded-b-lg'
                      )}
                    >
                      <td className="px-3 py-2.5 text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800 font-medium">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
                        <span className="text-xs font-semibold text-gray-900 dark:text-white">{med.name}</span>
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
                        <Badge
                          variant="secondary"
                          className="font-semibold text-[11px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                        >
                          {med.dosage}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">
                        {med.frequency}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
                        {med.duration === 'Ongoing' ? (
                          <Badge className="font-semibold text-[11px] bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                            <Infinity className="h-2.5 w-2.5 mr-0.5" />
                            Ongoing
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-700 dark:text-gray-300">
                            {med.duration}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 italic max-w-[200px]">
                        {med.instructions || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {prescription.notes && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-6">
                <p className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold mb-1">Notes</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{prescription.notes}</p>
              </div>
            )}

            {/* Signature */}
            <div className="flex justify-end mt-8">
              <div className="text-center">
                <div className="w-48 border-b border-gray-400 mb-1" />
                <p className="text-[10px] text-gray-500">Doctor&apos;s Signature</p>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 pt-3 border-t border-gray-100 dark:border-gray-800 text-center">
              <p className="text-[10px] text-gray-400">Generated by MediVault Medical Document Management System</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-1.5" />
            Close
          </Button>
          <Button
            onClick={handlePrint}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
