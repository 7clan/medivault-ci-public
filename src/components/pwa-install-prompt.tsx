'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X, Monitor, Smartphone, Chrome, Globe } from 'lucide-react'

const DISMISS_KEY = 'medivault-pwa-dismiss'
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const isMobile = typeof window !== 'undefined'
    ? /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth < 768)
    : false

  useEffect(() => {
    // Check if previously dismissed
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10)
      if (Date.now() - dismissedTime < DISMISS_DURATION) {
        return
      }
      localStorage.removeItem(DISMISS_KEY)
    }

    // Listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Show after a short delay
      setTimeout(() => setIsVisible(true), 2000)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setShowInstructions(true)
      return
    }

    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setIsVisible(false)
        setDeferredPrompt(null)
      }
    } catch {
      setShowInstructions(true)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString())
    setIsVisible(false)
  setShowInstructions(false)
  }

  if (!isVisible) return null

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-3 sm:p-4"
        >
          <div className="max-w-lg mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Top gradient accent */}
            <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />
            
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                {/* Icon */}
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/40">
                  <img src="/icon-192.png" alt="MediVault" className="w-8 h-8 rounded-lg" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">
                    Install MediVault
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {isMobile ? 'Add to home screen for quick access' : 'Install as a desktop app for quick access'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${isMobile ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                      {isMobile ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                      {isMobile ? 'Mobile' : 'Desktop'}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <Globe className="h-3 w-3" />
                      Works Offline
                    </span>
                  </div>
                </div>

                {/* Dismiss button */}
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-3 sm:mt-4">
                <button
                  onClick={handleInstall}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white text-sm font-medium rounded-xl shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/40 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                >
                  <Download className="h-4 w-4" />
                  {isMobile ? 'Add to Home Screen' : 'Install App'}
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all duration-200"
                >
                  Not now
                </button>
              </div>

              {/* Manual install instructions (fallback) */}
              <AnimatePresence>
                {showInstructions && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Manual installation:</p>
                      {isMobile ? (
                        <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <p>1. Tap the <strong>Share</strong> button in your browser</p>
                          <p>2. Tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                          <p>3. Tap <strong>&quot;Add&quot;</strong> to confirm</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <p>1. Click the <strong>install icon</strong> in the address bar</p>
                          <p>2. Or click <strong>⋮ menu</strong> → <strong>&quot;Install MediVault&quot;</strong></p>
                          <p>3. Click <strong>&quot;Install&quot;</strong> to confirm</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Standalone install button for use in settings/footer
export function PWAInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const isMobile = typeof window !== 'undefined'
    ? /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth < 768)
    : false

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
          setCanInstall(false)
        }
      } catch {
        setShowInstructions(true)
      }
    } else {
      setShowInstructions(!showInstructions)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleInstall}
        className="flex items-center gap-2 w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20 transition-all duration-200 hover:shadow-lg active:scale-[0.99] text-sm font-medium"
      >
        {isMobile ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        <Download className="h-4 w-4" />
        {canInstall
          ? (isMobile ? 'Add to Home Screen' : 'Install as Desktop App')
          : 'Install App (PWA)'
        }
      </button>

      <AnimatePresence>
        {showInstructions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                <Chrome className="h-3.5 w-3.5" />
                How to install:
              </p>
              {isMobile ? (
                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p><span className="font-medium text-gray-600 dark:text-gray-300">iOS (Safari):</span> Tap Share → &quot;Add to Home Screen&quot;</p>
                  <p><span className="font-medium text-gray-600 dark:text-gray-300">Android (Chrome):</span> Tap ⋮ → &quot;Install app&quot; or &quot;Add to Home Screen&quot;</p>
                </div>
              ) : (
                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p><span className="font-medium text-gray-600 dark:text-gray-300">Chrome/Edge:</span> Click the install icon (⊕) in the address bar</p>
                  <p><span className="font-medium text-gray-600 dark:text-gray-300">Or:</span> Click ⋮ menu → &quot;Install MediVault&quot;</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
