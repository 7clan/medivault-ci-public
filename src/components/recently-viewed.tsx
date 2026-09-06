'use client'

import { useEffect } from 'react'
import { useAppStore, type PatientInfo } from '@/store/app-store'
import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1 },
}

export function RecentlyViewed() {
  const { recentlyViewed, selectPatient, initRecentlyViewed } = useAppStore()

  // Load from localStorage on mount
  useEffect(() => {
    initRecentlyViewed()
  }, [initRecentlyViewed])

  if (recentlyViewed.length === 0) {
    return null
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-medium text-muted-foreground">Recently Viewed</h3>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {recentlyViewed.map((patient) => (
          <motion.button
            key={patient.id}
            variants={itemVariants}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => selectPatient(patient)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
          >
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50 flex items-center justify-center ring-2 ring-emerald-200/50 dark:ring-emerald-800/50 group-hover:ring-emerald-400 dark:group-hover:ring-emerald-600 transition-all">
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                {patient.firstName[0]}{patient.lastName[0]}
              </span>
            </div>
            <span className="text-xs text-muted-foreground max-w-[72px] truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              {patient.firstName} {patient.lastName}
            </span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}
