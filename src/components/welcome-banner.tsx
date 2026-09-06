'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Sparkles,
  UserPlus,
  Camera,
  Upload,
  X,
  ChevronRight,
  Download,
  Zap,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'

interface TipStep {
  icon: typeof UserPlus
  title: string
  description: string
  action: string
  color: string
  gradient: string
  gradientDark: string
}

const tips: TipStep[] = [
  {
    icon: UserPlus,
    title: 'Add Your First Patient',
    description: 'Create patient profiles to start organizing their medical documents',
    action: 'add-patient',
    color: 'emerald',
    gradient: 'from-emerald-500/10 via-teal-500/5 to-transparent',
    gradientDark: 'from-emerald-500/15 via-teal-500/8 to-transparent',
  },
  {
    icon: Camera,
    title: 'Scan Documents with Camera',
    description: 'Use your device camera to capture prescriptions, lab results, and more',
    action: 'scan-capture',
    color: 'teal',
    gradient: 'from-teal-500/10 via-cyan-500/5 to-transparent',
    gradientDark: 'from-teal-500/15 via-cyan-500/8 to-transparent',
  },
  {
    icon: Upload,
    title: 'Upload Existing Files',
    description: 'Import PDFs, images, and other medical documents from your device',
    action: 'add-patient',
    color: 'amber',
    gradient: 'from-amber-500/10 via-orange-500/5 to-transparent',
    gradientDark: 'from-amber-500/15 via-orange-500/8 to-transparent',
  },
  {
    icon: Download,
    title: 'Create Regular Backups',
    description: 'Export all data as ZIP for USB/CD storage and disaster recovery',
    action: 'backup',
    color: 'purple',
    gradient: 'from-purple-500/10 via-violet-500/5 to-transparent',
    gradientDark: 'from-purple-500/15 via-violet-500/8 to-transparent',
  },
]

function getStepColor(color: string) {
  const map: Record<string, { bg: string; text: string; ring: string; iconBg: string }> = {
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600', ring: 'ring-emerald-200 dark:ring-emerald-800', iconBg: 'bg-emerald-100 dark:bg-emerald-900/50' },
    teal: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-600', ring: 'ring-teal-200 dark:ring-teal-800', iconBg: 'bg-teal-100 dark:bg-teal-900/50' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-600', ring: 'ring-amber-200 dark:ring-amber-800', iconBg: 'bg-amber-100 dark:bg-amber-900/50' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-600', ring: 'ring-purple-200 dark:ring-purple-800', iconBg: 'bg-purple-100 dark:bg-purple-900/50' },
  }
  return map[color] || map.emerald
}

function getIconAnimation(color: string) {
  switch (color) {
    case 'emerald': return { y: [0, -3, 0], rotate: [0, 3] }
    case 'teal': return { scale: [1, 1.1, 1], rotate: [0, 0, 0] }
    case 'amber': return { y: [0, -2, 0], x: [0, 2, 0] }
    case 'purple': return { rotate: [0, 5], scale: [1, 1.05, 1] }
    default: return { y: [0, -3, 0] }
  }
}

