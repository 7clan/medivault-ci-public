/**
 * Guided tour regression coverage (DIRECTIVE FEATURE C).
 *
 * Fail-closed static assertions over the tour sources — the same pattern
 * as tests/pd23-view-scroll-reset.test.ts: pin the contract to the code so
 * a regression fails the build instead of the doctor. The contract:
 *
 * - The tour component exists and is mounted in the authenticated app
 *   shell (page.tsx), wired to the first-login offer
 *   (shouldAutoStartTour) and the Help-menu replay bus.
 * - The step catalog is centralized in ONE module (tour-content.ts) — all
 *   17 required capability topics are present, in a defined order. Since
 *   the i18n rebase the module is catalog-backed: the static structures
 *   carry structure + tour.* catalog keys, and the localized hooks
 *   (useTourStrings / useTourSections / useTourSteps) resolve the strings
 *   through the app's locale catalog. The ENGLISH catalog values are the
 *   rendered-UI OCR needle contract for the QA harness (micro:tour-en) —
 *   pinned EXACTLY below.
 * - Every spotlight target is a data-qa anchor that ACTUALLY exists in
 *   the real component that renders that view.
 * - Controls are Back / Next / Skip / Finish + a progress indicator;
 *   NO data-altering "Try it" actions anywhere in the tour files; the
 *   engine only issues GET requests.
 * - Completion AND dismissal persist via localStorage, so the tour is
 *   never offered again automatically afterwards.
 * - The mascot is an inline SVG component (no external image assets —
 *   offline app + the CI's no-PHI/no-credentials gates).
 * - Robustness: the Escape/arrows keydown handler stays armed (a
 *   plain-browser affordance) but is NEVER advertised to the doctor —
 *   on the macOS WKWebView shell Escape never reaches the DOM
 *   (TOUR_ESC_HINT_INOPERATIVE), so the visible Skip control is the
 *   supported exit; off-screen targets are scrolled into view, and
 *   window resize re-measures the spotlight.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

const TOUR_DIR = 'src/components/tour'
const TOUR_FILES = [
  `${TOUR_DIR}/tour-content.ts`,
  `${TOUR_DIR}/tour-state.ts`,
  `${TOUR_DIR}/mascot.tsx`,
  `${TOUR_DIR}/guided-tour.tsx`,
  `${TOUR_DIR}/help-guide-menu.tsx`,
] as const

/** Which real component renders each data-qa anchor namespace. */
const ANCHOR_SOURCE_FILES: Array<{ prefix: string; file: string }> = [
  { prefix: 'dashboard-', file: 'src/components/dashboard.tsx' },
  { prefix: 'patient-detail-', file: 'src/components/patient-detail.tsx' },
  { prefix: 'document-viewer', file: 'src/components/document-viewer.tsx' },
  { prefix: 'viewer-', file: 'src/components/document-viewer.tsx' },
  { prefix: 'scan-capture-', file: 'src/components/scan-capture.tsx' },
  { prefix: 'settings-', file: 'src/components/settings-view.tsx' },
  { prefix: 'app-help-button', file: `${TOUR_DIR}/help-guide-menu.tsx` },
]

function anchorSourceFile(anchor: string): string {
  const match = ANCHOR_SOURCE_FILES.find((entry) => anchor === entry.prefix || anchor.startsWith(entry.prefix))
  if (!match) throw new Error(`No source file mapping for anchor: ${anchor}`)
  return match.file
}

