/**
 * Shared A4 layout composer for the MediVault clinical PDFs (ff-2b).
 *
 * Both generators (`report-pdf.ts`, `prescription-pdf.ts`) draw through
 * this composer so the documents share one visual language: ~56pt
 * margins, emerald accents, bold Helvetica headings (Amiri carries the
 * Arabic runs — see fonts.ts), and RTL-aware anchoring driven by the
 * document locale (labels/anchors mirror; every text draw goes through
 * the mixed-direction line renderer in arabic.ts).
 *
 * Labels reuse the EXISTING i18n catalog keys (report.*, patients.*,
 * print.*, …) via the pure `translate()` export, so the PDFs use the same
 * wording as the on-screen dialogs; dates follow the app-wide
 * `ar-u-nu-latn` convention (Latin digits in Arabic documents).
 */

import { PDFPage, rgb, type Color, type PDFDocument } from 'pdf-lib'
import { translate, type Locale } from '@/i18n'
import type { EmbeddedPdfFonts } from './fonts'
import {
  drawMixedLine,
  measureMixedLine,
  type MixedLineFonts,
} from './arabic'

export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89
export const PAGE_MARGIN = 56
/** Space reserved at the bottom of every page for the footer band. */
export const FOOTER_ZONE = 64

export const INK = rgb(0.1, 0.1, 0.1)
export const MUTED = rgb(0.42, 0.45, 0.47)
export const ACCENT = rgb(0.02, 0.59, 0.41) // emerald (#059669)
export const ACCENT_SOFT = rgb(0.94, 0.99, 0.96) // emerald-50 (#f0fdf4)
export const ACCENT_PALE = rgb(0.77, 0.92, 0.84) // emerald-200 (#bbf7d0)
export const RULE = rgb(0.88, 0.89, 0.9)
export const PAPER = rgb(1, 1, 1)

export type Align = 'start' | 'end' | 'center'

export interface DrawTextOptions {
  size: number
  /** Bold Latin face (Arabic runs stay Amiri regular — no bold cut shipped). */
  bold?: boolean
  color?: Color
  align?: Align
  /** Right edge (RTL) / left edge (LTR) — defaults to the content box. */
  x?: number
  /** Baseline y — defaults to the composer cursor. */
  y?: number
  maxWidth?: number
}

/** Wrap mixed-direction text to a pixel width (word wrap + hard breaks). */
export function wrapMixedText(
  text: string,
  maxWidth: number,
  size: number,
  fonts: MixedLineFonts,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  const lines: string[] = []
  let current = ''
  const words = text.split(/\s+/).filter(Boolean)
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && measureMixedLine(candidate, size, fonts) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
    // Hard-break any single word wider than the column — including the
    // FIRST one (a lone oversized word must never overflow the column).
    while (measureMixedLine(current, size, fonts) > maxWidth) {
      let lo = 1
      let hi = current.length
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (measureMixedLine(current.slice(0, mid), size, fonts) <= maxWidth) lo = mid + 1
        else hi = mid
      }
      if (lo <= 1) break
      lines.push(current.slice(0, lo - 1))
      current = current.slice(lo - 1)
    }
  }
  if (current) lines.push(current)

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1] ?? ''
    const ellipsis = '…'
    while (
      last.length > 1 &&
      measureMixedLine(`${last}${ellipsis}`, size, fonts) > maxWidth
    ) {
      last = last.slice(0, -1)
    }
    kept[maxLines - 1] = `${last}${ellipsis}`
    return kept
  }
  return lines
}

export interface ComposerInit {
  pdf: PDFDocument
  locale: Locale
  fonts: EmbeddedPdfFonts
}

/**
 * One-document composer: cursor tracking, page breaks, RTL-aware text,
 * stat boxes, and the footer band (page numbers + attribution) stamped
 * once at the end.
 */
export class PdfComposer {
  readonly pdf: PDFDocument
  readonly locale: Locale
  readonly rtl: boolean
  private readonly fonts: EmbeddedPdfFonts
  private page: PDFPage
  /** Baseline cursor for the NEXT line (y decreases down the page). */
  y = A4_HEIGHT - PAGE_MARGIN

  constructor(init: ComposerInit) {
    this.pdf = init.pdf
    this.locale = init.locale
    this.rtl = init.locale === 'ar'
    this.fonts = init.fonts
    this.page = init.pdf.addPage([A4_WIDTH, A4_HEIGHT])
  }

  // ── geometry ────────────────────────────────────────────────────────