export function WelcomeBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('medivault-welcome-dismissed') === 'true'
  })
  const [currentStep, setCurrentStep] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [showSparkle, setShowSparkle] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { setCurrentView, setScanTargetPatientId } = useAppStore()

  useEffect(() => {
    if (dismissed || isPaused) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      return
    }
    timerRef.current = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % tips.length)
      setTimerKey((k) => k + 1)
    }, 6000)
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [dismissed, isPaused])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    if (typeof window !== 'undefined') {
      localStorage.setItem('medivault-welcome-dismissed', 'true')
    }
  }, [])

  const handleAction = useCallback((action: string) => {
    switch (action) {
      case 'add-patient':
        window.dispatchEvent(new CustomEvent('medivault:add-patient'))
        break
      case 'scan-capture':
        setScanTargetPatientId(null)
        setCurrentView('scan-capture')
        break
      case 'backup':
        setCurrentView('settings')
        break
    }
    handleDismiss()
  }, [setCurrentView, setScanTargetPatientId, handleDismiss])

  const triggerSparkle = () => {
    setShowSparkle(true)
    setTimeout(() => setShowSparkle(false), 800)
  }

  if (dismissed) return null

  const step = tips[currentStep]
  const colors = getStepColor(step.color)
  const iconAnim = getIconAnimation(step.color)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30, scale: 0.95, filter: 'blur(4px)' }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <Card className={`border-0 overflow-hidden relative ${colors.bg}`}>
          <div className={`absolute inset-0 bg-gradient-to-r ${step.gradient} dark:${step.gradientDark} pointer-events-none`} />
          <CardContent className="p-4 md:p-5 relative">
            <div className="flex items-start gap-4">
              <motion.div
                key={currentStep}
                initial={{ scale: 0.5, opacity: 0, rotate: -15 }}
                animate={{ scale: 1, opacity: 1, rotate: 0, ...iconAnim }}
                transition={{ duration: 0.5, type: 'spring', stiffness: 200, damping: 15 }}
                className={`w-12 h-12 rounded-xl ${colors.iconBg} flex items-center justify-center flex-shrink-0 ring-2 ${colors.ring}`}
              >
                <step.icon className={`h-6 w-6 ${colors.text}`} />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Sparkles className={`h-3.5 w-3.5 ${colors.text}`} />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Getting Started — Tip {currentStep + 1} of {tips.length}
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  <motion.h3
                    key={`title-${currentStep}`}
                    className="text-base font-semibold text-gray-900 dark:text-white"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.25 }}
                  >
                    {step.title}
                  </motion.h3>
                </AnimatePresence>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`desc-${currentStep}`}
                    className="text-sm text-muted-foreground mt-0.5"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.25, delay: 0.05 }}
                  >
                    {step.description}
                  </motion.p>
                </AnimatePresence>
                <div className="flex items-center gap-2 mt-3">
                  {tips.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setCurrentStep(idx); setTimerKey((k) => k + 1) }}
                      className="relative h-2 rounded-full overflow-hidden transition-all duration-500"
                      style={{ width: idx === currentStep ? '24px' : '8px' }}
                    >
                      <motion.div
                        className={`absolute inset-0 rounded-full transition-colors duration-300 ${
                          idx === currentStep ? 'bg-emerald-500' : idx < currentStep ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        layout
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    </button>
                  ))}
                  {!isPaused && (
                    <motion.div
                      key={timerKey}
                      className="h-0.5 bg-emerald-400/50 rounded-full"
                      style={{ width: '24px', originX: 0 }}
                      initial={{ scaleX: 1 }}
                      animate={{ scaleX: 0 }}
                      transition={{ duration: 6, ease: 'linear' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 relative">
                <AnimatePresence>
                  {showSparkle && [0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={`sparkle-${i}`}
                      className="absolute w-1.5 h-1.5 rounded-full pointer-events-none"
                      style={{
                        backgroundColor: ['#10b981', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899'][i],
                        left: `${20 + (i * 15)}%`,
                        top: '50%',
                      }}
                      initial={{ y: 0, x: 0, scale: 0, opacity: 1 }}
                      animate={{
                        y: -20 - (i * 5),
                        x: (i % 2 === 0 ? -8 : 8) * (i + 1),
                        scale: [0, 1.2, 0],
                        opacity: [0, 1, 0],
                        rotate: [0, 180 * (i % 2 === 0 ? 1 : -1)],
                      }}
                      transition={{ duration: 0.6 + i * 0.1, ease: 'easeOut' }}
                    />
                  ))}
                </AnimatePresence>
                <Button
                  size="sm"
                  onClick={() => { triggerSparkle(); handleAction(step.action) }}
                  className={`${colors.text} hover:bg-white/60 dark:hover:bg-white/10 transition-colors duration-200 relative overflow-hidden`}
                >
                  {step.action === 'add-patient' ? 'Add Patient' : step.action === 'scan-capture' ? 'Start Scanning' : 'Go to Settings'}
                  <Zap className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setCurrentStep((currentStep + 1) % tips.length); setTimerKey((k) => k + 1) }}
                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                  title="Next tip"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDismiss}
                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  )
}
