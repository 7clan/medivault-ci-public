'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { UserPlus, Camera, Upload, Plus, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const actions = [
  {
    icon: UserPlus,
    label: 'Add Patient',
    color: 'bg-emerald-600 hover:bg-emerald-700',
    shadow: 'shadow-emerald-200 dark:shadow-emerald-900/40',
    onClick: () => {
      // Open add patient dialog via dashboard state
      const event = new CustomEvent('medivault:add-patient')
      window.dispatchEvent(event)
    },
  },
  {
    icon: Camera,
    label: 'Scan Document',
    color: 'bg-teal-600 hover:bg-teal-700',
    shadow: 'shadow-teal-200 dark:shadow-teal-900/40',
    onClick: () => {
      const { setScanTargetPatientId, setCurrentView } = useAppStore.getState()
      setScanTargetPatientId(null)
      setCurrentView('scan-capture')
    },
  },
  {
    icon: Upload,
    label: 'Quick Upload',
    color: 'bg-emerald-500 hover:bg-emerald-600',
    shadow: 'shadow-emerald-200 dark:shadow-emerald-900/40',
    onClick: () => {
      const event = new CustomEvent('medivault:quick-upload')
      window.dispatchEvent(event)
    },
  },
]

export function QuickActionsFab() {
  const [isOpen, setIsOpen] = useState(false)
  const currentView = useAppStore((s) => s.currentView)
  const fabRef = useRef<HTMLDivElement>(null)

  // Only show on mobile, and only when on dashboard or patient-detail
  const showFab = (currentView === 'dashboard' || currentView === 'patient-detail')

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      return () => document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen])

  if (!showFab) return null

  const handleMainToggle = () => setIsOpen((prev) => !prev)

  return (
    <div ref={fabRef} className="md:hidden fixed bottom-6 right-6 z-50 flex flex-col-reverse items-end gap-3">
      {/* Action buttons */}
      <AnimatePresence>
        {isOpen && (
          <>
            {actions.map((action, index) => (
              <motion.div
                key={action.label}
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.8 }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 22,
                  delay: index * 0.05,
                }}
                className="flex items-center gap-2"
              >
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          action.onClick()
                          setIsOpen(false)
                        }}
                        size="icon"
                        className={`h-12 w-12 rounded-full text-white shadow-lg ${action.color} ${action.shadow}`}
                      >
                        <action.icon className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                      <p className="text-sm font-medium">{action.label}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Main FAB button */}
      <motion.div whileTap={{ scale: 0.92 }}>
        <Button
          onClick={handleMainToggle}
          size="icon"
          className={`h-14 w-14 rounded-full text-white shadow-xl shadow-emerald-300/50 dark:shadow-emerald-900/60 transition-colors duration-200 ${
            isOpen
              ? 'bg-gray-600 hover:bg-gray-700 shadow-gray-300/50 dark:shadow-gray-900/60'
              : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          <AnimatePresence mode="wait">
            {isOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <X className="h-6 w-6" />
              </motion.div>
            ) : (
              <motion.div
                key="plus"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Plus className="h-6 w-6" />
              </motion.div>
            )}
          </AnimatePresence>
        </Button>
      </motion.div>

      {/* Backdrop overlay when open */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-[-1] bg-black/10 dark:bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
