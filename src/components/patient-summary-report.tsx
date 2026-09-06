'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { motion, type Variants } from 'framer-motion'
import {
  FileText,
  Calendar,
  Pill,
  StickyNote,
  HardDrive,
  User,
  Phone,
  Mail,
  MapPin,
  Printer,
  Download,
  Loader2,
  Activity,
  Clock,
  MessageSquare,
} from 'lucide-react'
import { formatFileSize, formatAge } from '@/lib/utils-helpers'
import type { PatientInfo } from '@/store/app-store'

interface PatientSummaryReportProps {
  patient: PatientInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ReportData {
  generatedAt: string
  doctor: { name: string; email: string; specialty: string | null }
  patient: {
    id: string
    firstName: string
    lastName: string
    dateOfBirth: string | null
    phone: string | null
    email: string | null
    address: string | null
    notes: string | null
    createdAt: string
  }
  documents: {
    total: number
    byCategory: Record<string, number>
    totalStorage: number
    latestDocument: any
  }
  visits: {
    total: number
    byStatus: Record<string, number>
    upcoming: number
    nextUpcoming: any
  }
  prescriptions: { total: number; active: number }
  clinicalNotes: { total: number; pinned: number }
  recentActivity: { type: string; content: string; documentName: string; createdAt: string }[]
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
}

export function PatientSummaryReport({ patient, open, onOpenChange }: PatientSummaryReportProps) {
  const { toast } = useToast()
  const [rawReport, setRawReport] = useState<ReportData | null>(null)
  const loading = open && rawReport === null
  const report = open ? rawReport : null

  const fetchIdRef = useRef(0)

  useEffect(() => {
    if (!open) {
      fetchIdRef.current += 1
      return
    }
    const id = fetchIdRef.current
    const controller = new AbortController()
    const fetchReport = async () => {
      try {
        const res = await fetch('/api/reports',  { credentials: 'include',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patientId: patient.id, format: 'json' }),
          signal: controller.signal,
        })
        if (controller.signal.aborted || fetchIdRef.current !== id) return
        if (res.ok) {
          const data = await res.json()
          setRawReport(data)
        } else {
          toast({ title: 'Error', description: 'Failed to generate report', variant: 'destructive' })
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException) || err.name !== 'AbortError') {
          toast({ title: 'Error', description: 'Network error', variant: 'destructive' })
        }
      }
    }
    void fetchReport()
    return () => { controller.abort() }
  }, [open, patient.id, toast])

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPdf = () => {
    window.print()
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin p-0">
        <DialogHeader className="p-6 pb-0 no-print">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            Patient Summary Report
          </DialogTitle>
          <DialogDescription>
            Comprehensive overview for {patient.firstName} {patient.lastName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          {/* Action buttons */}
          <div className="flex gap-2 mb-6 no-print">
            <Button onClick={handlePrint} variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/20">
              <Printer className="h-4 w-4 mr-2" />
              Print Report
            </Button>
            <Button onClick={handleDownloadPdf} className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white">
              <Download className="h-4 w-4 mr-2" />
              Download as PDF
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
              <p className="text-sm text-muted-foreground">Generating report...</p>
            </div>
          ) : report ? (
            <div className="space-y-4" id="report-content">
              {/* Print header - only visible when printing */}
              <div className="print-only mb-6">
                <div className="flex items-center gap-3 border-b-2 border-emerald-500 pb-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center">
                    <span className="text-white font-bold text-lg">M</span>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">MediVault</h1>
                    <p className="text-sm text-gray-500">Patient Summary Report</p>
                  </div>
                  <div className="ml-auto text-right text-sm text-gray-500">
                    <p>Generated: {new Date(report.generatedAt).toLocaleDateString()}</p>
                    <p>Doctor: {report.doctor.name}</p>
                  </div>
                </div>
              </div>

              {/* Patient Info Card */}
              <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
                <Card className="border-l-4 border-l-emerald-500">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <User className="h-4 w-4 text-emerald-600" />
                      Patient Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Full Name</p>
                        <p className="font-medium">{report.patient.firstName} {report.patient.lastName}</p>
                      </div>
                      {report.patient.dateOfBirth && (
                        <div>
                          <p className="text-muted-foreground text-xs">Age</p>
                          <p className="font-medium">{formatAge(report.patient.dateOfBirth)}</p>
                        </div>
                      )}
                      {report.patient.phone && (
                        <div>
                          <p className="text-muted-foreground text-xs flex items-center gap-1"><Phone className="h-3 w-3" />Phone</p>
                          <p className="font-medium">{report.patient.phone}</p>
                        </div>
                      )}
                      {report.patient.email && (
                        <div>
                          <p className="text-muted-foreground text-xs flex items-center gap-1"><Mail className="h-3 w-3" />Email</p>
                          <p className="font-medium">{report.patient.email}</p>
                        </div>
                      )}
                      {report.patient.address && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground text-xs flex items-center gap-1"><MapPin className="h-3 w-3" />Address</p>
                          <p className="font-medium">{report.patient.address}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Document Summary Card */}
              <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
                <Card className="border-l-4 border-l-teal-500">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-teal-600" />
                      Document Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div className="text-center p-3 bg-teal-50 dark:bg-teal-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-teal-700 dark:text-teal-400">{report.documents.total}</p>
                        <p className="text-xs text-muted-foreground mt-1">Total Documents</p>
                      </div>
                      <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{report.documents.byCategory ? Object.keys(report.documents.byCategory).length : 0}</p>
                        <p className="text-xs text-muted-foreground mt-1">Categories</p>
                      </div>
                      <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{formatFileSize(report.documents.totalStorage)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Total Storage</p>
                      </div>
                    </div>
                    {report.documents.byCategory && Object.keys(report.documents.byCategory).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(report.documents.byCategory).map(([cat, count]) => (
                          <Badge key={cat} variant="secondary" className="text-xs">
                            {cat}: {count as number}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Visit Summary Card */}
              <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
                <Card className="border-l-4 border-l-emerald-500">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-emerald-600" />
                      Visit Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{report.visits.total}</p>
                        <p className="text-xs text-muted-foreground mt-1">Total Visits</p>
                      </div>
                      <div className="text-center p-3 bg-teal-50 dark:bg-teal-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-teal-700 dark:text-teal-400">{report.visits.upcoming}</p>
                        <p className="text-xs text-muted-foreground mt-1">Upcoming</p>
                      </div>
                      <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                        <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{report.visits.byStatus?.completed || 0}</p>
                        <p className="text-xs text-muted-foreground mt-1">Completed</p>
                      </div>
                    </div>
                    {report.visits.nextUpcoming && (
                      <div className="mt-3 flex items-center gap-2 text-sm bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3">
                        <Clock className="h-4 w-4 text-emerald-600" />
                        <span className="text-muted-foreground">Next:</span>
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          {new Date(report.visits.nextUpcoming.visitDate).toLocaleDateString()} - {report.visits.nextUpcoming.visitType}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Prescriptions & Notes Row */}
              <div className="grid grid-cols-2 gap-4">
                <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
                  <Card className="border-l-4 border-l-amber-500">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Pill className="h-4 w-4 text-amber-600" />
                        Prescriptions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-2">
                        <p className="text-3xl font-bold text-amber-700 dark:text-amber-400">{report.prescriptions.active}</p>
                        <p className="text-xs text-muted-foreground mt-1">Active Prescriptions</p>
                        <p className="text-xs text-muted-foreground mt-0.5">of {report.prescriptions.total} total</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div custom={4} variants={cardVariants} initial="hidden" animate="visible">
                  <Card className="border-l-4 border-l-purple-500">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-purple-600" />
                        Clinical Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-2">
                        <p className="text-3xl font-bold text-purple-700 dark:text-purple-400">{report.clinicalNotes.pinned}</p>
                        <p className="text-xs text-muted-foreground mt-1">Pinned Notes</p>
                        <p className="text-xs text-muted-foreground mt-0.5">of {report.clinicalNotes.total} total</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>

              {/* Recent Activity Card */}
              {report.recentActivity.length > 0 && (
                <motion.div custom={5} variants={cardVariants} initial="hidden" animate="visible">
                  <Card className="border-l-4 border-l-rose-500">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Activity className="h-4 w-4 text-rose-600" />
                        Recent Annotations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                        {report.recentActivity.slice(0, 10).map((activity, i) => (
                          <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-border last:border-0">
                            <MessageSquare className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-gray-900 dark:text-white truncate">{activity.content}</p>
                              <p className="text-xs text-muted-foreground">on {activity.documentName}</p>
                            </div>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {new Date(activity.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {/* Signature line for print */}
              <div className="print-only mt-8 pt-6 border-t-2 border-gray-300">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-sm text-gray-600">Report generated on {new Date(report.generatedAt).toLocaleString()}</p>
                    <p className="text-sm text-gray-600">MediVault Medical Document Management</p>
                  </div>
                  <div className="text-center">
                    <div className="border-b-2 border-gray-900 w-48 mb-1" />
                    <p className="text-sm font-medium">{report.doctor.name}</p>
                    {report.doctor.specialty && (
                      <p className="text-xs text-gray-500">{report.doctor.specialty}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
