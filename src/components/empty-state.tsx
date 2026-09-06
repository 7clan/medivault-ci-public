'use client'

import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* Animated background gradient circle */}
      <div className="relative mb-6">
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-200 via-teal-200 to-cyan-200 dark:from-emerald-900/60 dark:via-teal-900/60 dark:to-cyan-900/60"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ type: 'tween', duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: '7rem', height: '7rem', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        />
        {/* Inner icon container */}
        <motion.div
          className="relative w-20 h-20 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-lg ring-2 ring-emerald-100 dark:ring-emerald-800/50"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ type: 'tween', duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Icon className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          </motion.div>
        </motion.div>
      </div>

      {/* Title */}
      <motion.h3
        className="text-lg font-semibold text-gray-900 dark:text-white mb-1"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        {title}
      </motion.h3>

      {/* Description */}
      <motion.p
        className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        {description}
      </motion.p>

      {/* CTA Button */}
      {actionLabel && onAction && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 200, damping: 18 }}
        >
          <Button
            onClick={onAction}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900/40 hover:shadow-lg hover:shadow-emerald-300/50 dark:hover:shadow-emerald-800/50 transition-shadow duration-200"
          >
            {actionLabel}
          </Button>
        </motion.div>
      )}
    </div>
  )
}