describe('guided tour — step catalog (centralized, complete, ordered)', () => {
  const content = readRepo(`${TOUR_DIR}/tour-content.ts`)

  it('exports the ordered step catalog covering all 17 required capability topics', () => {
    const expectedIds = [
      'welcome',
      'dashboard',
      'add-patient',
      'search',
      'patient-profile',
      'patient-profile-detail',
      'scan',
      'upload-files',
      'documents',
      'viewer',
      'print',
      'visits',
      'clinical-notes',
      'prescriptions',
      'reports',
      'calendar',
      'export-csv',
      'backup',
      'settings',
      'finish',
    ]
    for (const id of expectedIds) {
      expect(content, `step id missing from catalog: ${id}`).toContain(`id: '${id}',`)
    }
    // 17 capability topics (+ welcome + finish framing steps).
    expect(expectedIds).toHaveLength(20)
  })

  it('every step declares section, view, target, titleKey and bodyKey (catalog-backed)', () => {
    const stepsBlock = content.slice(content.indexOf('export const TOUR_STEPS'))
    const stepBlocks = stepsBlock.split(/\n\s*\{\n\s*id: '/).slice(1)
    expect(stepBlocks).toHaveLength(20)
    for (const block of stepBlocks) {
      expect(block).toMatch(/section: '/)
      expect(block).toMatch(/view: '/)
      expect(block).toMatch(/target: '/)
      expect(block).toMatch(/titleKey: 'tour\.step\.[a-z-]+\.title'/)
      expect(block).toMatch(/bodyKey: 'tour\.step\.[a-z-]+\.body'/)
    }
  })

  it('data-dependent steps (patient profile / viewer) declare a fallback anchor + body key', () => {
    const stepsBlock = content.slice(content.indexOf('export const TOUR_STEPS'))
    const stepBlocks = stepsBlock.split(/\n\s*\{\n\s*id: '/).slice(1)
    const dataDependent = stepBlocks.filter((block) => /view: '(patient-detail|document-viewer)'/.test(block))
    expect(dataDependent.length).toBeGreaterThanOrEqual(8)
    for (const block of dataDependent) {
      expect(block).toMatch(/fallbackTarget: '/)
      expect(block).toMatch(/bodyFallbackKey: 'tour\.step\.[a-z-]+\.bodyFallback'/)
    }
  })

  it('every spotlight target exists as a data-qa attribute in the component that renders it', () => {
    const targets = Array.from(content.matchAll(/(?:target|fallbackTarget): '([^']+)'/g)).map((m) => m[1])
    expect(targets.length).toBeGreaterThanOrEqual(20)
    for (const anchor of targets) {
      const source = readRepo(anchorSourceFile(anchor))
      expect(source, `data-qa anchor "${anchor}" not found in ${anchorSourceFile(anchor)}`).toContain(
        `data-qa="${anchor}"`,
      )
    }
  })

  it('sections are defined and every step references a known section', () => {
    const sectionsBlock = content.slice(
      content.indexOf('export const TOUR_SECTIONS'),
      content.indexOf('export const TOUR_STEPS'),
    )
    const sectionIds = Array.from(sectionsBlock.matchAll(/^\s{4}id: '([a-z-]+)',$/gm)).map((m) => m[1])
    expect(sectionIds).toEqual([
      'getting-started',
      'patients',
      'documents',
      'clinical',
      'scheduling',
      'export-backup',
      'settings',
    ])
    for (const id of sectionIds) {
      // each section id is used by at least one step
      expect(content).toMatch(new RegExp(`section: '${id}',`))
    }
  })
})

describe('guided tour — i18n catalog contract (English + Arabic)', () => {
  const content = readRepo(`${TOUR_DIR}/tour-content.ts`)
  const en = JSON.parse(readRepo('src/i18n/locales/en.json')) as Record<string, string>
  const ar = JSON.parse(readRepo('src/i18n/locales/ar.json')) as Record<string, string>

  /**
   * The ENGLISH catalog values for the tour surface, byte-exact — these are
   * the rendered-UI contract for the QA harness needles (micro:tour-en /
   * tour-ar): the tour copy may only change here, deliberately, together
   * with the harness needles.
   */
  const ENGLISH_VALUES: Array<[key: string, value: string]> = [
    ["tour.mascot.ariaLabel", "Medi, the MediVault guide"],
    ["tour.controls.back", "Back"],
    ["tour.controls.next", "Next"],
    ["tour.controls.skip", "Skip"],
    ["tour.controls.finish", "Finish"],
    ["tour.complete.title", "Tour complete"],
    ["tour.complete.description", "Find the guide again anytime under Help & Guide in the header."],
    ["tour.help.subtitle", "Take a guided tour of MediVault"],
    ["tour.help.replay", "Replay Full Tour"],
    ["tour.help.jumpTo", "Jump to a section"],
    ['tour.progress', 'Step {current} of {total}'],
    ['header.helpGuide', 'Help & Guide'],
    ['tour.section.getting-started.label', "Welcome & Dashboard"],
    ['tour.section.patients.label', "Patients & Search"],
    ['tour.section.documents.label', "Documents & Scanning"],
    ['tour.section.clinical.label', "Visits & Clinical Records"],
    ['tour.section.scheduling.label', "Calendar & Appointments"],
    ['tour.section.export-backup.label', "Export & Backup"],
    ['tour.section.settings.label', "Settings & Help"],
    ['tour.section.getting-started.description', "A quick look around your practice home"],
    ['tour.section.patients.description', "Adding, finding, and opening patients"],
    ['tour.section.documents.description', "Scanning, uploading, viewing, and printing"],
    ['tour.section.clinical.description', "Visits, notes, prescriptions, and reports"],
    ['tour.section.scheduling.description', "The appointment calendar"],
    ['tour.section.export-backup.description', "CSV export and complete backups"],
    ['tour.section.settings.description', "Preferences and replaying this tour"],
    ['tour.step.welcome.title', "Welcome to MediVault"],
    ['tour.step.dashboard.title', "Your Dashboard"],
    ['tour.step.add-patient.title', "Add a Patient"],
    ['tour.step.search.title', "Find Patients Fast"],
    ['tour.step.patient-profile.title', "Patient Profiles"],
    ['tour.step.patient-profile-detail.title', "Inside the Profile"],
    ['tour.step.scan.title', "Scan Documents"],
    ['tour.step.upload-files.title', "Upload Files"],
    ['tour.step.documents.title', "Organized Documents"],
    ['tour.step.viewer.title', "The Built-in Viewer"],
    ['tour.step.print.title', "Print in One Click"],
    ['tour.step.visits.title', "Visit History"],
    ['tour.step.clinical-notes.title', "Clinical Notes"],
    ['tour.step.prescriptions.title', "Prescriptions"],
    ['tour.step.reports.title', "Patient Summary Reports"],
    ['tour.step.calendar.title', "Appointments Calendar"],
    ['tour.step.export-csv.title', "Export Your Patient List"],
    ['tour.step.backup.title', "Complete Backups"],
    ['tour.step.settings.title', "Settings"],
    ['tour.step.finish.title', "You're All Set!"],
    ['tour.step.welcome.body', "I'm Medi, your practice guide. This short tour shows you where everything lives — patients, documents, visits, prescriptions, and backups. It takes about a minute, and you can leave at any time."],
    ['tour.step.dashboard.body', "Your practice at a glance: patient and document totals, storage used, and recent uploads. Every part of MediVault is reachable from here."],
    ['tour.step.add-patient.body', "Register a new patient in seconds — a name gets you started, and contact details, address, and notes can follow anytime."],
    ['tour.step.search.body', "Search by name, phone, or email. Press Ctrl+K from anywhere to jump straight to this box."],
    ['tour.step.patient-profile.body', "Every patient has a complete profile — documents, visits, notes, and prescriptions in one place. Click any patient in this list to open theirs."],
    ['tour.step.patient-profile-detail.body', "The profile gathers everything about one patient: contact details, a health summary, and their full record — documents, visits, notes, and prescriptions — below."],
    ['tour.step.scan.body', "Turn your camera into a document scanner — capture pages one by one, or drop in existing files. Everything is encrypted and attached to the right patient's record."],
    ['tour.step.upload-files.body', "Attach existing files — lab reports, imaging, referral letters. Drag and drop or browse; each file is encrypted before it is stored."],
    ['tour.step.documents.body', "Documents are grouped by category — Lab Results, Imaging, Prescriptions, Insurance — with filters and sorting so the right record is always a click away."],
    ['tour.step.viewer.body', "Open any document right here in MediVault — images and PDFs render in place, with annotations, fullscreen, download, and print in the toolbar."],
    ['tour.step.print.body', "Print the open document exactly as stored — this toolbar button sends it to your system printer. Patient summary reports print from the profile report button."],
    ['tour.step.visits.body', "Log every consultation — date, type, and chief complaint — so the patient story stays complete and nothing is ever lost between appointments."],
    ['tour.step.clinical-notes.body', "Free-form clinical notes, right where you need them — observations, follow-ups, and instructions without leaving the profile."],
    ['tour.step.prescriptions.body', "Write and track prescriptions per patient — medications, dosage, and status — with a print-ready view to hand over."],
    ['tour.step.reports.body', "Generate a complete summary report — demographics, documents, visits, and prescriptions — ready to print or save as a PDF for referrals."],
    ['tour.step.calendar.body', "Toggle the month calendar whenever you need the clinic's schedule — see upcoming visits and schedule new ones without leaving the dashboard."],
    ['tour.step.export-csv.body', "Download the full patient list as a CSV file — perfect for spreadsheets, billing systems, or a quick offline copy."],
    ['tour.step.backup.body', "One click downloads a complete ZIP of all your data — patients, documents, and records. Keep a copy somewhere safe."],
    ['tour.step.settings.body', "Your account, display name, appearance, and data tools live here — including the backup controls you just saw."],
    ['tour.step.finish.body', "That's the tour! Find me anytime under Help & Guide in the header — replay the full tour or jump straight to any section."],
    ['tour.step.patient-profile-detail.bodyFallback', "Open any patient to see their full profile — contact details, a health summary, and their complete record of documents, visits, notes, and prescriptions."],
    ['tour.step.upload-files.bodyFallback', "Inside a patient profile, Upload Files attaches reports, imaging, and letters — drag and drop or browse, and each file is encrypted before it is stored."],
    ['tour.step.documents.bodyFallback', "Inside a patient profile, documents are grouped by category with filters and sorting — Lab Results, Imaging, Prescriptions, and Insurance."],
    ['tour.step.viewer.bodyFallback', "When a patient has documents, each opens in MediVault's built-in viewer — with annotations, fullscreen, download, and print in the toolbar."],
    ['tour.step.print.bodyFallback', "From the viewer toolbar, any document prints in one click; patient summary reports print from the report button in the profile header."],
    ['tour.step.visits.bodyFallback', "Inside a patient profile, the Visit History logs every consultation — date, type, and chief complaint — keeping the record complete."],
    ['tour.step.clinical-notes.bodyFallback', "Inside a patient profile, Clinical Notes hold your free-form observations, follow-ups, and instructions."],
    ['tour.step.prescriptions.bodyFallback', "Inside a patient profile, Prescriptions tracks medications, dosage, and status — with a print-ready view to hand over."],
    ['tour.step.reports.bodyFallback', "From a patient profile header, generate a complete summary report — demographics, documents, visits, and prescriptions — ready to print or save as PDF."],
  ]

  it('every tour catalog key exists in BOTH locales (en/ar key parity)', () => {
    for (const [key] of ENGLISH_VALUES) {
      expect(en[key], `missing en catalog key: ${key}`).toBeDefined()
      expect(ar[key], `missing ar catalog key: ${key}`).toBeDefined()
    }
  })

  it('the inoperative Esc hint is GONE — no catalog key, no rendered instruction (WKWebView never delivers Escape)', () => {
    // P3 TOUR_ESC_HINT_INOPERATIVE: real CGEvent keyboard testing on the
    // macOS runners proved Escape NEVER reaches the WKWebView DOM, so the
    // "Press Esc to leave the tour" hint was a false instruction and was
    // deliberately removed. The keydown handler itself STAYS (it is correct
    // and unit-proven in plain browsers); the VISIBLE Skip / Finish
    // controls are the supported exit on every platform.
    for (const file of TOUR_FILES) {
      const source = readRepo(file)
      expect(source, `${file} must not reference the removed dismissHint string`).not.toContain('dismissHint')
      expect(source, `${file} must not instruct the doctor to press Esc`).not.toMatch(
        /\b(?:press|hit)\s+esc\b/i,
      )
    }
    expect(en, 'tour.controls.dismissHint must stay out of the en catalog').not.toHaveProperty(
      'tour.controls.dismissHint',
    )
    expect(ar, 'tour.controls.dismissHint must stay out of the ar catalog').not.toHaveProperty(
      'tour.controls.dismissHint',
    )
  })

  it('the ENGLISH catalog values are pinned byte-exact (the QA harness needle contract)', () => {
    for (const [key, value] of ENGLISH_VALUES) {
      expect(en[key], `EN value drift for ${key} (a QA needle — update deliberately, with the harness)`).toBe(value)
    }
  })

  it('the Arabic catalog carries real Arabic translations (never copies of the English)', () => {
    for (const [key, value] of ENGLISH_VALUES) {
      expect(ar[key], `ar value for ${key} must differ from the en value`).not.toBe(value)
      expect(ar[key], `ar value for ${key} must contain Arabic script`).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('every catalog key referenced by the tour structures resolves (no dead key references)', () => {
    const referenced = new Set<string>()
    for (const m of content.matchAll(/(?:titleKey|bodyKey|bodyFallbackKey|labelKey|descriptionKey): '([^']+)'/g)) {
      referenced.add(m[1])
    }
    expect(referenced.size).toBe(63) // 20 titles + 20 bodies + 9 bodyFallbacks + 7 section labels + 7 section descriptions
    for (const key of referenced) {
      expect(en[key], `tour-content references a key missing from the en catalog: ${key}`).toBeDefined()
      expect(ar[key], `tour-content references a key missing from the ar catalog: ${key}`).toBeDefined()
    }
    // the chrome hooks resolve through the same catalog family
    expect(content).toMatch(/back: t\('tour\.controls\.back'\)/)
    expect(content).toMatch(/next: t\('tour\.controls\.next'\)/)
    expect(content).toMatch(/skip: t\('tour\.controls\.skip'\)/)
    expect(content).toMatch(/finish: t\('tour\.controls\.finish'\)/)
    expect(content).toMatch(/stepOf: \(current: number, total: number\): string => t\('tour\.progress', \{ current, total \}\)/)
    expect(content).toMatch(/mascotAriaLabel: t\('tour\.mascot\.ariaLabel'\)/)
    expect(content).toMatch(/helpMenuTitle: t\('header\.helpGuide'\)/)
  })
})

describe('guided tour — persistence + first-login wiring', () => {
  it('completion and dismissal persist via localStorage behind a versioned key', () => {
    const state = readRepo(`${TOUR_DIR}/tour-state.ts`)
    expect(state).toContain("export const TOUR_STORAGE_KEY = 'medivault-tour-completed-v1'")
    expect(state).toContain('localStorage.getItem(TOUR_STORAGE_KEY)')
    expect(state).toContain('localStorage.setItem(TOUR_STORAGE_KEY, status)')
    expect(state).toMatch(/export function markTourCompleted\(\)/)
    expect(state).toMatch(/export function markTourDismissed\(\)/)
    expect(state).toMatch(/export function shouldAutoStartTour\(\): boolean \{\s*return getTourStatus\(\) === 'unseen'\s*\}/)
  })

  it('the tour component is mounted in the authenticated app shell (page.tsx)', () => {
    const page = readRepo('src/app/page.tsx')
    expect(page).toContain("import { GuidedTour } from '@/components/tour/guided-tour'")
    expect(page).toMatch(/<GuidedTour \/>/)
  })

  it('the first-login offer is gated by the persisted status (auto-start exactly once)', () => {
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    // The one-time offer rides the same activation bus as the Help-menu
    // replays (listener armed first, then the dispatch) — and it fires only
    // while the persisted status is still 'unseen'.
    expect(engine).toMatch(/if \(shouldAutoStartTour\(\)\) requestTourStart\(\)/)
    expect(engine).toMatch(/window\.addEventListener\(TOUR_START_EVENT, handleStart\)/)
    expect(engine).toMatch(/beginTour\(section \? firstStepIndexForSection\(section\) : 0\)/)
    expect(engine).toContain('markTourCompleted()')
    expect(engine).toContain('markTourDismissed()')
  })

  it('the permanent Help entry lives in the app header and can replay / jump to a section', () => {
    const header = readRepo('src/components/app-header.tsx')
    expect(header).toContain("import { HelpGuideMenu } from './tour/help-guide-menu'")
    expect(header).toMatch(/<HelpGuideMenu \/>/)

    const menu = readRepo(`${TOUR_DIR}/help-guide-menu.tsx`)
    expect(menu).toContain('data-qa="app-help-button"')
    expect(menu).toContain('data-qa="help-replay-tour"')
    expect(menu).toContain('requestTourStart()')
    expect(menu).toMatch(/requestTourStart\(section\)/)
    expect(menu).toContain('TOUR_SECTIONS')
    expect(menu).toContain('medivault:show-shortcuts')
  })
})

describe('guided tour — controls, safety, robustness', () => {
  it('Back / Next / Skip / Finish + progress indicator are all present', () => {
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    expect(engine).toContain('data-qa="tour-back"')
    expect(engine).toContain('data-qa="tour-skip"')
    expect(engine).toContain("data-qa={isLast ? 'tour-finish' : 'tour-next'}")
    expect(engine).toMatch(/tourStrings\.stepOf\(index \+ 1, total\)/)
    expect(engine).toMatch(/<Progress value=\{progress\}/)
  })

  it('has NO data-altering actions: no "Try it", no mutating HTTP methods, GET-only fetches', () => {
    for (const file of TOUR_FILES) {
      const source = readRepo(file)
      expect(source, `${file} must not contain "Try it" actions`).not.toMatch(/try\s+it/i)
      expect(
        source,
        `${file} must not issue mutating HTTP requests`,
      ).not.toMatch(/method:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i)
    }
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    const fetches = Array.from(engine.matchAll(/fetch\((`[^`]+`|'[^']+')/g)).map((m) => m[1])
    expect(fetches.length).toBeGreaterThan(0)
    for (const url of fetches) {
      expect(url, `tour fetch must be a read-only patient/documents GET: ${url}`).toMatch(
        /^['"`]\/api\/patients(?:\?limit=1['"`]?$|\/\$\{patient\.id\}\/documents['"`]?$)/,
      )
    }
  })

  it('tour strings are centralized — every user-facing string resolves through the tour-content catalog module', () => {
    // tour-content.ts stays the SINGLE strings module: it owns every
    // catalog key reference the tour renders (chrome + steps + sections)
    // and resolves them through t() for the active locale.
    const content = readRepo(`${TOUR_DIR}/tour-content.ts`)
    expect(content).toMatch(/export function useTourStrings\(\)/)
    expect(content).toMatch(/export function useTourSections\(\): LocalizedTourSection\[\]/)
    expect(content).toMatch(/export function useTourSteps\(\): LocalizedTourStep\[\]/)
    expect(content).toContain("import { useI18n } from '@/i18n'")
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    expect(engine).toContain('tourStrings.back')
    expect(engine).toContain('tourStrings.next')
    expect(engine).toContain('tourStrings.skip')
    expect(engine).toContain('tourStrings.finish')
    expect(engine).toContain('useTourStrings()')
    expect(engine).toContain('useTourSteps()')
    // The engine and menu must not hardcode their own button labels.
    const menu = readRepo(`${TOUR_DIR}/help-guide-menu.tsx`)
    expect(menu).toContain('useTourStrings()')
    expect(menu).toContain('useTourSections()')
    expect(menu).toContain('tourStrings.helpReplayTour')
    expect(menu).toContain('tourStrings.helpShortcuts')
    const mascot = readRepo(`${TOUR_DIR}/mascot.tsx`)
    expect(mascot).toContain('useTourStrings()')
  })

  it('the keydown handler stays armed (Escape/arrows); off-screen targets scroll into view; resize re-measures', () => {
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    expect(engine).toMatch(/e\.key === 'Escape'/)
    expect(engine).toMatch(/scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/)
    expect(engine).toMatch(/window\.addEventListener\('resize', onViewportChange\)/)
  })

  it('the overlay is modal only while active and never persists after finish/skip', () => {
    const engine = readRepo(`${TOUR_DIR}/guided-tour.tsx`)
    expect(engine).toMatch(/if \(!active\) return null/)
    // both exit paths clear the active state
    expect(engine).toMatch(/const finish = useCallback\(\(\) => \{\s*markTourCompleted\(\)\s*closeTour\(\)/s)
    expect(engine).toMatch(/const skip = useCallback\(\(\) => \{\s*markTourDismissed\(\)\s*closeTour\(\)/s)
  })
})

describe('guided tour — mascot', () => {
  it('is an inline SVG React component with no external image assets', () => {
    const mascot = readRepo(`${TOUR_DIR}/mascot.tsx`)
    expect(mascot).toContain('<svg')
    expect(mascot).not.toContain('<img')
    expect(mascot).not.toMatch(/https?:\/\//)
    expect(mascot).not.toMatch(/from\s+['"]next\/image['"]/)
    expect(mascot).toMatch(/export function Mascot\(/)
    // accessible name is centralized with the other tour strings
    expect(mascot).toContain('tourStrings.mascotAriaLabel')
    // uses the app palette (emerald/teal), not indigo/blue accents
    expect(mascot).toMatch(/#10b981/)
    expect(mascot).toMatch(/#0d9488/)
    expect(mascot).not.toMatch(/indigo|#[0-9a-f]{6}.*(4f46e5|3b82f6)/i)
  })
})
