'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { getCategoryColor } from '@/lib/utils-helpers'
import { BarChart3 } from 'lucide-react'

interface CategoryBreakdown {
  category: string
  count: number
}

interface StatsChartsProps {
  categoryBreakdown?: CategoryBreakdown[]
}

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
  }
  return gradients[category] || 'from-gray-400 to-gray-500'
}

function getBarBgDotClass(category: string): string {
  const dots: Record<string, string> = {
    'General': 'bg-gray-300 dark:bg-gray-700',
    'Lab Results': 'bg-emerald-300 dark:bg-emerald-800',
    'Prescription': 'bg-amber-300 dark:bg-amber-800',
    'X-Ray': 'bg-sky-300 dark:bg-sky-800',
    'MRI/CT': 'bg-purple-300 dark:bg-purple-800',
    'Referral': 'bg-rose-300 dark:bg-rose-800',
    'Insurance': 'bg-teal-300 dark:bg-teal-800',
    'Identity': 'bg-orange-300 dark:bg-orange-800',
    'Consent Form': 'bg-indigo-300 dark:bg-indigo-800',
  }
  return dots[category] || 'bg-gray-300 dark:bg-gray-700'
}

export function StatsCharts({ categoryBreakdown }: StatsChartsProps) {
  const topCategories = useMemo(
    () => (categoryBreakdown || []).slice(0, 5),
    [categoryBreakdown]
  )
  const maxCount = useMemo(
    () => Math.max(...topCategories.map((c) => c.count), 1),
    [topCategories]
  )

  if (!categoryBreakdown || categoryBreakdown.length === 0) return null

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Document Categories
          </h2>
        </div>

        <div className="space-y-3">
          {topCategories.map((cat, index) => {
            const widthPercent = (cat.count / maxCount) * 100
            return (
              <div key={cat.category} className="flex items-center gap-3">
                {/* Label */}
                <div className="w-28 sm:w-32 flex-shrink-0 text-right">
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate block">
                    {cat.category}
                  </span>
                </div>

                {/* Bar container */}
                <div className="flex-1 min-w-0">
                  <div className="h-7 sm:h-8 rounded-md bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                    {/* Background dots pattern */}
                    <div className={`absolute inset-0 opacity-20 ${getBarBgDotClass(cat.category)}`} style={{
                      backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
                      backgroundSize: '6px 6px',
                    }} />
                    {/* Animated bar */}
                    <motion.div
                      className={`h-full rounded-md bg-gradient-to-r ${getBarGradientClass(cat.category)} relative`}
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPercent}%` }}
                      transition={{
                        duration: 0.8,
                        delay: index * 0.12,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    >
                      {/* Shimmer effect */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{
                          duration: 2,
                          delay: 0.8 + index * 0.12,
                          ease: 'easeInOut',
                        }}
                      />
                    </motion.div>
                  </div>
                </div>

                {/* Count */}
                <motion.span
                  className="w-10 sm:w-12 flex-shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 + index * 0.12 }}
                >
                  {cat.count}
                </motion.span>
              </div>
            )
          })}
        </div>

        {/* Legend dots */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {topCategories.map((cat) => (
            <div key={cat.category} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-sm ${getCategoryColor(cat.category).split(' ')[0]}`} />
              <span className="text-xs text-muted-foreground">{cat.category}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
