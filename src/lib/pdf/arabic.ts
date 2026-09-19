/**
 * Pragmatic Arabic/bidi support for pdf-lib documents (ff-2b).
 *
 * pdf-lib has no shaping or bidi engine: it draws each string left to
 * right with a single font. The MediVault clinical documents need mixed
 * Arabic + Latin content on one line (names, dosages, dates), so this
 * module implements the pragmatic pipeline used for clinical documents:
 *
 *   1. `segmentIntoRuns` classifies each character as arabic / latin /
 *      neutral and groups consecutive characters of one class.
 *   2. `shapeArabic` maps Arabic letters to their positional
 *      PRESENTATION FORMS (U+FB50–U+FEFF) via arabic-persian-reshaper,
 *      including lam-alef ligatures.
 *   3. `drawMixedLine` lays the runs out in the requested base
 *      direction: for RTL base the RUN ORDER is reversed (the first
 *      logical run is drawn rightmost) while Latin runs keep their
 *      character order; Arabic runs are drawn shaped + glyph-reversed
 *      (pdf-lib draws LTR, so reversing the shaped glyph sequence
 *      produces the visually correct RTL column).
 *
 * LIMITS (documented, acceptable for clinical documents):
 *   - No full UAX#9 algorithm: a neutral run attaches to the preceding
 *     non-neutral run (or the following one at line start) instead of
 *     resolving N1/N2 against both neighbours. For clinical lines —
 *     which are either a single name/dosage/date or "arabic + latin"
 *     pairs — this is indistinguishable from the reference algorithm.
 *   - Bracket mirroring is handled with a fixed mirror map; anything not
 *     in the map keeps its codepoint.
 *   - Arabic-Indic DIGITS are treated as neutral→latin run content only
 *     when embedded in Latin runs; the app itself formats dates with
 *     Latin digits (ar-u-nu-latn convention).
 */

import type { Color, PDFPage, PDFFont } from 'pdf-lib'
import { ArabicShaper } from 'arabic-persian-reshaper'

// ---------------------------------------------------------------------------
// Script classification
// ---------------------------------------------------------------------------

/** Unicode ranges considered ARABIC (base + supplements + presentation forms). */
const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
]

function isArabicCodePoint(cp: number): boolean {
  for (const [lo, hi] of ARABIC_RANGES) {
    if (cp >= lo && cp <= hi) return true
  }
  return false
}

function isLatinCodePoint(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) || // a-z
    (cp >= 0x30 && cp <= 0x39) || // 0-9 (Latin digits)
    cp === 0xc0 || (cp >= 0xc0 && cp <= 0x24f) // Latin-1 Supplement + Latin Extended
  )
}

export type RunScript = 'arabic' | 'latin' | 'neutral'

export interface ScriptRun {
  text: string
  script: RunScript
}

/**
 * True when the string contains at least one Arabic character (base,
 * supplement, extended or presentation form). Mixed strings like
 * "أحمد Smith" are Arabic for layout purposes.
 */
export function isArabicText(text: string): boolean {
  for (const ch of text) {
    if (isArabicCodePoint(ch.codePointAt(0) ?? 0)) return true
  }
  return false
}

/**
 * Split text into ordered runs of one script class each.
 *
 * Pure function — deterministic, no side effects.
 */
export function segmentIntoRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = []
  let current: ScriptRun | null = null

  const classOf = (ch: string): RunScript => {
    const cp = ch.codePointAt(0) ?? 0
    if (isArabicCodePoint(cp)) return 'arabic'
    if (isLatinCodePoint(cp)) return 'latin'
    return 'neutral'
  }

  for (const ch of text) {
    const script = classOf(ch)
    if (current && current.script === script) {
      current.text += ch
    } else {
      current = { text: ch, script }
      runs.push(current)
    }
  }
  return runs
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/**
 * Reshape Arabic letters into their positional presentation forms.
 *
 * Non-Arabic strings pass through untouched; a mixed string is shaped as
 * a whole (the shaper leaves Latin characters alone) — callers that need
 * per-script shaping segment first and shape only the arabic runs.
 */
