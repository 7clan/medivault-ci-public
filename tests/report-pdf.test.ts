/**
 * FEATURE ff-2b — Patient Summary Report PDF generator (runtime).
 *
 * `generatePatientReportPdf` produces a REAL client-side PDF (pdf-lib +
 * embedded Amiri for Arabic) from the exact `POST /api/reports` JSON the
 * dialog already holds. This suite runs the generator END-TO-END in the
 * node test env with the REAL committed font (public/fonts/Amiri-Regular.ttf
 * served through a fetch stub — the app serves the same file same-origin)
 * and pins the fail-closed contract:
 *
 *  1. EN + AR fixtures both produce a loadable PDF: `%PDF-` magic bytes,
 *     a non-trivial size (the font subset travels inside), at least one
 *     A4 page, and BOTH font families embedded (Amiri + Helvetica[Bold]).
 *  2. The AR fixture (Arabic patient name + Arabic annotation content +
 *     Arabic doctor identity) must generate the SAME structural guarantees
 *     — Arabic never falls back to a WinAnsi-only document.
 *  3. Every i18n key the generator can draw exists in BOTH catalogs
 *     (en + ar) — a missing key would leak the raw `report.*` string into
 *     the printed clinical document.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib'
import { generatePatientReportPdf, type PatientReportSummary } from '@/lib/pdf/report-pdf'
import { clearAmiriFontCache } from '@/lib/pdf/fonts'

const repoRoot = process.cwd()

// ---------------------------------------------------------------------------
// The REAL font bytes via the same same-origin fetch the app performs
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch

beforeAll(() => {
  const fontBytes = readFileSync(join(repoRoot, 'public/fonts/Amiri-Regular.ttf'))
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('Amiri')) {
      return new Response(fontBytes, { status: 200 })
    }
    return new Response(null, { status: 404 })
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  clearAmiriFontCache()
})

// ---------------------------------------------------------------------------
// Fixtures — the exact POST /api/reports JSON shape
// ---------------------------------------------------------------------------

const EN_SUMMARY: PatientReportSummary = {
  generatedAt: '2025-01-15T10:30:00.000Z',
  doctor: {
    name: 'Dr. Sarah Haddad',
    email: 'sarah.haddad@medivault.example',
    specialty: 'Internal Medicine',
  },
  patient: {
    id: 'patient-0001',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1985-03-25',
    phone: '+961 1 234 567',
    email: 'john.doe@example.com',
    address: 'Rue Beirut, Hamra, Lebanon',
    notes: 'Penicillin allergy — verify before prescribing.',
    createdAt: '2024-06-01T08:00:00.000Z',
  },
  documents: {
    total: 12,
    byCategory: { 'Lab Results': 5, 'X-Ray': 3, Prescription: 4 },
    totalStorage: 10485760,
    latestDocument: {
      title: 'CBC Panel',
      fileName: 'cbc-panel.pdf',
      scannedAt: '2025-01-10T09:00:00.000Z',
    },
  },
  visits: {
    total: 8,
    byStatus: { completed: 6, scheduled: 2 },
    upcoming: 2,
    nextUpcoming: { visitDate: '2025-02-01', visitType: 'Follow-up' },
  },
  prescriptions: { total: 3, active: 2 },
  clinicalNotes: { total: 5, pinned: 1 },
  recentActivity: [
    {
      type: 'annotation',
      content: 'Reviewed the blood work — follow up in two weeks.',
      documentName: 'CBC Panel',
      createdAt: '2025-01-11T08:00:00.000Z',
    },
    {
      type: 'document',
      content: 'Uploaded the latest X-Ray report.',
      documentName: 'Chest X-Ray',
      createdAt: '2025-01-05T14:20:00.000Z',
    },
  ],
}

const AR_SUMMARY: PatientReportSummary = {
  generatedAt: '2025-01-15T10:30:00.000Z',
  doctor: {
    name: 'د. سارة حداد',
    email: 'sarah.haddad@medivault.example',
    specialty: 'طب باطني',
  },
  patient: {
    id: 'patient-0002',
    firstName: 'فاطمة',
    lastName: 'الزهرا',
    dateOfBirth: '1978-11-02',
    phone: '+961 3 987 654',
    email: null,
    address: 'بيروت، لبنان',
    notes: 'حساسية من البنسلين — يجب التحقق قبل وصف أي مضاد حيوي.',
    createdAt: '2024-06-01T08:00:00.000Z',
  },
  documents: {
    total: 9,
    byCategory: { 'Lab Results': 4, Referral: 2, Prescription: 3 },
    totalStorage: 8388608,
    latestDocument: null,
  },
  visits: {
    total: 6,
    byStatus: { completed: 4 },
    upcoming: 1,
    nextUpcoming: { visitDate: '2025-03-01', visitType: 'Consultation' },
  },
  prescriptions: { total: 2, active: 1 },
  clinicalNotes: { total: 4, pinned: 2 },
  recentActivity: [
    {
      type: 'annotation',
      content: 'تمت مراجعة نتائج التحاليل المخبرية مع المريض.',
      documentName: 'تقرير الدم',
      createdAt: '2025-01-11T08:00:00.000Z',
    },
  ],
}

// ---------------------------------------------------------------------------
// Structural assertions
// ---------------------------------------------------------------------------

async function embeddedFontNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const names: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font')) {
      const base = obj.get(PDFName.of('BaseFont'))
      if (base) names.push(base.toString())
    }
  }
  return names
}

describe('ff-2b report PDF — EN fixture (English clinical document)', () => {
  it('produces %PDF magic bytes and a non-trivial document', async () => {
    const bytes = await generatePatientReportPdf(EN_SUMMARY, 'en')
    expect(Buffer.from(bytes.slice(0, 5)).toString('utf8')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('loads as a valid pdf-lib document with at least one page', async () => {
    const bytes = await generatePatientReportPdf(EN_SUMMARY, 'en')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('embeds BOTH font families (Amiri for Arabic + the Helvetica faces)', async () => {
    const bytes = await generatePatientReportPdf(EN_SUMMARY, 'en')
    const fonts = await embeddedFontNames(bytes)
    expect(fonts.some((n) => n.startsWith('/Amiri-Regular'))).toBe(true)
    expect(fonts).toContain('/Helvetica')
    expect(fonts).toContain('/Helvetica-Bold')
  })

  it('is deterministic in structure (same fixture → same page count)', async () => {
    const [a, b] = await Promise.all([
      generatePatientReportPdf(EN_SUMMARY, 'en'),
      generatePatientReportPdf(EN_SUMMARY, 'en'),
    ])
    const [da, db] = await Promise.all([PDFDocument.load(a), PDFDocument.load(b)])
    expect(da.getPageCount()).toBe(db.getPageCount())
  })
})

describe('ff-2b report PDF — AR fixture (Arabic clinical document)', () => {
  it('produces %PDF magic bytes and a non-trivial document', async () => {
    const bytes = await generatePatientReportPdf(AR_SUMMARY, 'ar')
    expect(Buffer.from(bytes.slice(0, 5)).toString('utf8')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('loads as a valid pdf-lib document with at least one page', async () => {
    const bytes = await generatePatientReportPdf(AR_SUMMARY, 'ar')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('embeds the Amiri font (Arabic runs must draw with Amiri, never Helvetica)', async () => {
    const bytes = await generatePatientReportPdf(AR_SUMMARY, 'ar')
    const fonts = await embeddedFontNames(bytes)
    expect(fonts.some((n) => n.startsWith('/Amiri-Regular'))).toBe(true)
    expect(fonts).toContain('/Helvetica')
  })

  it('a long Arabic annotation still yields a well-formed document (wrapping exercised)', async () => {
    const long: PatientReportSummary = {
      ...AR_SUMMARY,
      recentActivity: [
        {
          type: 'annotation',
          content:
            'المريض يحتاج إلى متابعة دورية شهرية مع فحوصات مخبرية كل ثلاثة أشهر ' +
            'ومراجعة ضغط الدم وصورة الدم الكاملة ووظائف الكلى والكبد بشكل منتظم',
          documentName: 'تقرير المتابعة',
          createdAt: '2025-01-12T08:00:00.000Z',
        },
      ],
    }
    const bytes = await generatePatientReportPdf(long, 'ar')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Source pin — every catalog key the generator can draw must exist in BOTH locales
// ---------------------------------------------------------------------------

describe('ff-2b report PDF — i18n contract (fail-closed source pin)', () => {
  const generatorSources = [
    'src/lib/pdf/report-pdf.ts',
    'src/lib/pdf/layout.ts',
    'src/lib/pdf/fonts.ts',
  ]

  function keysUsedIn(rel: string): Set<string> {
    const source = readFileSync(join(repoRoot, rel), 'utf8')
    const keys = new Set<string>()
    // t('…') / c.t('…') call sites…
    for (const m of source.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1])
    // statBoxes label keys are bare strings ('report.totalDocuments', …) and
    // stampFooters takes its attribution key directly.
    for (const m of source.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) {
      const candidate = m[1]
      // Only dotted lowercase-namespace keys — rejects 'image/png',
      // 'ar-u-nu-latn', './layout', 'Helvetica', etc.
      if (!candidate.includes(' ') && !candidate.includes('/')) keys.add(candidate)
    }
    // Stored-value NAMESPACES are not literal keys: the generator resolves
    // them at runtime as `namespace + '.' + storedValue`; their value maps
    // are pinned complete by tests/i18n-architecture.test.ts.
    keys.delete('prescriptions.freq')
    keys.delete('prescriptions.duration')
    return keys
  }

  it('every key the generator can draw exists in BOTH the en and ar catalogs', () => {
    const en = JSON.parse(readFileSync(join(repoRoot, 'src/i18n/locales/en.json'), 'utf8'))
    const ar = JSON.parse(readFileSync(join(repoRoot, 'src/i18n/locales/ar.json'), 'utf8'))
    const used = new Set<string>()
    for (const rel of generatorSources) {
      for (const key of keysUsedIn(rel)) used.add(key)
    }
    expect(used.size).toBeGreaterThan(25)
    const missing = [...used].filter((key) => !(key in en) || !(key in ar))
    expect(missing).toEqual([])
  })
})
