'use client'

/**
 * FEATURE D requirement 2 — first-login language choice.
 *
 * A minimal, non-invasive, self-contained prompt shown ONCE the first time
 * the app shell renders after a successful login (the app shell only exists
 * post-auth). The guided-tour worker's branch will integrate deeper later;
 * this component only sets the locale + marks the one-shot localStorage
 * flag and disappears. All copy comes from the catalogs (bilingual by
 * construction: the title uses BOTH languages so the choice is legible
 * regardless of the currently active one).
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Languages, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useI18n,
  LANGUAGE_PROMPT_STORAGE_KEY,
  type Locale,
} from '@/i18n'

export function LanguageFirstRunPrompt() {
  const { locale, setLocale, t } = useI18n()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(LANGUAGE_PROMPT_STORAGE_KEY)) {
        setVisible(true)
      }
    } catch {
      // storage unavailable — do not nag
    }
  }, [])

  const finish = () => {
    try {
      window.localStorage.setItem(LANGUAGE_PROMPT_STORAGE_KEY, '1')
    } catch {
      // best-effort persistence
    }
    setVisible(false)
  }

  const choose = (next: Locale) => {
    setLocale(next)
    finish()
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-24 md:bottom-8 start-1/2 md:start-auto md:end-6 z-[60] w-[min(92vw,340px)]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25 }}
          dir="ltr"
        >
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-xl p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
                  <Languages className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                    {t('i18n.firstPrompt.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('i18n.firstPrompt.subtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={finish}
                aria-label={t('common.dismiss')}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2" dir="ltr">
              <Button
                variant={locale === 'en' ? 'default' : 'outline'}
                className="w-full h-10"
                onClick={() => choose('en')}
              >
                {t('common.language.en')}
              </Button>
              <Button
                variant={locale === 'ar' ? 'default' : 'outline'}
                className="w-full h-10"
                onClick={() => choose('ar')}
              >
                {t('common.language.ar')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 text-center">
              {t('i18n.firstPrompt.hint')}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
