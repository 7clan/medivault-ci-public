/**
 * FEATURE ff-2b — Arabic/bidi support for the clinical PDF generators.
 *
 * Runtime coverage for `src/lib/pdf/arabic.ts` (shaping, script
 * segmentation, run rendering, mixed-direction measurement/drawing) and
 * for `wrapMixedText` (exported from `src/lib/pdf/layout.ts` — the
 * mixed-script line wrapper both generators draw through).
 *
 * Fail-closed contract:
 *
 *  1. `shapeArabic` maps Arabic letters to their POSITIONAL PRESENTATION
 *     FORMS (U+FB50–U+FDFF / U+FE70–U+FEFF) including the lam-alef
 *     ligature; non-Arabic input passes through untouched.
 *  2. `segmentIntoRuns` classifies characters as arabic / latin /
 *     neutral and keeps the concatenation lossless.
 *  3. `renderRunText` shapes + GLYPH-REVERSES Arabic runs (pdf-lib draws
 *     left-to-right, so the reversed shaped sequence is the visually
 *     correct RTL column) and leaves Latin runs in reading order.
 *  4. `wrapMixedText` word-wraps mixed Arabic/Latin text to a measured
 *     pixel width, hard-breaks oversized single words, and truncates to
 *     `maxLines` with an ellipsis.
 *
 * The tests run the REAL fonts (Amiri via public/fonts + the pdf-lib
 * standard Helvetica faces) against REAL pdf-lib font metrics, so the
 * measured widths are the ones the shipped documents use.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  drawMixedLine,
  isArabicText,
  measureMixedLine,
  renderRunText,
  segmentIntoRuns,
  shapeArabic,
} from '@/lib/pdf/arabic'
import { wrapMixedText } from '@/lib/pdf/layout'

const repoRoot = process.cwd()

// ---------------------------------------------------------------------------
// Real font metrics (the same embed path the generators use)
// ---------------------------------------------------------------------------

let amiri: PDFFont
let helvetica: PDFFont
const realFetch = globalThis.fetch

beforeAll(async () => {
  // fonts.ts fetches '/fonts/Amiri-Regular.ttf' same-origin — in the node
  // test env we serve the REAL committed TTF from public/fonts.
  const fontBytes = readFileSync(join(repoRoot, 'public/fonts/Amiri-Regular.ttf'))
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('Amiri')) {
      return new Response(fontBytes, { status: 200 })
    }
    return new Response(null, { status: 404 })
  }) as typeof fetch

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  amiri = await pdf.embedFont(new Uint8Array(fontBytes))
  helvetica = await pdf.embedFont(StandardFonts.Helvetica)
})

afterAll(() => {
  globalThis.fetch = realFetch
})

const fonts = () => ({ arabic: amiri, latin: helvetica })

/** True when every code point is an Arabic PRESENTATION FORM. */
function isPresentationForms(text: string): boolean {
  return [...text].every((ch) => {
    const cp = ch.codePointAt(0) ?? 0
    return (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)
  })
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

describe('ff-2b arabic shaping — shapeArabic', () => {
  it('maps Arabic letters to positional presentation forms', () => {
    const shaped = shapeArabic('مرحبا')
    expect(shaped).not.toBe('مرحبا')
    expect(isPresentationForms(shaped)).toBe(true)
  })

  it('context decides the form: the same letter shapes differently at word start vs middle', () => {
    const start = shapeArabic('م')
    const middle = shapeArabic('سمك')
    expect(start).not.toBe(middle)
    expect(isPresentationForms(start)).toBe(true)
    expect(isPresentationForms(middle)).toBe(true)
  })

  it('produces the lam-alef ligature (U+FEFB family)', () => {
    const shaped = shapeArabic('لا')
    expect([...shaped].map((c) => c.codePointAt(0))).toContain(0xfefb)
  })

  it('leaves pure Latin/digit strings untouched', () => {
    expect(shapeArabic('Amoxicillin 500 mg')).toBe('Amoxicillin 500 mg')
    expect(shapeArabic('')).toBe('')
  })

  it('shapes ONLY the Arabic characters of a mixed string', () => {
    const mixed = 'دواء Aspirin 100mg'
    const shaped = shapeArabic(mixed)
    expect(shaped.endsWith('Aspirin 100mg')).toBe(true)
    expect(isPresentationForms(shaped.slice(0, shaped.indexOf(' ')))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Script detection + segmentation
// ---------------------------------------------------------------------------

describe('ff-2b arabic shaping — script detection + segmentation', () => {
  it('isArabicText detects Arabic in base and mixed strings', () => {
    expect(isArabicText('أحمد')).toBe(true)
    expect(isArabicText('أحمد Smith')).toBe(true)
    expect(isArabicText('Smith 1985')).toBe(false)
    expect(isArabicText('')).toBe(false)
  })

  it('segmentIntoRuns splits a mixed AR + Latin line into ordered runs', () => {
    const runs = segmentIntoRuns('أحمد Smith 1985')
    expect(runs.map((r) => r.script)).toEqual([
      'arabic',
      'neutral',
      'latin',
      'neutral',
      'latin',
    ])
    // Lossless: the concatenation is the original string.
    expect(runs.map((r) => r.text).join('')).toBe('أحمد Smith 1985')
    expect(runs[0]?.text).toBe('أحمد')
    expect(runs[2]?.text).toBe('Smith')
    expect(runs[4]?.text).toBe('1985')
  })

  it('pure Arabic and pure Latin strings form single runs', () => {
    expect(segmentIntoRuns('وصفة')).toHaveLength(1)
    expect(segmentIntoRuns('Prescription')).toHaveLength(1)
    expect(segmentIntoRuns('وصفة')[0]?.script).toBe('arabic')
    expect(segmentIntoRuns('Prescription')[0]?.script).toBe('latin')
    // A space inside the Arabic string is a NEUTRAL run between two Arabic runs.
    expect(segmentIntoRuns('وصفة طبية')).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Run rendering (the RTL drawing primitive)
// ---------------------------------------------------------------------------

describe('ff-2b arabic shaping — renderRunText', () => {
  it('an Arabic run renders as the GLYPH-REVERSED shaped text (pdf-lib draws LTR)', () => {
    const run = { text: 'مرحبا', script: 'arabic' as const }
    const rendered = renderRunText(run)
    const expected = [...shapeArabic('مرحبا')].reverse().join('')
    expect(rendered).toBe(expected)
    expect(isPresentationForms(rendered)).toBe(true)
  })

  it('brackets inside reversed Arabic runs are mirrored', () => {
    const run = { text: '(م)', script: 'arabic' as const }
    const rendered = renderRunText(run)
    // '(' was the FIRST logical char → after glyph reversal it is LAST.
    expect(rendered.endsWith(')')).toBe(true)
  })

  it('Latin runs keep their reading order untouched', () => {
    expect(renderRunText({ text: 'Amoxicillin 500mg', script: 'latin' })).toBe(
      'Amoxicillin 500mg',
    )
  })
})

// ---------------------------------------------------------------------------
// Measurement + drawing
// ---------------------------------------------------------------------------

describe('ff-2b arabic shaping — measurement + drawing', () => {
  it('measureMixedLine: Arabic measured with the Arabic font, Latin with the Latin font', () => {
    const arWidth = measureMixedLine('مرحبا', 12, fonts())
    const laWidth = measureMixedLine('Hello', 12, fonts())
    expect(arWidth).toBeGreaterThan(0)
    expect(laWidth).toBeGreaterThan(0)
    expect(arWidth).toBeCloseTo(amiri.widthOfTextAtSize(shapeArabic('مرحبا'), 12), 6)
    expect(laWidth).toBeCloseTo(helvetica.widthOfTextAtSize('Hello', 12), 6)
  })

  it('a mixed line measures as the SUM of its merged runs', () => {
    const text = 'أحمد Smith'
    const total = measureMixedLine(text, 10, fonts())
    const shapedAr = shapeArabic('أحمد ')
    const expected =
      amiri.widthOfTextAtSize(shapedAr, 10) +
      helvetica.widthOfTextAtSize('Smith', 10)
    expect(total).toBeCloseTo(expected, 6)
  })

  it('drawMixedLine LTR: draws left→right and returns the right edge (= the measured width)', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 100])
    const end = drawMixedLine(page, 'أحمد Smith', {
      direction: 'ltr',
      x: 10,
      y: 50,
      size: 12,
      color: { type: 'RGB' as const, red: 0, green: 0, blue: 0 },
      ...fonts(),
    })
    expect(end).toBeCloseTo(10 + measureMixedLine('أحمد Smith', 12, fonts()), 4)
  })

  it('drawMixedLine RTL: draws right→left and returns the left edge', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 100])
    const width = measureMixedLine('أحمد Smith', 12, fonts())
    const end = drawMixedLine(page, 'أحمد Smith', {
      direction: 'rtl',
      x: 390, // the RIGHT edge anchor
      y: 50,
      size: 12,
      color: { type: 'RGB' as const, red: 0, green: 0, blue: 0 },
      ...fonts(),
    })
    expect(end).toBeCloseTo(390 - width, 4)
    // Never overflows the right anchor.
    expect(end).toBeLessThan(390)
  })
})

// ---------------------------------------------------------------------------
// wrapMixedText (the layout engine's mixed-script wrapper)
// ---------------------------------------------------------------------------

describe('ff-2b arabic shaping — wrapMixedText (layout.ts export)', () => {
  it('a short line stays on ONE line, verbatim', () => {
    const lines = wrapMixedText('أحمد Smith', 480, 12, fonts())
    expect(lines).toEqual(['أحمد Smith'])
  })

  it('wraps long mixed Arabic/Latin text within the measured width', () => {
    const text = [
      'المريض يعاني من ارتفاع في ضغط الدم ويحتاج إلى متابعة دورية شهرية',
      'with scheduled lab work every three months and lifestyle counseling',
    ].join(' ')
    const maxWidth = 220
    const lines = wrapMixedText(text, maxWidth, 10, fonts())
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(measureMixedLine(line, 10, fonts())).toBeLessThanOrEqual(maxWidth + 1e-6)
    }
    // Lossless: no words lost (only whitespace between the wrapped lines).
    expect(lines.join(' ')).toBe(text)
  })

  it('hard-breaks a single word wider than the column', () => {
    const longWord = 'a'.repeat(140)
    const lines = wrapMixedText(longWord, 100, 10, fonts())
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(measureMixedLine(line, 10, fonts())).toBeLessThanOrEqual(100 + 1e-6)
    }
    expect(lines.join('')).toBe(longWord)
  })

  it('truncates to maxLines with an ellipsis on the last kept line', () => {
    const text =
      'وصفة طبية طويلة جدا تحتاج إلى أسطر متعددة داخل العمود المحدد للملاحظات ' +
      'plus some additional Latin instructions that will not fit either here'
    const lines = wrapMixedText(text, 200, 10, fonts(), 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.endsWith('…')).toBe(true)
    expect(measureMixedLine(lines[1] ?? '', 10, fonts())).toBeLessThanOrEqual(200 + 1e-6)
  })

  it('maxLines larger than the natural line count changes nothing', () => {
    const lines = wrapMixedText('short', 400, 10, fonts(), 10)
    expect(lines).toEqual(['short'])
  })
})
