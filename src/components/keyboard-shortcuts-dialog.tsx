'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { motion } from 'framer-motion'
import { Keyboard, Command } from 'lucide-react'
import { useT } from '@/i18n'

interface ShortcutItem {
  keys: string[]
  descriptionKey: string
  category: string
}

const shortcuts: ShortcutItem[] = [
  { keys: ['Ctrl', 'N'], descriptionKey: 'shortcuts.addPatient', category: 'shortcuts.category.actions' },
  { keys: ['Ctrl', 'D'], descriptionKey: 'shortcuts.scanDocument', category: 'shortcuts.category.actions' },
  { keys: ['Ctrl', 'P'], descriptionKey: 'shortcuts.patientSwitcher', category: 'shortcuts.category.navigation' },
  { keys: ['Ctrl', 'F'], descriptionKey: 'shortcuts.focusSearch', category: 'shortcuts.category.navigation' },
  { keys: ['Ctrl', 'K'], descriptionKey: 'shortcuts.focusSearchAlt', category: 'shortcuts.category.navigation' },
  { keys: ['Ctrl', 'B'], descriptionKey: 'shortcuts.goBack', category: 'shortcuts.category.navigation' },
  { keys: ['Esc'], descriptionKey: 'shortcuts.closeDialogs', category: 'shortcuts.category.general' },
]

export function KeyboardShortcutsDialog() {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener('medivault:show-shortcuts', handleOpen)
    return () => window.removeEventListener('medivault:show-shortcuts', handleOpen)
  }, [])

  const categories = Array.from(new Set(shortcuts.map((s) => s.category)))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-emerald-600" />
            {t('shortcuts.title')}
          </DialogTitle>
          <DialogDescription>
            {t('shortcuts.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {categories.map((category) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t(category)}
              </h4>
              <div className="space-y-2">
                {shortcuts
                  .filter((s) => s.category === category)
                  .map((shortcut) => (
                    <div
                      key={shortcut.descriptionKey}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {t(shortcut.descriptionKey)}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, index) => (
                          <div key={index} className="flex items-center gap-1">
                            {index > 0 && <span className="text-xs text-muted-foreground">+</span>}
                            <kbd className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-600 dark:text-gray-400 shadow-sm">
                              {key}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center mt-4">
          <p className="text-xs text-muted-foreground">
            {t('shortcuts.pressHint')} <kbd className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-mono text-gray-600 dark:text-gray-400 shadow-sm">?</kbd> {t('shortcuts.anytime')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
