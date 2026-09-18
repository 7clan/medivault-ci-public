/**
 * FEATURE D (i18n / English + Arabic RTL) architecture coverage.
 *
 * Fail-closed static assertions in the pd23/pd24/pd26 pattern — the contract
 * is pinned to the source:
 *
 *  1. Catalogs exist for BOTH supported locales (en + ar) with EXACTLY
 *     matching key sets (a missing key in either locale is a bug: the en
 *     fallback would silently leak English into the Arabic UI).
 *  2. Every literal `t('…')` key used by the app exists in BOTH catalogs
 *     (dynamic template keys like `visits.type.${value}` are exercised via
 *     the value-map assertions below instead).
 *  3. The provider applies <html lang> + <html dir> imperatively, persists
 *     the locale to the 'medivault-language' localStorage key, and the
 *     layout pre-paint script uses the SAME key (no LTR flash / no drift).
 *  4. The dependency-free contract: NO i18n framework dependency was added.
 *  5. STORED-DATA value maps stay complete: every document category, visit
 *     type, visit status, clinical-note category, prescription status,
 *     frequency, duration, and medication category has a catalog label in
 *     BOTH locales (a missing entry would leak the raw English value into
 *     the Arabic UI — labels localize, stored values never change).
 *  6. The CSV DATA CONTRACT IS FROZEN: the export header line, the
 *     attachment disposition, the export filename pattern, and the import
 *     template header line are NOT localized (PD26/PD24 data format).
 *  7. The default locale is English — the QA harness needles rely on it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function readJson(rel: string): Record<string, string> {
  return JSON.parse(readRepo(rel)) as Record<string, string>
}

const en = readJson('src/i18n/locales/en.json')
const ar = readJson('src/i18n/locales/ar.json')
const i18nSource = readRepo('src/i18n/index.tsx')
const layoutSource = readRepo('src/app/layout.tsx')
const packageJson = JSON.parse(readRepo('package.json')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

describe('FEATURE D — i18n architecture (English + Arabic / RTL)', () => {
  it('catalogs exist for both supported locales', () => {
    expect(Object.keys(en).length).toBeGreaterThan(400)
    expect(Object.keys(ar).length).toBeGreaterThan(400)
  })

  it('the en and ar catalogs have EXACTLY matching key sets (no silent en fallback leaks)', () => {
    const missingInAr = Object.keys(en).filter((key) => !(key in ar))
    const missingInEn = Object.keys(ar).filter((key) => !(key in en))
    expect(missingInAr).toEqual([])
    expect(missingInEn).toEqual([])
  })

  it('no catalog value is left untranslated (the ar catalog carries real Arabic, not copies of English)', () => {
    // A value that is byte-identical to its en counterpart is only legal for
    // locale-neutral tokens (brand names, codes, the self-named language
    // label "English" which is conventionally shown in its own language).
    const allowed = new Set([
      'MediVault', 'PDF', 'CSV', 'ZIP', 'iOS / Android', 'CD / DVD',
      'English', '#', '—', 'N/A',
    ])
    const suspicious = Object.keys(en).filter((key) => {
      const enValue = en[key]
      const arValue = ar[key]
      if (enValue === arValue) {
        return !allowed.has(enValue) && /[a-z]{3}/.test(enValue)
      }
      return false
    })
    expect(suspicious).toEqual([])
  })

  it('every literal t(\'…\') key used in the app exists in BOTH catalogs', () => {
    const componentFiles = [
      'src/app/page.tsx',
      'src/components/activity-timeline.tsx',
      'src/components/add-patient-dialog.tsx',
      'src/components/analytics-dashboard.tsx',
      'src/components/app-header.tsx',
      'src/components/appointment-calendar.tsx',
      'src/components/clinical-notes.tsx',
      'src/components/dashboard.tsx',
      'src/components/document-annotations.tsx',
      'src/components/document-viewer.tsx',
      'src/components/edit-document-dialog.tsx',
      'src/components/edit-patient-dialog.tsx',
      'src/components/first-run-onboarding.tsx',
      'src/components/import-patients-dialog.tsx',
      'src/components/keyboard-shortcuts-dialog.tsx',
      'src/components/language-first-run-prompt.tsx',
      'src/components/language-switcher.tsx',
      'src/components/login-form.tsx',
      'src/components/mobile-bottom-nav.tsx',
      'src/components/notification-center.tsx',
      'src/components/patient-detail.tsx',
      'src/components/patient-health-summary.tsx',
      'src/components/patient-summary-report.tsx',
      'src/components/patient-timeline.tsx',
      'src/components/prescription-card.tsx',
      'src/components/prescription-generator.tsx',
      'src/components/prescription-print.tsx',
      'src/components/providers.tsx',
      'src/components/pwa-install-prompt.tsx',
      'src/components/quick-actions-fab.tsx',
      'src/components/quick-patient-switcher.tsx',
      'src/components/recently-viewed.tsx',
      'src/components/scan-capture.tsx',
      'src/components/settings-view.tsx',
      'src/components/setup-form.tsx',
      'src/components/stats-charts.tsx',
      'src/components/todays-overview.tsx',
      'src/components/tour/tour-content.ts',
      'src/components/visit-history.tsx',
      'src/components/visit-scheduler.tsx',
      'src/components/welcome-banner.tsx',
      'src/components/desktop/LoginForm.tsx',
    ]
    const usedKeys = new Set<string>()
    for (const file of componentFiles) {
      const source = readRepo(file)
      const literalKeyRegex = /\bt\(\s*'((?:[a-zA-Z0-9]+[.-])+[^'${}]*)'\s*(?:,|\))/g
      for (const match of source.matchAll(literalKeyRegex)) {
        usedKeys.add(match[1])
      }
    }
    expect(usedKeys.size).toBeGreaterThan(400)
    const missing = [...usedKeys].filter((key) => !(key in en) || !(key in ar))
    expect(missing).toEqual([])
  })

  it('the provider imperatively applies <html lang> + <html dir> on locale change', () => {
    expect(i18nSource).toMatch(/document\.documentElement\.lang = locale/)
    expect(i18nSource).toMatch(/document\.documentElement\.dir = dirForLocale\(locale\)/)
    expect(i18nSource).toMatch(/function dirForLocale\(locale: Locale\): TextDirection/)
    expect(i18nSource).toMatch(/return locale === 'ar' \? 'rtl' : 'ltr'/)
  })

  it('the locale persists to localStorage (the medivault-language key) and is read back on boot', () => {
    expect(i18nSource).toMatch(/LANGUAGE_STORAGE_KEY = 'medivault-language'/)
    expect(i18nSource).toMatch(/window\.localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/)
    expect(i18nSource).toMatch(/window\.localStorage\.setItem\(LANGUAGE_STORAGE_KEY, locale\)/)
  })

  it('the layout pre-paint script uses the SAME storage key and sets both lang and dir (no LTR flash)', () => {
    expect(layoutSource).toMatch(/<html lang="en" dir="ltr" suppressHydrationWarning/)
    expect(layoutSource).toMatch(/localStorage\.getItem\('medivault-language'\)/)
    expect(layoutSource).toMatch(/document\.documentElement\.dir=\(l==='ar'\?'rtl':'ltr'\)/)
    expect(layoutSource).toMatch(/document\.documentElement\.lang=l/)
  })

  it('the app is wrapped in the I18nProvider (inside the ThemeProvider)', () => {
    const providers = readRepo('src/components/providers.tsx')
    expect(providers).toMatch(/<I18nProvider>/)
    expect(providers).toMatch(/import \{ I18nProvider \} from '@\/i18n'/)
  })

  it('dependency-free by design — no i18n framework was added', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const banned = ['i18next', 'react-i18next', 'react-intl', 'next-intl', 'lingui', 'rosetta', 'i18n-js']
    for (const dep of Object.keys(deps)) {
      expect(banned).not.toContain(dep)
    }
  })

  it('the default locale is ENGLISH (QA harness needles rely on the default rendering)', () => {
    expect(i18nSource).toMatch(/DEFAULT_LOCALE: Locale = 'en'/)
  })

  it('Arabic dates keep Latin digits (the ar-u-nu-latn clinical convention)', () => {
    expect(i18nSource).toMatch(/ar-u-nu-latn/)
  })

  it('STORED-DATA value maps are complete — every standard document category localizes', () => {
    const categories = ['General', 'Lab Results', 'Prescription', 'X-Ray', 'MRI/CT', 'Referral', 'Insurance', 'Identity', 'Consent Form']
    for (const category of categories) {
      expect(en[`category.${category}`]).toBeDefined()
      expect(ar[`category.${category}`]).toBeDefined()
    }
  })

  it('STORED-DATA value maps are complete — visit types + statuses localize', () => {
    const types = ['Checkup', 'Follow-up', 'Consultation', 'Emergency', 'Procedure']
    const statuses = ['scheduled', 'completed', 'cancelled', 'no-show']
    for (const type of types) {
      expect(en[`visits.type.${type}`]).toBeDefined()
      expect(ar[`visits.type.${type}`]).toBeDefined()
    }
    for (const status of statuses) {
      expect(en[`visits.status.${status}`]).toBeDefined()
      expect(ar[`visits.status.${status}`]).toBeDefined()
    }
  })

  it('STORED-DATA value maps are complete — clinical note categories localize', () => {
    const categories = ['General', 'Diagnosis', 'Treatment Plan', 'Lab Results', 'Follow-up', 'Referral']
    for (const category of categories) {
      expect(en[`clinical.category.${category}`]).toBeDefined()
      expect(ar[`clinical.category.${category}`]).toBeDefined()
    }
  })

  it('STORED-DATA value maps are complete — prescription statuses/frequencies/durations/med categories localize', () => {
    const statuses = ['active', 'discontinued', 'completed']
    const frequencies = ['Once daily', 'Twice daily', 'Three times daily', 'As needed', 'Every 4 hours', 'Every 6 hours', 'Every 8 hours', 'Weekly']
    const durations = ['3 days', '5 days', '7 days', '10 days', '14 days', '30 days', '60 days', '90 days', 'Ongoing']
    const medCategories = ['Antibiotic', 'Pain/Inflammation', 'Diabetes', 'Hypertension', 'GERD/Acid Reflux', 'Fever/Pain']
    for (const status of statuses) {
      expect(en[`prescriptions.statusValue.${status}`]).toBeDefined()
      expect(ar[`prescriptions.statusValue.${status}`]).toBeDefined()
    }
    for (const frequency of frequencies) {
      expect(en[`prescriptions.freq.${frequency}`]).toBeDefined()
      expect(ar[`prescriptions.freq.${frequency}`]).toBeDefined()
    }
    for (const duration of durations) {
      expect(en[`prescriptions.duration.${duration}`]).toBeDefined()
      expect(ar[`prescriptions.duration.${duration}`]).toBeDefined()
    }
    for (const category of medCategories) {
      expect(en[`prescriptions.category.${category}`]).toBeDefined()
      expect(ar[`prescriptions.category.${category}`]).toBeDefined()
    }
  })

  it('stored visit/prescription values never change — the API payload stays the raw value', () => {
    // The scheduler serializes the raw state values; only display passes
    // through tVisitType/tVisitStatus/tFreq/tDuration.
    const scheduler = readRepo('src/components/visit-scheduler.tsx')
    expect(scheduler).toMatch(/visitType,/)
    expect(scheduler).toMatch(/status,/)
    const generator = readRepo('src/components/prescription-generator.tsx')
    expect(generator).toMatch(/medications: validMeds,/)
  })

  it('the CSV EXPORT data contract is FROZEN — the header line + disposition + filename are not localized', () => {
    const route = readRepo('mini-services/api-service/src/routes/patients/index.ts')
    expect(route).toMatch(/'First Name', 'Last Name', 'DOB', 'Phone', 'Email', 'Address', 'Notes', 'Document Count', 'Created Date'/)
    expect(route).toMatch(/Content-Disposition', `attachment; filename="medivault-patients-/)
    const dashboard = readRepo('src/components/dashboard.tsx')
    expect(dashboard).toMatch(/a\.download\s*=\s*`medivault-patients-/)
    expect(dashboard).not.toMatch(/t\('csvHeaders/)
  })

  it('the CSV IMPORT data contract is FROZEN — the template header line stays verbatim', () => {
    const dialog = readRepo('src/components/import-patients-dialog.tsx')
    expect(dialog).toMatch(/'firstName,lastName,dateOfBirth,phone,email,address,notes'/)
    expect(dialog).toMatch(/medivault-patient-template\.csv/)
  })

  it('medical record content is never machine-localized — custom categories pass through verbatim', () => {
    // tCategory returns the RAW category when no catalog entry exists (a
    // user-typed category is patient data, not UI chrome).
    expect(i18nSource).toMatch(/return label === key \? category : label/)
  })
})
