'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatFileSize, formatDateTime, getCategoryColor } from '@/lib/utils-helpers'
import type { PatientInfo, DocumentInfo } from '@/store/app-store'
import {
  FileText,
  HardDrive,
  Clock,
  Tag,
  TrendingUp,
  Activity,
} from 'lucide-react'

interface PatientHealthSummaryProps {
  patient: PatientInfo
  documents: DocumentInfo[]
}

// Storage reference max (500 MB)
const STORAGE_MAX_BYTES = 500 * 1024 * 1024

function getBarGradientClass(category: string): string {
  const gradients: Record<string, string> = {
    'General': 'from-gray-400 to-gray-500',
    'Lab Results': 'from-emerald-400 to-emerald-500',
    'Prescription': 'from-amber-400 to-amber-500',
    'X-Ray': 'from-sky-400 to-sky-500',
    'MRI/CT': 'from-purple-400 to-purple-500',
    'Referral': 'from-rose-400 to-rose-500',
    'Insurance': 'from-teal-400 to-teal-500',
    'Identity': 'from-orange-400 to-orange-500',
    'Consent Form': 'from-indigo-400 to-indigo-500',
    'Imaging': 'from-cyan-400 to-cyan-500',
  }
  return gradients[category] || 'from-gray-400 to-gray-500'
}

function getBarTrackClass(category: string): string {
  const tracks: Record<string, string> = {
    'General': 'bg-gray-100 dark:bg-gray-800',
    'Lab Results': 'bg-emerald-50 dark:bg-emerald-900/40',
    'Prescription': 'bg-amber-50 dark:bg-amber-900/40',
    'X-Ray': 'bg-sky-50 dark:bg-sky-900/40',
    'MRI/CT': 'bg-purple-50 dark:bg-purple-900/40',
    'Referral': 'bg-rose-50 dark:bg-rose-900/40',
    'Insurance': 'bg-teal-50 dark:bg-teal-900/40',
    'Identity': 'bg-orange-50 dark:bg-orange-900/40',
    'Consent Form': 'bg-indigo-50 dark:bg-indigo-900/40',
    'Imaging': 'bg-cyan-50 dark:bg-cyan-900/40',
  }
  return tracks[category] || 'bg-gray-100 dark:bg-gray-800'
}

// Shared stagger container variants
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.15 },
  },
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
} as const