export function shapeArabic(text: string): string {
  if (!isArabicText(text)) return text
  return ArabicShaper.convertArabic(text)
}

/** Mirror map for brackets inside reversed (RTL) runs. */
const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
}

/** Reverse a string by CODE POINTS (never splits surrogate pairs). */
function reverseGlyphs(text: string): string {
  return Array.from(text)
    .reverse()
    .map((ch) => MIRROR[ch] ?? ch)
    .join('')
}

// ---------------------------------------------------------------------------
// Mixed-direction line drawing
// ---------------------------------------------------------------------------

export interface MixedLineFonts {
  arabic: PDFFont
  latin: PDFFont
}

export interface DrawMixedLineOptions extends MixedLineFonts {
  /** Base direction of the line. */
  direction: 'ltr' | 'rtl'
  /** LTR: left edge of the line. RTL: RIGHT edge of the line. */
  x: number
  /** Baseline y. */
  y: number
  size: number
  /** Draw color. */
  color: Color
}

/**
 * The visual string for one run: Arabic runs are shaped + glyph-reversed
 * (+ bracket mirrored); Latin runs keep their character order.
 */
export function renderRunText(run: ScriptRun): string {
  if (run.script === 'arabic') return reverseGlyphs(shapeArabic(run.text))
  return run.text
}

/** Attach neutral runs to a neighbour (preceding first, else following). */
function mergeNeutralRuns(runs: ScriptRun[]): ScriptRun[] {
  const merged: ScriptRun[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (run.script === 'neutral' && last) {
      last.text += run.text
    } else if (run.script === 'neutral' && !last) {
      // Neutral prefix — remember it until a non-neutral run appears.
      merged.push({ ...run })
    } else if (last && last.script === 'neutral') {
      // Non-neutral run after a leading neutral prefix: prepend it.
      last.text = run.text + last.text
      last.script = run.script
    } else {
      merged.push({ ...run })
    }
  }
  // A pure-neutral line renders as a Latin (LTR) line.
  return merged.map((r) => (r.script === 'neutral' ? { ...r, script: 'latin' as const } : r))
}

/** Width of the rendered line at the given size (draw-neutral-merged). */
export function measureMixedLine(
  text: string,
  size: number,
  fonts: MixedLineFonts,
): number {
  let width = 0
  for (const run of mergeNeutralRuns(segmentIntoRuns(text))) {
    const font = run.script === 'arabic' ? fonts.arabic : fonts.latin
    width += font.widthOfTextAtSize(renderRunText(run), size)
  }
  return width
}

/**
 * Draw one mixed Arabic/Latin line onto a pdf-lib page.
 *
 * RTL base: run order is REVERSED (first logical run ends up rightmost),
 * starting at `x` (the RIGHT edge) and advancing left. Latin runs are
 * never internally reversed; Arabic runs are shaped + glyph-reversed.
 *
 * Returns the far edge reached (LTR: the right end x; RTL: the left end x)
 * so callers can compose following content.
 */
export function drawMixedLine(
  page: PDFPage,
  text: string,
  options: DrawMixedLineOptions,
): number {
  const runs = mergeNeutralRuns(segmentIntoRuns(text))
  const drawOrder = options.direction === 'rtl' ? [...runs].reverse() : runs

  let cursor = options.x
  for (const run of drawOrder) {
    const font = run.script === 'arabic' ? options.arabic : options.latin
    const display = renderRunText(run)
    const width = font.widthOfTextAtSize(display, options.size)
    if (options.direction === 'rtl') {
      cursor -= width
      page.drawText(display, {
        x: cursor,
        y: options.y,
        size: options.size,
        font,
        color: options.color,
      })
    } else {
      page.drawText(display, {
        x: cursor,
        y: options.y,
        size: options.size,
        font,
        color: options.color,
      })
      cursor += width
    }
  }
  return cursor
}