  get contentWidth(): number {
    return A4_WIDTH - 2 * PAGE_MARGIN
  }
  get leftX(): number {
    return PAGE_MARGIN
  }
  get rightX(): number {
    return A4_WIDTH - PAGE_MARGIN
  }

  private fontsFor(bold?: boolean): MixedLineFonts {
    return { arabic: this.fonts.amiri, latin: bold ? this.fonts.latinBold : this.fonts.latin }
  }

  // ── localization ────────────────────────────────────────────────────

  t(key: string, params?: Record<string, string | number>): string {
    return translate(this.locale, key, params)
  }

  private dateLocaleTag(): string {
    return this.locale === 'ar' ? 'ar-u-nu-latn' : 'en-US'
  }

  formatDate(value: string | number | Date): string {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(this.dateLocaleTag(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  }

  formatDateTime(value: string | number | Date): string {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(this.dateLocaleTag(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  }

  // ── pages ───────────────────────────────────────────────────────────

  newPage(): void {
    this.page = this.pdf.addPage([A4_WIDTH, A4_HEIGHT])
    this.y = A4_HEIGHT - PAGE_MARGIN
  }

  /** Page-break when `needed` points no longer fit above the footer. */
  ensure(needed: number): void {
    if (this.y - needed < PAGE_MARGIN + FOOTER_ZONE) this.newPage()
  }

  get currentPage(): PDFPage {
    return this.page
  }

  // ── drawing primitives ──────────────────────────────────────────────

  /** Draw one mixed-direction line; returns the x edge where drawing ended. */
  drawText(text: string, options: DrawTextOptions): number {
    const fonts = this.fontsFor(options.bold)
    const align = options.align ?? 'start'

    // Optional width budget: truncate to a single line with an ellipsis.
    let content = text
    if (options.maxWidth !== undefined) {
      if (measureMixedLine(content, options.size, fonts) > options.maxWidth) {
        content = wrapMixedText(content, options.maxWidth, options.size, fonts, 1)[0] ?? content
      }
    }
    const width = measureMixedLine(content, options.size, fonts)

    // Anchor default per alignment: 'start' → content-box start edge,
    // 'end' → content-box end edge, 'center' → page center.
    let anchorX = options.x
    if (anchorX === undefined) {
      if (align === 'end') anchorX = this.rtl ? this.leftX : this.rightX
      else if (align === 'center') anchorX = A4_WIDTH / 2
      else anchorX = this.rtl ? this.rightX : this.leftX
    }
    // Resolve the draw anchor for the mixed-line renderer:
    //  - LTR docs draw left-to-right from the LEFT edge of each run span.
    //  - RTL docs draw right-to-left from the RIGHT edge of the span.
    let x = anchorX
    if (this.rtl) {
      if (align === 'end') x = anchorX + width
      else if (align === 'center') x = anchorX + width / 2
    } else {
      if (align === 'end') x = anchorX - width
      else if (align === 'center') x = anchorX - width / 2
    }
    return drawMixedLine(this.page, content, {
      direction: this.rtl ? 'rtl' : 'ltr',
      x,
      y: options.y ?? this.y,
      size: options.size,
      arabic: fonts.arabic,
      latin: fonts.latin,
      color: options.color ?? INK,
    })
  }

  /** Convenience: draws at the cursor and advances it by the line height. */
  line(text: string, options: DrawTextOptions): void {
    this.drawText(text, { ...options, y: this.y })
    this.y -= (options.size + 4)
  }

  /**
   * Label/value row: bold label at the START anchor, muted value after
   * it (to its logical continuation side). Returns the consumed height.
   */
  labelValueRow(
    label: string,
    value: string,
    options: { size?: number; valueColor?: Color } = {},
  ): void {
    const size = options.size ?? 10
    const fonts = this.fontsFor(false)
    const labelDraw = `${label}:`
    const labelWidth = measureMixedLine(labelDraw, size, fonts)
    const valueWidth = measureMixedLine(value, size, fonts)
    const rowWidth = labelWidth + 6 + valueWidth
    if (rowWidth > this.contentWidth) {
      // Value wraps onto continuation lines under a full-width label row.
      this.drawText(labelDraw, { size, bold: true })
      this.y -= size + 2
      for (const ln of wrapMixedText(value, this.contentWidth, size, fonts)) {
        this.drawText(ln, { size, color: options.valueColor ?? MUTED })
        this.y -= size + 3
      }
      this.y += 3
      return
    }
    const y = this.y
    if (this.rtl) {
      this.drawText(labelDraw, { size, bold: true, x: this.rightX, y })
      this.drawText(value, { size, color: options.valueColor ?? MUTED, x: this.rightX - labelWidth - 6, y })
    } else {
      this.drawText(labelDraw, { size, bold: true, x: this.leftX, y })
      this.drawText(value, { size, color: options.valueColor ?? MUTED, x: this.leftX + labelWidth + 6, y })
    }
    this.y -= size + 6
  }

  /** Emerald section header with a rule; advances the cursor. */
  sectionHeader(text: string): void {
    this.ensure(58)
    this.drawText(text.toUpperCase(), { size: 10.5, bold: true, color: ACCENT })
    this.y -= 6
    this.page.drawLine({
      start: { x: this.leftX, y: this.y },
      end: { x: this.rightX, y: this.y },
      thickness: 1,
      color: ACCENT,
    })
    this.y -= 16
  }

  /** Horizontal divider. */
  divider(color: Color = RULE): void {
    this.page.drawLine({
      start: { x: this.leftX, y: this.y },
      end: { x: this.rightX, y: this.y },
      thickness: 0.75,
      color,
    })
    this.y -= 10
  }

  /** Small vertical spacing. */
  space(pts: number): void {
    this.y -= pts
  }

  /**
   * Three stat boxes in one row (value + label), mirrored for RTL.
   * `boxes: Array<[value, labelKey]>`.
   */
  statBoxes(boxes: ReadonlyArray<readonly [string, string]>): void {
    const gap = 10
    const boxWidth = (this.contentWidth - 2 * gap) / 3
    const boxHeight = 52
    this.ensure(boxHeight + 14)
    const y = this.y - boxHeight
    boxes.forEach(([value, labelKey], i) => {
      const index = this.rtl ? boxes.length - 1 - i : i
      const x = this.leftX + index * (boxWidth + gap)
      this.page.drawRectangle({
        x,
        y,
        width: boxWidth,
        height: boxHeight,
        color: ACCENT_SOFT,
        borderColor: ACCENT_PALE,
        borderWidth: 1,
      })
      // Value (bold, may itself be mixed).
      this.drawText(value, {
        size: 16,
        bold: true,
        align: 'center',
        x: x + boxWidth / 2,
        y: y + boxHeight - 22,
      })
      // Label — localized, uppercase-ish small text.
      this.drawText(this.t(labelKey), {
        size: 7.5,
        color: MUTED,
        align: 'center',
        x: x + boxWidth / 2,
        y: y + 10,
      })
    })
    this.y = y - 14
  }

  /** Signature line at the END side of the content box; cursor advances. */
  signatureLine(): void {
    const width = 170
    const x = this.rtl ? this.leftX : this.rightX - width
    this.page.drawLine({
      start: { x, y: this.y + 4 },
      end: { x: x + width, y: this.y + 4 },
      thickness: 0.75,
      color: INK,
    })
    this.y -= 8
  }

  /** Stamp the footer band (attribution + page numbers) on every page. */
  stampFooters(attributionKey: string): void {
    const pages = this.pdf.getPages()
    const total = pages.length
    const attribution = this.t(attributionKey)
    pages.forEach((page, i) => {
      const footerY = PAGE_MARGIN / 2 + 6
      page.drawLine({
        start: { x: this.leftX, y: footerY + 12 },
        end: { x: this.rightX, y: footerY + 12 },
        thickness: 0.75,
        color: RULE,
      })
      // Shrink long attributions (Arabic is often wider) until they fit.
      let size = 7.5
      const fonts = this.fontsFor(false)
      while (
        size > 5 &&
        measureMixedLine(attribution, size, fonts) > this.contentWidth - 60
      ) {
        size -= 0.25
      }
      const attrWidth = measureMixedLine(attribution, size, fonts)
      const center = A4_WIDTH / 2
      drawMixedLine(page, attribution, {
        direction: this.rtl ? 'rtl' : 'ltr',
        x: this.rtl ? center + attrWidth / 2 : center - attrWidth / 2,
        y: footerY,
        size,
        arabic: fonts.arabic,
        latin: fonts.latin,
        color: MUTED,
      })
      // Page number — Latin digits per the ar-u-nu-latn convention.
      const pageNo = `${i + 1} / ${total}`
      const noWidth = this.fonts.latin.widthOfTextAtSize(pageNo, 8)
      if (this.rtl) {
        page.drawText(pageNo, { x: this.leftX, y: footerY, size: 8, font: this.fonts.latin, color: MUTED })
      } else {
        page.drawText(pageNo, {
          x: this.rightX - noWidth,
          y: footerY,
          size: 8,
          font: this.fonts.latin,
          color: MUTED,
        })
      }
    })
  }
}
