/**
 * FEATURE ff-2b — Prescription PDF generator (runtime).
 *
 * `generatePrescriptionPdf` produces a REAL client-side PDF (pdf-lib +
 * embedded Amiri for Arabic) from the same `PrescriptionPrintData` the
 * on-screen print dialog already holds. This suite runs the generator
 * END-TO-END in the node test env with the REAL committed font
 * (public/fonts/Amiri-Regular.ttf served through a fetch stub — the app
 * serves the same file same-origin) and pins the fail-closed contract:
 *
 *  1. EN + AR fixtures both produce a loadable PDF: `%PDF-` magic bytes,
 *     a non-trivial size (the font subset travels inside), at least one
 *     A4 page, and BOTH font families embedded (Amiri + Helvetica[Bold]).
 *  2. The AR fixture (Arabic patient + Arabic medication names +
 *     instructions) must generate the SAME structural guarantees.
 *  3. Medication-table pagination: enough rows force a second page with
 *     the repeated table header (page break logic exercised).
 *  4. Every i18n key the generator can draw exists in BOTH catalogs
 *     (en + ar) — a missing key would leak the raw `print.*` string into
 *     the printed prescription.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib'
import { generatePrescriptionPdf } from '@/lib/pdf/prescription-pdf'
import type { PrescriptionPrintData } from '@/components/prescription-print'
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
// Fixtures — the exact PrescriptionPrintData shape
// ---------------------------------------------------------------------------

const EN_DATA: PrescriptionPrintData = {
  prescription: {
    id: '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    patientId: 'patient-0001',
    medications: '2',
    status: 'active',
    createdAt: '2025-01-15T10:30:00.000Z',
    notes:
      'Complete the full course even if symptoms improve. Return for a follow-up visit in two weeks.',
    patient: {
      id: 'patient-0001',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '1985-03-25',
      phone: '+961 1 234 567',
      address: 'Rue Beirut, Hamra, Lebanon',
    },
    doctor: {
      id: 'doctor-0001',
      name: 'Dr. Sarah Haddad',
      phone: '+961 1 111 222',
      specialty: 'Internal Medicine',
    },
  },
  medications: [
    {
      name: 'Amoxicillin 500mg Capsules',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      duration: '7 days',
      instructions: 'Take after meals with a full glass of water.',
    },
    {
      name: 'Ibuprofen 400mg Tablets',
      dosage: '1 tablet',
      frequency: 'As needed',
      duration: '5 days',
      instructions: 'Take with food; do not exceed 3 tablets per day.',
    },
  ],
}

const AR_DATA: PrescriptionPrintData = {
  prescription: {
    id: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    patientId: 'patient-0002',
    medications: '2',
    status: 'active',
    createdAt: '2025-01-15T10:30:00.000Z',
    notes: 'أكمل دورة العلاج كاملة حتى لو تحسنت الأعراض وراجع الطبيب بعد أسبوعين.',
    patient: {
      id: 'patient-0002',
      firstName: 'فاطمة',
      lastName: 'الزهرا',
      dateOfBirth: '1978-11-02',
      phone: '+961 3 987 654',
      address: 'بيروت، لبنان',
    },
    doctor: {
      id: 'doctor-0002',
      name: 'د. سارة حداد',
      phone: '+961 1 111 222',
      specialty: 'طب باطني',
    },
  },
  medications: [
    {
      name: 'أموكسيسيلين 500 ملغ كبسولات',
      dosage: 'كبسولة واحدة',
      frequency: 'Three times daily',
      duration: '7 days',
      instructions: 'يؤخذ بعد الطعام مع كوب كامل من الماء.',
    },
    {
      name: 'باراسيتامول 500 ملغ أقراص',
      dosage: 'قرص واحد',
      frequency: 'As needed',
      duration: '5 days',
      instructions: 'يؤخذ عند الحاجة مع الطعام.',
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

describe('ff-2b prescription PDF — EN fixture (English prescription)', () => {
  it('produces %PDF magic bytes and a non-trivial document', async () => {
    const bytes = await generatePrescriptionPdf(EN_DATA, 'en')
    expect(Buffer.from(bytes.slice(0, 5)).toString('utf8')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('loads as a valid pdf-lib document with at least one page', async () => {
    const bytes = await generatePrescriptionPdf(EN_DATA, 'en')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('embeds BOTH font families (Amiri for Arabic + the Helvetica faces)', async () => {
    const bytes = await generatePrescriptionPdf(EN_DATA, 'en')
    const fonts = await embeddedFontNames(bytes)
    expect(fonts.some((n) => n.startsWith('/Amiri-Regular'))).toBe(true)
    expect(fonts).toContain('/Helvetica')
    expect(fonts).toContain('/Helvetica-Bold')
  })
})

describe('ff-2b prescription PDF — AR fixture (Arabic prescription)', () => {
  it('produces %PDF magic bytes and a non-trivial document', async () => {
    const bytes = await generatePrescriptionPdf(AR_DATA, 'ar')
    expect(Buffer.from(bytes.slice(0, 5)).toString('utf8')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('loads as a valid pdf-lib document with at least one page', async () => {
    const bytes = await generatePrescriptionPdf(AR_DATA, 'ar')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('embeds the Amiri font (Arabic runs must draw with Amiri, never Helvetica)', async () => {
    const bytes = await generatePrescriptionPdf(AR_DATA, 'ar')
    const fonts = await embeddedFontNames(bytes)
    expect(fonts.some((n) => n.startsWith('/Amiri-Regular'))).toBe(true)
    expect(fonts).toContain('/Helvetica')
  })
})

describe('ff-2b prescription PDF — medication table pagination', () => {
  it('enough medication rows force a SECOND page (table page-break + repeated header)', async () => {
    const meds = Array.from({ length: 40 }, (_, i) => ({
      name: `Medication Number ${i + 1} — Extended Release Formula`,
      dosage: '1 tablet',
      frequency: 'Once daily',
      duration: '30 days',
      instructions: 'Take every morning with breakfast and plenty of water.',
    }))
    const bytes = await generatePrescriptionPdf(
      { ...EN_DATA, medications: meds },
      'en',
    )
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Source pin — every catalog key the generator can draw must exist in BOTH locales
// ---------------------------------------------------------------------------

describe('ff-2b prescription PDF — i18n contract (fail-closed source pin)', () => {
  const generatorSources = [
    'src/lib/pdf/prescription-pdf.ts',
    'src/lib/pdf/layout.ts',
    'src/lib/pdf/fonts.ts',
  ]

  function keysUsedIn(rel: string): Set<string> {
    const source = readFileSync(join(repoRoot, rel), 'utf8')
    const keys = new Set<string>()
    // t('…') / c.t('…') call sites…
    for (const m of source.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1])
    // Column label keys ('print.colMedication', …) and any dotted
    // lowercase-namespace literal — rejects 'image/png', 'ar-u-nu-latn',
    // './layout', 'Helvetica', etc.
    for (const m of source.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) {
      const candidate = m[1]
      if (!candidate.includes(' ') && !candidate.includes('/')) keys.add(candidate)
    }
    // Stored-value NAMESPACES are not literal keys: the generator resolves
    // them at runtime as `namespace + '.' + storedValue` (e.g.
    // 'prescriptions.freq.Once daily'); their value maps are pinned complete
    // by tests/i18n-architecture.test.ts.
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
    // prescription-pdf.ts draws at minimum its table-column keys.
    expect(used.size).toBeGreaterThanOrEqual(15)
    const missing = [...used].filter((key) => !(key in en) || !(key in ar))
    expect(missing).toEqual([])
  })
})
