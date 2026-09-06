'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { formatFileSize } from '@/lib/utils-helpers'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  BarChart3,
  Download,
  TrendingUp,
  FileText,
  PieChart as PieChartIcon,
  HardDrive,
  Calendar,
} from 'lucide-react'

interface AnalyticsData {
  patientsByMonth: { month: string; count: number }[]
  documentsByMonth: { month: string; count: number }[]
  documentsByCategory: { category: string; count: number }[]
  storageByMonth: { month: string; size: number }[]
  recentActivity: { date: string; uploads: number; newPatients: number }[]
}

type TimePeriod = '12months' | '6months' | '30days'

const PERIOD_LABELS: Record<TimePeriod, string> = {
  '12months': 'Last 12 Months',
  '6months': 'Last 6 Months',
  '30days': 'Last 30 Days',
}

const PIE_COLORS = [
  '#10b981', // emerald
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#0ea5e9', // sky
  '#a855f7', // purple
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
]

function getCategoryColor(index: number, isDark: boolean) {
  if (isDark) {
    const darkColors = [
      '#34d399', '#2dd4bf', '#fbbf24', '#38bdf8', '#c084fc',
      '#fb7185', '#22d3ee', '#fb923c', '#818cf8',
    ]
    return darkColors[index % darkColors.length]
  }
  return PIE_COLORS[index % PIE_COLORS.length]
}

function exportCSV(data: Record<string, unknown>[], filename: string) {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const csvContent = [
    headers.join(','),
    ...data.map((row) =>
      headers.map((h) => `"${row[h]}"`).join(',')
    ),
  ].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function CustomTooltip({ active, payload, label, isDark }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; isDark: boolean }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
      <p className={`font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{label}</p>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-xs">{entry.name}: <strong>{entry.value}</strong></span>
        </div>
      ))}
    </div>
  )
}

function StorageTooltip({ active, payload, label, isDark }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; isDark: boolean }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
      <p className={`font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{label}</p>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-xs">{entry.name}: <strong>{formatFileSize(entry.value)}</strong></span>
        </div>
      ))}
    </div>
  )
}

