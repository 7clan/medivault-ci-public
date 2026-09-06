'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { useAppStore, type PatientInfo } from '@/store/app-store'
import { formatDateTime } from '@/lib/utils-helpers'
import { motion } from 'framer-motion'
import { Activity, UserPlus, FileUp, Loader2 } from 'lucide-react'

interface TimelineItem {
  type: 'patient_added' | 'document_uploaded'
  patientId: string
  patientName: string
  timestamp: string
  description: string
  documentTitle?: string
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0 },
}

export function ActivityTimeline() {
  const { selectPatient } = useAppStore()
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTimeline = async () => {
      try {
        const res = await fetch('/api/patients?limit=10&sort=recent', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setTimeline(data.timeline || [])
        }
      } catch (err) {
        console.error('Failed to load activity timeline:', err)
      }
      setLoading(false)
    }
    loadTimeline()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  if (timeline.length === 0) {
    return null
  }

  const handleItemClick = (item: TimelineItem) => {
    selectPatient({
      id: item.patientId,
      doctorId: '',
      firstName: item.patientName.split(' ')[0],
      lastName: item.patientName.split(' ').slice(1).join(' '),
      dateOfBirth: null,
      phone: null,
      email: null,
      address: null,
      notes: null,
      createdAt: item.timestamp,
      updatedAt: item.timestamp,
    })
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Activity className="h-5 w-5 text-emerald-600" />
        Activity Timeline
      </h2>
      <motion.div
        className="relative"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {/* Timeline line */}
        <div className="absolute left-5 top-3 bottom-3 w-0.5 bg-emerald-100 dark:bg-emerald-900/50" />

        <div className="space-y-3">
          {timeline.map((item) => (
            <motion.div
              key={`${item.type}-${item.timestamp}-${item.patientId}`}
              variants={itemVariants}
            >
              <Card
                className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-all hover:shadow-sm group"
                onClick={() => handleItemClick(item)}
              >
                <CardContent className="p-3 pl-12 relative">
                  {/* Timeline dot */}
                  <div className="absolute left-3.5 top-4 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 z-10 group-hover:scale-125 transition-transform">
                    <div
                      className={`w-full h-full rounded-full ${
                        item.type === 'patient_added'
                          ? 'bg-emerald-500'
                          : 'bg-teal-500'
                      }`}
                    />
                  </div>

                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        item.type === 'patient_added'
                          ? 'bg-emerald-50 dark:bg-emerald-900/30'
                          : 'bg-teal-50 dark:bg-teal-900/30'
                      }`}
                    >
                      {item.type === 'patient_added' ? (
                        <UserPlus className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <FileUp className="h-4 w-4 text-teal-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {item.patientName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.type === 'patient_added'
                          ? 'Patient record created'
                          : `Uploaded: ${item.documentTitle}`}
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {formatDateTime(item.timestamp)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
