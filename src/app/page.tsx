'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { LoginForm } from '@/components/login-form'
import { SetupForm } from '@/components/setup-form'
import { AppHeader } from '@/components/app-header'
import { Dashboard } from '@/components/dashboard'
import { PatientDetail } from '@/components/patient-detail'
import { DocumentViewer } from '@/components/document-viewer'
import { ScanCapture } from '@/components/scan-capture'
import { SettingsView } from '@/components/settings-view'
import { KeyboardShortcutsDialog } from '@/components/keyboard-shortcuts-dialog'
import { MobileBottomNav } from '@/components/mobile-bottom-nav'
import { Stethoscope, Heart, Shield, Keyboard, Github, MessageCircle, Newspaper, HeartPulse } from 'lucide-react'
import { QuickActionsFab } from '@/components/quick-actions-fab'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { motion, AnimatePresence } from 'framer-motion'

// Heartbeat SVG path for loading screen
const HeartbeatPath = () => (
  <motion.path
    d="M10 50 L30 50 L40 50 L50 20 L60 80 L70 35 L80 65 L90 45 L100 50 L120 50 L140 50"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="heartbeat-line text-emerald-500"
  />
)

// Letter-by-letter text reveal
const AnimatedTitle = ({ text }: { text: string }) => {
  return (
    <span className="inline-flex">
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.6 + i * 0.06, ease: 'easeOut' }}
          className="inline-block"
        >
          {char}
        </motion.span>
      ))}
    </span>
  )
}

// View transition variants
const viewTransitionVariants = {
  dashboard: {
    initial: { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -40 },
  },
  'patient-detail': {
    initial: { opacity: 0, y: 60 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -30 },
  },
  'document-viewer': {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
  },
  'scan-capture': {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  },
  settings: {
    initial: { opacity: 0, x: -40 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 40 },
  },
}

