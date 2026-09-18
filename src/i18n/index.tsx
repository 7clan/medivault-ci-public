'use client'

/**
 * MediVault i18n — FEATURE D (English + Arabic / RTL localization).
 *
 * Dependency-free by design: a React context + flat JSON catalogs.
 * No i18next/react-intl dependency was added (merge-gate decision — see
 * docs/i18n-architecture.md); the app stays fully offline-capable.
 *
 * Contract:
 * - `I18nProvider` owns the locale, persists it (localStorage key
 *   `medivault-language`), and imperatively applies `document.documentElement
 *   .lang` + `.dir` on every change (the app is a SPA inside WKWebView — the
 *   <html> attributes are managed here, not by the server layout).
 * - Catalogs are flat, namespaced by surface: auth.*, dashboard.*, patients.*,
 *   documents.*, viewer.*, visits.*, clinical.*, prescriptions.*, reports.*,
 *   print.*, importExport.*, backup.*, settings.*, errors.*, common.*.
 * - `t(key, params)` interpolates `{name}` placeholders and falls back to the
 *   English catalog, then to the key itself (fail-closed, never crashes).
 * - MEDICAL RECORD CONTENT IS NEVER TRANSLATED: patient-entered text, names,
 *   document contents and CSV values pass through untouched. Only UI chrome
 *   strings are localized; the CSV file format (headers) is a frozen data
 *   contract (PD26) and is NOT localized.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import en from './locales/en.json'
import ar from './locales/ar.json'

export type Locale = 'en' | 'ar'
export type TextDirection = 'ltr' | 'rtl'

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ar']
export const DEFAULT_LOCALE: Locale = 'en'
export const LANGUAGE_STORAGE_KEY = 'medivault-language'
/** One-shot flag for the first-login language prompt (FEATURE D requirement 2). */
export const LANGUAGE_PROMPT_STORAGE_KEY = 'medivault-language-prompt-done'

type Catalog = Record<string, string>

const catalogs: Record<Locale, Catalog> = { en, ar }

export type TranslationParams = Record<string, string | number>

export function translate(
  locale: Locale,
  key: string,
  params?: TranslationParams,
): string {
  let value = catalogs[locale]?.[key]
  if (value === undefined) value = catalogs[DEFAULT_LOCALE]?.[key]
  if (value === undefined) return key
  if (params) {
    value = value.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : match,
    )
  }
  return value
}

export function dirForLocale(locale: Locale): TextDirection {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export function isSupportedLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ar'
}

export function readPersistedLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (isSupportedLocale(stored)) return stored
  } catch {
    // localStorage unavailable — fall through to the default
  }
  return DEFAULT_LOCALE
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
  } catch {
    // storage full/unavailable — the in-memory locale still applies
  }
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dir = dirForLocale(locale)
}

/**
 * Arabic dates keep Latin (Western) digits — the regional convention in
 * clinical settings, and it keeps dates scannable next to patient data that
 * is itself never localized.
 */
function dateLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : 'en-US'
}

type DateInput = string | number | Date

export interface I18nContextValue {
  locale: Locale
  dir: TextDirection
  isRtl: boolean
  setLocale: (locale: Locale) => void
  t: (key: string, params?: TranslationParams) => string
  /** Document category label — standard categories localize; custom (user-typed) categories pass through verbatim. */
  tCategory: (category: string) => string
  formatDate: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string
  formatDateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string
  formatTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readPersistedLocale)

  // Apply + persist on every change (and once on mount for the SPA boot).
  useEffect(() => {
    applyDocumentLocale(locale)
    persistLocale(locale)
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (!isSupportedLocale(next)) return
    setLocaleState(next)
  }, [])

  const t = useCallback(
    (key: string, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  )

  // Standard document categories localize via catalog keys ("category.Lab Results");
  // a custom user-typed category has no catalog entry and passes through UNTRANSLATED
  // (medical record content is never machine-localized).
  const tCategory = useCallback(
    (category: string) => {
      const key = `category.${category}`
      const label = translate(locale, key)
      return label === key ? category : label
    },
    [locale],
  )

  const formatDate = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
      Intl.DateTimeFormat(dateLocale(locale), options).format(new Date(value)),
    [locale],
  )

  const formatDateTime = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
      Intl.DateTimeFormat(dateLocale(locale), {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...options,
      }).format(new Date(value)),
    [locale],
  )

  const formatTime = useCallback(
    (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
      Intl.DateTimeFormat(dateLocale(locale), {
        hour: 'numeric',
        minute: '2-digit',
        ...options,
      }).format(new Date(value)),
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: dirForLocale(locale),
      isRtl: locale === 'ar',
      setLocale,
      t,
      tCategory,
      formatDate,
      formatDateTime,
      formatTime,
    }),
    [locale, setLocale, t, tCategory, formatDate, formatDateTime, formatTime],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}

/** Minimal surface — the translation function alone. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t
}
