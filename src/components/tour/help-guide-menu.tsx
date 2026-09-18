'use client'

/**
 * HelpGuideMenu — the permanent Help & Guide entry in the app header
 * (DIRECTIVE FEATURE C). After the one-time first-login tour, this is the
 * only way the tour reappears — by explicit request, never automatically.
 *
 * Offers: replay the entire tour, jump straight into any tour section,
 * and open the existing keyboard-shortcuts dialog (the same window event
 * the footer already dispatches). Styled after the header's profile
 * dropdown; all strings come from the centralized tour-content module.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CircleHelp, ChevronRight, Keyboard, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Mascot } from './mascot'
import { TOUR_SECTIONS, useTourSections, useTourStrings } from './tour-content'
import { requestTourStart } from './tour-state'

export function HelpGuideMenu() {
  const [open, setOpen] = useState(false)
  // Localized menu strings — resolved through the locale catalog by the
  // single tour strings module (tour-content.ts).
  const tourStrings = useTourStrings()
  const tourSections = useTourSections()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside — the same pattern as the profile dropdown.
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const startFullTour = () => {
    setOpen(false)
    requestTourStart()
  }

  const startSection = (section: (typeof TOUR_SECTIONS)[number]['id']) => {
    setOpen(false)
    requestTourStart(section)
  }

  const showShortcuts = () => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('medivault:show-shortcuts'))
  }

  return (
    <div ref={menuRef} className="relative">
      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
        <Button
          data-qa="app-help-button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(!open)}
          title={tourStrings.helpMenuTitle}
          aria-label={tourStrings.helpMenuTitle}
          aria-expanded={open}
          className={`transition-colors duration-200 ${
            open
              ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/20'
              : 'text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
          }`}
        >
          <CircleHelp className="h-4 w-4" />
        </Button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            data-qa="help-guide-menu"
            className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Header with the guide mascot */}
            <div className="flex items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 dark:border-gray-800 dark:from-emerald-950/30 dark:to-teal-950/30">
              <Mascot size={36} animated={false} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {tourStrings.helpMenuTitle}
                </p>
                <p className="truncate text-xs text-emerald-600 dark:text-emerald-400">
                  {tourStrings.helpMenuSubtitle}
                </p>
              </div>
            </div>

            <div className="p-2">
              {/* Replay the full tour */}
              <button
                data-qa="help-replay-tour"
                onClick={startFullTour}
                className="flex w-full items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-200/50 transition-all duration-200 hover:from-emerald-600 hover:to-teal-600 dark:shadow-emerald-900/30"
              >
                <RefreshCw className="h-4 w-4" />
                {tourStrings.helpReplayTour}
              </button>

              {/* Jump to a section */}
              <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tourStrings.helpSectionsTitle}
              </p>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {tourSections.map((section) => (
                  <button
                    key={section.id}
                    data-qa={`help-section-${section.id}`}
                    onClick={() => startSection(section.id)}
                    className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors duration-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-700 group-hover:text-emerald-700 dark:text-gray-300 dark:group-hover:text-emerald-400">
                        {section.label}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {section.description}
                      </span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 group-hover:text-emerald-500" />
                  </button>
                ))}
              </div>

              {/* Existing keyboard shortcuts dialog */}
              <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                <button
                  data-qa="help-keyboard-shortcuts"
                  onClick={showShortcuts}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors duration-200 hover:bg-gray-50 hover:text-foreground dark:hover:bg-gray-800/60"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                  {tourStrings.helpShortcuts}
                  <ChevronRight className="ms-auto h-3.5 w-3.5 opacity-50" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