function ActivityHeatmap({ data, isDark }: { data: { date: string; uploads: number; newPatients: number }[]; isDark: boolean }) {
  // Show last 7 days as heatmap grid (7 rows x 4 columns = 28 days)
  const last28 = data.slice(-28)

  const getMaxActivity = () => {
    if (!last28.length) return 1
    return Math.max(...last28.map((d) => d.uploads + d.newPatients), 1)
  }

  const getHeatColor = (value: number) => {
    const max = getMaxActivity()
    const intensity = value / max
    if (intensity === 0) return isDark ? 'bg-gray-800' : 'bg-gray-100'
    if (intensity <= 0.25) return isDark ? 'bg-emerald-900' : 'bg-emerald-100'
    if (intensity <= 0.5) return isDark ? 'bg-emerald-700' : 'bg-emerald-300'
    if (intensity <= 0.75) return isDark ? 'bg-emerald-500' : 'bg-emerald-400'
    return isDark ? 'bg-emerald-400' : 'bg-emerald-600'
  }

  // Arrange 28 days in a 7x4 grid (7 days per row, 4 rows)
  const rows: typeof last28[] = []
  for (let i = 0; i < last28.length; i += 7) {
    rows.push(last28.slice(i, i + 7))
  }

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Last 28 Days</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-1.5 min-w-fit">
          {/* Day labels column */}
          <div className="flex flex-col gap-1.5 pt-5 mr-1">
            {dayLabels.map((day) => (
              <div key={day} className="h-5 flex items-center">
                <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{day}</span>
              </div>
            ))}
          </div>
          {/* Grid columns */}
          {rows.map((row, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-1.5">
              {/* Week header */}
              <div className="h-5 flex items-center justify-center">
                <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  W{colIdx + 1}
                </span>
              </div>
              {/* Day cells */}
              {row.map((day, dayIdx) => {
                const total = day.uploads + day.newPatients
                return (
                  <motion.div
                    key={`${colIdx}-${dayIdx}`}
                    className={`w-5 h-5 rounded-sm ${getHeatColor(total)} cursor-default relative group`}
                    whileHover={{ scale: 1.2 }}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (colIdx * 7 + dayIdx) * 0.02 }}
                  >
                    {/* Tooltip on hover */}
                    <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg ${isDark ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-gray-800 border border-gray-200'}`}>
                      <div className="font-medium">{day.date}</div>
                      <div>{day.uploads} uploads, {day.newPatients} patients</div>
                      <div className={`absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent ${isDark ? 'border-t-gray-700' : 'border-t-gray-200'}`} />
                    </div>
                  </motion.div>
                )
              })}
              {/* Fill empty cells if less than 7 */}
              {Array.from({ length: 7 - row.length }).map((_, i) => (
                <div key={`empty-${colIdx}-${i}`} className="w-5 h-5 rounded-sm bg-transparent" />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 justify-end">
        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
          <div
            key={intensity}
            className={`w-3 h-3 rounded-sm ${getHeatColor(Math.round(intensity * getMaxActivity()))}`}
          />
        ))}
        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>More</span>
      </div>
    </div>
  )
}

interface PieLabelProps {
  cx: number
  cy: number
  midAngle: number
  innerRadius: number
  outerRadius: number
  percent: number
}

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelProps) {
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  if (percent < 0.05) return null
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

const chartVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

export function AnalyticsDashboard() {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const [period, setPeriod] = useState<TimePeriod>('12months')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAnalytics() {
      setLoading(true)
      try {
        const res = await fetch(`/api/stats?period=${period}`)
        if (res.ok) {
          const json = await res.json()
          setData({
            patientsByMonth: json.patientsByMonth || [],
            documentsByMonth: json.documentsByMonth || [],
            documentsByCategory: json.documentsByCategory || [],
            storageByMonth: json.storageByMonth || [],
            recentActivity: json.recentActivity || [],
          })
        }
      } catch (err) {
        console.error('Failed to load analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAnalytics()
  }, [period])

  const handleExportAll = () => {
    if (!data) return
    exportCSV(data.patientsByMonth as unknown as Record<string, unknown>[], 'patients-by-month')
    exportCSV(data.documentsByMonth as unknown as Record<string, unknown>[], 'documents-by-month')
    exportCSV(data.documentsByCategory as unknown as Record<string, unknown>[], 'documents-by-category')
    exportCSV(
      data.storageByMonth.map((d) => ({ ...d, size: formatFileSize(d.size) })) as unknown as Record<string, unknown>[],
      'storage-by-month'
    )
  }

  const textColor = isDark ? '#94a3b8' : '#64748b'
  const gridColor = isDark ? '#1e293b' : '#f1f5f9'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 sm:p-6">
                <Skeleton className="h-5 w-40 mb-4" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Header with period tabs and export */}
      <motion.div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        variants={chartVariants}
        initial="hidden"
        animate="show"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Analytics</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  period === p
                    ? 'bg-white dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportAll}
            className="border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </motion.div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Patient Growth Area Chart */}
        <motion.div variants={chartVariants} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Patient Growth</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.patientsByMonth} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="patientGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={isDark ? 0.4 : 0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={isDark ? 0.05 : 0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip content={<CustomTooltip isDark={isDark} />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Patients"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#patientGradient)"
                    dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: isDark ? '#1e293b' : '#ffffff', strokeWidth: 2, fill: '#10b981' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Documents Bar Chart */}
        <motion.div variants={chartVariants} initial="hidden" animate="show" transition={{ delay: 0.2 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Documents Uploaded</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.documentsByMonth} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip content={<CustomTooltip isDark={isDark} />} />
                  <Bar
                    dataKey="count"
                    name="Documents"
                    fill="#14b8a6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Document Category Pie Chart */}
        <motion.div variants={chartVariants} initial="hidden" animate="show" transition={{ delay: 0.3 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <PieChartIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Document Categories</h3>
              </div>
              {data.documentsByCategory.length > 0 ? (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <ResponsiveContainer width="100%" height={200} className="max-w-[200px]">
                    <PieChart>
                      <Pie
                        data={data.documentsByCategory}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="category"
                        labelLine={false}
                        label={renderCustomLabel}
                      >
                        {data.documentsByCategory.map((_entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={getCategoryColor(index, isDark)}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null
                          const entry = payload[0] as { name: string; value: number; payload: { category: string; count: number } }
                          return (
                            <div className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
                              <span className="font-medium">{entry.payload.category}</span>
                              <span className="ml-2 text-xs">({entry.value} docs)</span>
                            </div>
                          )
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5 max-h-[200px] overflow-y-auto w-full">
                    {data.documentsByCategory.map((cat, idx) => (
                      <div key={cat.category} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: getCategoryColor(idx, isDark) }}
                        />
                        <span className={`text-xs truncate ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {cat.category}
                        </span>
                        <span className={`text-xs font-semibold ml-auto ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {cat.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center">
                  <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No document data yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Storage Growth Area Chart */}
        <motion.div variants={chartVariants} initial="hidden" animate="show" transition={{ delay: 0.4 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Storage Growth</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.storageByMonth} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="storageGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={isDark ? 0.4 : 0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={isDark ? 0.05 : 0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: textColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={45}
                    tickFormatter={(value) => formatFileSize(value)}
                  />
                  <Tooltip content={<StorageTooltip isDark={isDark} />} />
                  <Area
                    type="monotone"
                    dataKey="size"
                    name="Storage"
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    fill="url(#storageGradient)"
                    dot={{ r: 3, fill: '#a855f7', strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: isDark ? '#1e293b' : '#ffffff', strokeWidth: 2, fill: '#a855f7' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Activity Heatmap - Full Width */}
      <motion.div variants={chartVariants} initial="hidden" animate="show" transition={{ delay: 0.5 }}>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Activity Heatmap</h3>
            </div>
            <ActivityHeatmap data={data.recentActivity} isDark={isDark} />
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