export default function Home() {
  const currentView = useAppStore((s) => s.currentView)
  const selectedPatient = useAppStore((s) => s.selectedPatient)
  const selectedDocument = useAppStore((s) => s.selectedDocument)
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const setDoctorInfo = useAppStore((s) => s.setDoctorInfo)
  const [sessionChecked, setSessionChecked] = useState(false)

  // Enable keyboard shortcuts in app views
  const isAppView = currentView !== 'login' && currentView !== 'setup'
  useKeyboardShortcuts(isAppView)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/setup')
        const data = await res.json()

        if (!data.needsSetup) {
          const sessionRes = await fetch('/api/auth/me')
          if (sessionRes.ok) {
            const meData = await sessionRes.json()
            if (meData) {
              setDoctorInfo(
                meData.name || meData.email?.split('@')[0] || null,
                meData.email || null,
                meData.id || null
              )
              setCurrentView('dashboard')
              setSessionChecked(true)
              return
            }
          }
          setCurrentView('login')
        } else {
          setCurrentView('setup')
        }
      } catch {
        setCurrentView('login')
      }
      setSessionChecked(true)
    }

    checkSession()
  }, [setCurrentView, setDoctorInfo])

  // Enhanced Loading / Splash Screen
  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
        <div className="text-center space-y-6">
          {/* Floating Stethoscope + Heartbeat */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <motion.div
              className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/40"
              animate={{ y: [0, -8, 0] }}
              transition={{ type: 'tween', duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Stethoscope className="w-10 h-10 text-white" />
            </motion.div>
            {/* Heartbeat line under icon */}
            <div className="mt-3 overflow-hidden">
              <svg viewBox="0 0 150 100" className="w-40 h-8 mx-auto">
                <HeartbeatPath />
              </svg>
            </div>
          </motion.div>

          {/* Letter-by-letter "MediVault" */}
          <div>
            <h1 className="text-3xl font-bold text-gradient-emerald">
              <AnimatedTitle text="MediVault" />
            </h1>
            <motion.p
              className="text-sm text-muted-foreground mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.3, duration: 0.5 }}
            >
              Secure Medical Document Management
            </motion.p>
          </div>

          {/* Pulsing dots */}
          <motion.div
            className="dot-pulse flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.4 }}
          >
            <span />
            <span />
            <span />
          </motion.div>
        </div>
      </div>
    )
  }

  if (currentView === 'login') {
    return <LoginForm />
  }

  if (currentView === 'setup') {
    return <SetupForm />
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <AppHeader />

      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' && (
            <motion.div
              key="view-dashboard"
              initial={viewTransitionVariants.dashboard.initial}
              animate={viewTransitionVariants.dashboard.animate}
              exit={viewTransitionVariants.dashboard.exit}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }}
            >
              <Dashboard />
            </motion.div>
          )}
          {currentView === 'patient-detail' && selectedPatient && (
            <motion.div
              key="view-patient-detail"
              initial={viewTransitionVariants['patient-detail'].initial}
              animate={viewTransitionVariants['patient-detail'].animate}
              exit={viewTransitionVariants['patient-detail'].exit}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }}
            >
              <PatientDetail patient={selectedPatient} />
            </motion.div>
          )}
          {currentView === 'document-viewer' && selectedDocument && (
            <motion.div
              key="view-document-viewer"
              initial={viewTransitionVariants['document-viewer'].initial}
              animate={viewTransitionVariants['document-viewer'].animate}
              exit={viewTransitionVariants['document-viewer'].exit}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
            >
              <DocumentViewer document={selectedDocument} />
            </motion.div>
          )}
          {currentView === 'scan-capture' && (
            <motion.div
              key="view-scan-capture"
              initial={viewTransitionVariants['scan-capture'].initial}
              animate={viewTransitionVariants['scan-capture'].animate}
              exit={viewTransitionVariants['scan-capture'].exit}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }}
            >
              <ScanCapture />
            </motion.div>
          )}
          {currentView === 'settings' && (
            <motion.div
              key="view-settings"
              initial={viewTransitionVariants.settings.initial}
              animate={viewTransitionVariants.settings.animate}
              exit={viewTransitionVariants.settings.exit}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }}
            >
              <SettingsView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile FAB */}
      <QuickActionsFab />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* Enhanced Footer */}
      <footer className="footer-gradient-border bg-white dark:bg-gray-900 py-6 mt-auto pb-20 md:pb-6 bg-dot-pattern">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {/* Top row: branding + features */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <motion.div
                className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm"
                whileHover={{ scale: 1.1, rotate: 5 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              >
                <Stethoscope className="w-3.5 h-3.5 text-white" />
              </motion.div>
              <span className="font-semibold text-emerald-600 text-base">MediVault</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span>Secure Medical Document Management</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Shield className="h-3.5 w-3.5 text-emerald-500" />
                <span>HIPAA Ready</span>
              </div>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <div className="flex items-center gap-1">
                <Heart className="h-3.5 w-3.5 text-rose-400" />
                <span>v1.0</span>
              </div>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <span>All data stored locally</span>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <span>{new Date().getFullYear()}</span>
            </div>
          </div>

          {/* Community / Support links row */}
          <div className="flex items-center justify-center gap-4 mb-4">
            <motion.a
              href="#"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-emerald-600 transition-colors duration-200"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>Community</span>
            </motion.a>
            <span className="text-gray-200 dark:text-gray-800">•</span>
            <motion.a
              href="#"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-emerald-600 transition-colors duration-200"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <Github className="h-3.5 w-3.5" />
              <span>Support</span>
            </motion.a>
            <span className="text-gray-200 dark:text-gray-800">•</span>
            <motion.a
              href="#"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-emerald-600 transition-colors duration-200"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <Newspaper className="h-3.5 w-3.5" />
              <span>Updates</span>
            </motion.a>
          </div>

          {/* Tagline + shortcuts */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground/70">
              Made with <HeartPulse className="inline h-3 w-3 text-rose-400 mx-0.5" /> for healthcare
            </p>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('medivault:show-shortcuts'))}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-emerald-600 transition-colors duration-200"
            >
              <Keyboard className="h-3 w-3" />
              <span>Press Shift+? for shortcuts</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Keyboard shortcuts dialog */}
      <KeyboardShortcutsDialog />
    </div>
  )
}