export function PatientHealthSummary({ patient, documents }: PatientHealthSummaryProps) {
  // ── Derived data ──────────────────────────────────────────────
  const totalStorage = useMemo(
    () => documents.reduce((sum, d) => sum + d.fileSize, 0),
    [documents],
  )

  const storagePercent = useMemo(
    () => Math.min((totalStorage / STORAGE_MAX_BYTES) * 100, 100),
    [totalStorage],
  )

  const lastUploadDate = useMemo(() => {
    if (documents.length === 0) return null
    const sorted = [...documents].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    return sorted[0].createdAt
  }, [documents])

  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const doc of documents) {
      counts[doc.category] = (counts[doc.category] || 0) + 1
    }
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  }, [documents])

  const mostCommonCategory = useMemo(() => {
    if (categoryBreakdown.length === 0) return null
    return categoryBreakdown[0].category
  }, [categoryBreakdown])

  const recentUploads = useMemo(() => {
    return [...documents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
  }, [documents])

  const maxCategoryCount = useMemo(
    () => Math.max(...categoryBreakdown.map((c) => c.count), 1),
    [categoryBreakdown],
  )

  // ── Render ────────────────────────────────────────────────────
  if (documents.length === 0) return null

  return (
    <motion.div
      className="space-y-4"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* ─── 1. Quick Stats Row ───────────────────────────────── */}
      <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-3" variants={itemVariants}>
        {/* Total Docs */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/50">
                <FileText className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Docs</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                  {documents.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Storage */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/50">
                <HardDrive className="h-4.5 w-4.5 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Storage</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                  {formatFileSize(totalStorage)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last Upload */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/50">
                <Clock className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Last Upload</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate">
                  {lastUploadDate ? formatDateTime(lastUploadDate).split(',')[0] : '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Most Common Category */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/50">
                <Tag className="h-4.5 w-4.5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Top Category</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate">
                  {mostCommonCategory || '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 2 & 3. Storage Indicator with Circular Progress ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    Storage Used
                  </span>
                </div>
                <div className="relative">
                  <Progress
                    value={storagePercent}
                    className="h-2.5 bg-gray-100 dark:bg-gray-800 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500"
                  />
                  {/* Glow accent on the progress fill */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full pointer-events-none"
                    style={{
                      width: `${storagePercent}%`,
                      boxShadow: '0 0 8px 2px rgba(16,185,129,0.25)',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {formatFileSize(totalStorage)} of {formatFileSize(STORAGE_MAX_BYTES)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {storagePercent >= 90
                    ? '⚠ Storage almost full. Consider archiving older documents.'
                    : storagePercent >= 60
                      ? `${Math.round(storagePercent)}% used — ample space remaining.`
                      : `${Math.round(storagePercent)}% used`}
                </p>
              </div>
              {/* Circular progress gauge */}
              <div className="relative w-20 h-20 flex-shrink-0 ml-4">
                <svg width="80" height="80" viewBox="0 0 96 96" className="-rotate-90">
                  <circle
                    cx="48" cy="48" r="40"
                    fill="none"
                    stroke="oklch(0.922 0.01 85)"
                    strokeWidth="7"
                    className="dark:stroke-gray-800"
                  />
                  <motion.circle
                    cx="48" cy="48" r="40"
                    fill="none"
                    stroke="url(#storageGradient)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 40}
                    initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 40 - (storagePercent / 100) * 2 * Math.PI * 40 }}
                    transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                  />
                  <defs>
                    <linearGradient id="storageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <motion.span
                    className="text-sm font-bold text-gray-900 dark:text-white"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                  >
                    {Math.round(storagePercent)}
                  </motion.span>
                  <span className="text-[9px] text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 4. Document Category Distribution ───────────────── */}
      <motion.div variants={itemVariants}>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Document Distribution
              </h3>
            </div>

            <div className="space-y-2">
              {categoryBreakdown.slice(0, 6).map((cat, index) => {
                const widthPercent = (cat.count / maxCategoryCount) * 100
                return (
                  <div key={cat.category} className="flex items-center gap-2.5">
                    {/* Label */}
                    <span
                      className={`w-24 sm:w-28 flex-shrink-0 text-xs font-medium text-gray-600 dark:text-gray-400 truncate text-right`}
                    >
                      {cat.category}
                    </span>

                    {/* Bar with gradient fill */}
                    <div className={`flex-1 min-w-0 h-5 rounded-md overflow-hidden relative ${getBarTrackClass(cat.category)}`}>
                      <motion.div
                        className={`h-full rounded-md bg-gradient-to-r ${getBarGradientClass(cat.category)} relative overflow-hidden`}
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPercent}%` }}
                        transition={{
                          duration: 0.7,
                          delay: index * 0.08,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                      >
                        {/* Subtle shimmer effect */}
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{
                            duration: 2,
                            delay: 0.7 + index * 0.08,
                            ease: 'easeInOut',
                          }}
                        />
                      </motion.div>
                    </div>

                    {/* Count badge */}
                    <motion.span
                      className="w-8 flex-shrink-0 text-right text-xs font-bold text-gray-700 dark:text-gray-300"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 + index * 0.08 }}
                    >
                      {cat.count}
                    </motion.span>
                  </div>
                )
              })}
            </div>

            {/* Color legend */}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {categoryBreakdown.slice(0, 6).map((cat) => (
                <div key={cat.category} className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${getCategoryColor(cat.category).split(' ')[0]}`}
                  />
                  <span className="text-[10px] text-muted-foreground">{cat.category}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 5. Activity Timeline ────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Recent Activity
              </h3>
            </div>

            <div className="relative pl-5">
              {/* Vertical line */}
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-emerald-300 via-teal-300 to-teal-300/20 dark:from-emerald-700 dark:via-teal-700 dark:to-teal-700/20" />

              <div className="space-y-3">
                {recentUploads.map((doc, index) => (
                  <motion.div
                    key={doc.id}
                    className="relative flex items-start gap-3"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.08, duration: 0.35 }}
                  >
                    {/* Timeline dot */}
                    <div className="absolute -left-5 top-1.5 flex items-center justify-center">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${getCategoryColor(doc.category).split(' ')[0]}`}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {doc.title || doc.fileName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(doc.createdAt)}
                        </span>
                        <span
                          className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium ${getCategoryColor(doc.category)}`}
                        >
                          {doc.category}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
