'use client'

import { useAppStore, type ViewType } from '@/store/app-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Users, ScanLine, Upload, Settings } from 'lucide-react'

type NavItem = {
  icon: typeof Home
  label: string
  view: ViewType
}

const navItems: NavItem[] = [
  { icon: Home, label: 'Dashboard', view: 'dashboard' },
  { icon: Users, label: 'Patients', view: 'dashboard' },
  { icon: ScanLine, label: 'Scan', view: 'scan-capture' },
  { icon: Upload, label: 'Upload', view: 'scan-capture' },
  { icon: Settings, label: 'Settings', view: 'settings' },
]

export function MobileBottomNav() {
  const currentView = useAppStore((s) => s.currentView)

  // Don't render on login or setup screens
  if (currentView === 'login' || currentView === 'setup') {
    return null
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden">
      {/* Glass background */}
      <div className="bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl border-t border-gray-200/60 dark:border-gray-800/60">
        {/* Gradient top border accent */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-emerald-500/0 via-emerald-500/30 to-teal-500/0" />

        <div className="flex items-center justify-around px-2 pt-1.5 pb-[env(safe-area-inset-bottom,0px)]">
          {navItems.map((item) => {
            const isActive =
              item.view === 'dashboard'
                ? currentView === 'dashboard' || currentView === 'patient-detail' || currentView === 'document-viewer'
                : currentView === item.view

            return (
              <button
                key={item.label}
                onClick={() => {
                  useAppStore.getState().setCurrentView(item.view)
                }}
                className="relative flex flex-col items-center gap-0.5 py-1.5 px-3 min-w-[56px] transition-colors duration-200"
              >
                <motion.div
                  whileTap={{ scale: 0.85 }}
                  className="relative flex flex-col items-center gap-0.5"
                >
                  <div className="relative">
                    <item.icon
                      className={`h-5 w-5 transition-colors duration-200 ${
                        isActive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          layoutId="mobile-nav-indicator"
                          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500"
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}
                    </AnimatePresence>
                  </div>

                  <span
                    className={`text-[10px] leading-tight transition-colors duration-200 ${
                      isActive
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-medium text-muted-foreground'
                    }`}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
