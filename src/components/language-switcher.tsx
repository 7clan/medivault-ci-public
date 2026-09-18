'use client'

/**
 * FEATURE D — the language switcher.
 *
 * Self-contained UI: no Arabic characters are hardcoded here — the language
 * NATIVE names come from the catalogs themselves (common.language.*), which
 * are identical in both catalogs by design (a language is always shown in its
 * own name). Available in the app header, the login/setup screens and the
 * settings view.
 */

import { Languages, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n, type Locale, SUPPORTED_LOCALES } from '@/i18n'

/** Dropdown variant — header / settings surfaces. */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors duration-200"
        title={t('common.language.switch')}
        aria-label={t('common.language.switch')}
        onClick={() => {
          // Cycle between the two supported locales; the settings view and
          // the dropdown-less surfaces use the segmented control below.
          const next: Locale = locale === 'en' ? 'ar' : 'en'
          setLocale(next)
        }}
      >
        <Languages className="h-4 w-4" />
        <span className="text-xs font-medium">{t(`common.language.${locale}`)}</span>
      </Button>
    </div>
  )
}

/** Compact segmented control — login / setup / first-run surfaces. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <div
      className={`inline-flex items-center rounded-full border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 p-0.5 shadow-sm ${className}`}
      role="group"
      aria-label={t('common.language.switch')}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200 flex items-center gap-1 ${
            locale === code
              ? 'bg-emerald-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {locale === code && <Check className="h-3 w-3" aria-hidden="true" />}
          {t(`common.language.${code}`)}
        </button>
      ))}
    </div>
  )
}
