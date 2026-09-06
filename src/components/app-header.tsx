'use client'

import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
// signOut handled via direct fetch
import { useTheme } from 'next-themes'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { NotificationCenter } from './notification-center'
import {
  Stethoscope,
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  X,
  User,
  Download,
  Moon,
  Sun,
  ChevronDown,
  Users,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { QuickPatientSwitcher } from './quick-patient-switcher'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

export function AppHeader() {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const { currentView, setCurrentView, doctorName, doctorEmail, logout } = useAppStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [patientSwitcherOpen, setPatientSwitcherOpen] = useState(false)
  const profileDropdownRef = useRef<HTMLDivElement>(null)

  // Listen for keyboard shortcut to open patient switcher
  useEffect(() => {
    const handleOpenSwitcher = () => setPatientSwitcherOpen(true)
    window.addEventListener('medivault:open-patient-switcher', handleOpenSwitcher)
    return () => window.removeEventListener('medivault:open-patient-switcher', handleOpenSwitcher)
  }, [])

  // Close profile dropdown on click outside
  useEffect(() => {
    if (!profileDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [profileDropdownOpen])

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
    logout()
    toast({ title: 'Signed out', description: 'You have been logged out.' })
  }

  const handleBackup = async () => {
    try {
      toast({ title: 'Preparing backup...', description: 'This may take a moment for large datasets.' })
      const res = await fetch('/api/backup', { credentials: 'include' })
      if (!res.ok) throw new Error('Backup failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `MediVault_Backup_${new Date().toISOString().split('T')[0]}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: 'Backup Complete!', description: 'Your data has been downloaded.' })
    } catch {
      toast({ title: 'Backup Failed', description: 'Could not create backup.', variant: 'destructive' })
    }
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard' as const },
    { icon: Settings, label: 'Settings', view: 'settings' as const },
  ]

  return (
    <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-gray-950/90 backdrop-blur-xl shadow-sm">
      {/* Animated gradient bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] animated-gradient-line" />
      <div className="flex h-16 items-center justify-between px-4 md:px-6 max-w-7xl mx-auto">
        {/* Logo */}
        <motion.button
          onClick={() => setCurrentView('dashboard')}
          className="flex items-center gap-2.5 transition-opacity"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="breathing-pulse flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900/40">
            <Stethoscope className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold text-gray-900 dark:text-white hidden sm:block tracking-tight">
            MediVault
          </span>
        </motion.button>

        {/* Desktop Nav - Glass morphism pill animation */}
        <nav className="hidden md:flex items-center gap-1 rounded-lg p-1 backdrop-blur-md bg-gray-100/60 dark:bg-gray-800/40 border border-white/30 dark:border-white/5 shadow-sm">
          {navItems.map((item) => {
            const isActive = currentView === item.view
            return (
              <div key={item.view} className="relative">
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      className="absolute inset-0 bg-white dark:bg-gray-700 rounded-md shadow-sm z-0"
                      layoutId="activeNavPill"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentView(item.view)}
                  className={`relative z-10 gap-2 rounded-md transition-colors duration-200 ${
                    isActive
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </div>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-1.5">
          {/* Quick Patient Switcher Trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden sm:flex text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors duration-200"
                  onClick={() => setPatientSwitcherOpen(true)}
                >
                  <Users className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span className="flex items-center gap-1.5">
                Switch Patient
                <kbd className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded bg-white/20 border border-white/10 text-[9px] font-mono">
                  Ctrl+P
                </kbd>
              </span>
            </TooltipContent>
          </Tooltip>

          {/* Notification Center */}
          <NotificationCenter />

          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors duration-200"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              <AnimatePresence mode="wait">
                {theme === 'dark' ? (
                  <motion.div key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Sun className="h-4 w-4" />
                  </motion.div>
                ) : (
                  <motion.div key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Moon className="h-4 w-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </motion.div>

          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors duration-200"
              onClick={handleBackup}
              title="Download Backup"
            >
              <Download className="h-4 w-4" />
            </Button>
          </motion.div>

          {/* Doctor Profile Dropdown */}
          <div ref={profileDropdownRef} className="relative hidden sm:block">
            <motion.button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 transition-colors duration-200"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <span className="text-emerald-700 dark:text-emerald-400 font-bold text-xs">
                  {(doctorName || 'D')[0].toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-medium max-w-[120px] truncate">
                {doctorName || 'Doctor'}
              </span>
              <motion.div animate={{ rotate: profileDropdownOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="h-3 w-3" />
              </motion.div>
            </motion.button>

            <AnimatePresence>
              {profileDropdownOpen && (
                <motion.div
                  className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 z-50 overflow-hidden"
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
                        {(doctorName || 'D')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{doctorName || 'Doctor'}</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Clinic Doctor</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors duration-200"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign Out" className="text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors duration-200">
              <LogOut className="h-4 w-4" />
            </Button>
          </motion.div>

          {/* Mobile menu button */}
          <motion.div whileTap={{ scale: 0.9 }}>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <AnimatePresence mode="wait">
                {mobileMenuOpen ? (
                  <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <X className="h-5 w-5" />
                  </motion.div>
                ) : (
                  <motion.div key="menu" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Menu className="h-5 w-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Mobile menu - Animated slide down with backdrop blur */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            className="md:hidden overflow-hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Backdrop overlay */}
            <motion.div
              className="fixed inset-0 bg-black/10 dark:bg-black/20 backdrop-blur-sm -z-10 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <div className="bg-white/90 dark:bg-gray-950/90 backdrop-blur-2xl px-4 py-3 space-y-1 shadow-xl border-t border-gray-100 dark:border-gray-800">
              {navItems.map((item, index) => {
                const isActive = currentView === item.view
                return (
                  <motion.div
                    key={item.view}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Button
                      variant="ghost"
                      className={`w-full justify-start gap-3 transition-colors duration-200 ${
                        isActive
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => {
                        setCurrentView(item.view)
                        setMobileMenuOpen(false)
                      }}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  </motion.div>
                )
              })}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground transition-colors duration-200"
                  onClick={() => {
                    toggleTheme()
                    setMobileMenuOpen(false)
                  }}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </Button>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 }}
              >
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground transition-colors duration-200"
                  onClick={() => {
                    handleBackup()
                    setMobileMenuOpen(false)
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download Backup
                </Button>
              </motion.div>
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border-t mt-2 pt-3 border-gray-100 dark:border-gray-800">
                <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                  <User className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900 dark:text-white block">{doctorName || 'Doctor'}</span>
                  <span className="text-xs text-muted-foreground block truncate">{doctorEmail || ''}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Patient Switcher Dialog */}
      <QuickPatientSwitcher open={patientSwitcherOpen} onOpenChange={setPatientSwitcherOpen} />
    </header>
  )
}
