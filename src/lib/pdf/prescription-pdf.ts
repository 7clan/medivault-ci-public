/**
 * Prescription PDF generator (ff-2b).
 *
 * Produces a REAL client-side PDF (pdf-lib) from the same
 * `PrescriptionPrintData` the on-screen print dialog already holds —
 * the bytes are handed to the native print/PDF bridge
 * (`src/lib/print-bridge.ts`), replacing the WKWebView `document.write` +
 * `window.print()` flow that never opens a native print sheet.
 *
 * Layout: doctor header, patient block, medications table
 * (name / dosage / frequency / duration / instructions), notes,
 * signature line, footer. RTL + Arabic labels when `locale === 'ar'`.
 */

import { PDFDocument, rgb } from 'pdf-lib'
import type { Locale } from '@/i18n'
import type { PrescriptionPrintData } from '@/components/prescription-print'
import { embedPdfFonts } from './fonts'
import {
  ACCENT,
  ACCENT_PALE,
  ACCENT_SOFT,
  A4_HEIGHT,
  INK,
  MUTED,
  PAGE_MARGIN,
  PdfComposer,
  wrapMixedText,
} from './layout'

/** Translate a stored frequency/duration value, falling back to the raw value. */
function storedValueLabel(
  t: (key: string) => string,
  namespace: 'prescriptions.freq' | 'prescriptions.duration',
  value: string,
): string {
  if (!value) return ''
  const key = `${namespace}.${value}`
  const label = t(key)
  return label === key ? value : label
}

interface ColumnSpec {
  key: 'num' | 'name' | 'dosage' | 'frequency' | 'duration' | 'instructions'
  labelKey: string
  width: number
  maxLines: number
}

const COLUMNS: ReadonlyArray<ColumnSpec> = [
  { key: 'num', labelKey: '', width: 24, maxLines: 1 },
  { key: 'name', labelKey: 'print.colMedication', width: 106, maxLines: 3 },
  { key: 'dosage', labelKey: 'print.colDosage', width: 70, maxLines: 2 },
  { key: 'frequency', labelKey: 'print.colFrequency', width: 82, maxLines: 2 },
  { key: 'duration', labelKey: 'print.colDuration', width: 64, maxLines: 2 },
  { key: 'instructions', labelKey: 'print.colInstructions', width: 137, maxLines: 3 },
]

/**
 * Start anchor + inner width of a table column (mirrored for RTL:
 * LTR anchors the column's left edge, RTL anchors its RIGHT edge).
 */
function columnAnchor(index: number, composer: PdfComposer): { x: number; width: number } {
  const spec = COLUMNS[index]
  const preceding = COLUMNS.slice(0, index).reduce((sum, col) => sum + col.width, 0)
  const left = composer.rtl
    ? composer.rightX - preceding - spec.width
    : composer.leftX + preceding
  const x = composer.rtl ? left + spec.width - 4 : left + 4
  return { x, width: spec.width - 8 }
}

/**
 * Generate the prescription PDF.
 *
 * @param data the PrescriptionPrintData the dialog already holds
 * @param locale UI locale for labels and base direction ('ar' → RTL)
 */
export async function generatePrescriptionPdf(
  data: PrescriptionPrintData,
  locale: Locale,
): Promise<Uint8Array> {
  const { prescription, medications } = data
  const patient = prescription.patient
  const doctor = prescription.doctor

  const pdf = await PDFDocument.create()
  pdf.setTitle('MediVault — Prescription', { showInWindowTitleBar: true })
  pdf.setCreator('MediVault')
  pdf.setCreationDate(new Date())

  const fonts = await embedPdfFonts(pdf)
  const c = new PdfComposer({ pdf, locale, fonts })
  const t = (key: string, params?: Record<string, string | number>) => c.t(key, params)
  const bodyFont = { arabic: fonts.amiri, latin: fonts.latin }
  const nameFont = { arabic: fonts.amiri, latin: fonts.latinBold }

  // ── Header: doctor block (START) + Rx title (END) ─────────────────────
  const topY = A4_HEIGHT - PAGE_MARGIN - 10
  c.drawText(doctor?.name || t('common.doctor'), {
    size: 15,
    bold: true,
    color: ACCENT,
    y: topY,
  })
  if (doctor?.specialty) {
    c.drawText(doctor.specialty, { size: 9.5, color: MUTED, y: topY - 15 })
  }
  if (doctor?.phone) {
    c.drawText(doctor.phone, { size: 9.5, color: MUTED, y: topY - 28 })
  }
  c.drawText(t('print.prescription.header'), {
    size: 12,
    bold: true,
    align: 'end',
    y: topY,
  })
  c.drawText(c.formatDate(prescription.createdAt), {
    size: 9,
    color: MUTED,
    align: 'end',
    y: topY - 15,
  })
  c.drawText(`#${prescription.id.slice(0, 8)}`, {
    size: 8,
    color: MUTED,
    align: 'end',
    y: topY - 28,
  })
  c.y = topY - 44
  c.divider(ACCENT)
  c.space(4)

  // ── Patient block ───────────────────────────────────────────────────
  const blockHeight = 64
  c.ensure(blockHeight + 12)
  const blockTop = c.y
  c.currentPage.drawRectangle({
    x: c.leftX,
    y: blockTop - blockHeight,
    width: c.contentWidth,
    height: blockHeight,
    color: ACCENT_SOFT,
    borderColor: ACCENT_PALE,
    borderWidth: 1,
  })
  const secondColumnAnchor = c.leftX + c.contentWidth / 2
  c.drawText(t('patients.title'), { size: 7.5, bold: true, color: ACCENT, y: blockTop - 12 })
  c.drawText(
    patient ? `${patient.firstName} ${patient.lastName}`.trim() : t('print.notAvailable'),
    { size: 11, y: blockTop - 25, maxWidth: c.contentWidth / 2 - 12 },
  )
  if (patient?.dateOfBirth) {
    c.drawText(t('patients.dob'), {
      size: 7.5,
      bold: true,
      color: ACCENT,
      x: secondColumnAnchor,
      y: blockTop - 12,
    })
    c.drawText(c.formatDate(patient.dateOfBirth), {
      size: 10,
      x: secondColumnAnchor,
      y: blockTop - 25,
      maxWidth: c.contentWidth / 2 - 12,
    })
  }
  if (patient?.phone) {
    c.drawText(`${t('patients.phone')}: ${patient.phone}`, {
      size: 9,
      color: MUTED,
      y: blockTop - 44,
    })
  }
  if (patient?.address) {
    c.drawText(`${t('patients.address')}: ${patient.address}`, {
      size: 8,
      color: MUTED,
      x: secondColumnAnchor,
      y: blockTop - 44,
      maxWidth: c.contentWidth / 2 - 8,
    })
  }
  c.y = blockTop - blockHeight - 14

  // ── Medications table ────────────────────────────────────────────────
  const drawTableHeader = (y: number): number => {
    c.currentPage.drawRectangle({
      x: c.leftX,
      y: y - 20,
      width: c.contentWidth,
      height: 20,
      color: ACCENT,
    })
    COLUMNS.forEach((spec, i) => {
      if (spec.key === 'num') return
      const { x, width } = columnAnchor(i, c)
      c.drawText(t(spec.labelKey).toUpperCase(), {
        size: 7,
        bold: true,
        color: rgb(1, 1, 1),
        x,
        y: y - 13,
        maxWidth: width,
      })
    })
    return y - 20
  }

  c.y = drawTableHeader(c.y)

  medications.forEach((med, idx) => {
    const cells: Record<string, string[]> = {
      num: [String(idx + 1)],
      name: wrapMixedText(med.name || '', COLUMNS[1].width - 8, 9.5, nameFont, COLUMNS[1].maxLines),
      dosage: wrapMixedText(med.dosage || '', COLUMNS[2].width - 8, 9, bodyFont, COLUMNS[2].maxLines),
      frequency: wrapMixedText(
        storedValueLabel(t, 'prescriptions.freq', med.frequency),
        COLUMNS[3].width - 8,
        9,
        bodyFont,
        COLUMNS[3].maxLines,
      ),
      duration: wrapMixedText(
        storedValueLabel(t, 'prescriptions.duration', med.duration),
        COLUMNS[4].width - 8,
        9,
        bodyFont,
        COLUMNS[4].maxLines,
      ),
      instructions: wrapMixedText(
        med.instructions || '—',
        COLUMNS[5].width - 8,
        8.5,
        bodyFont,
        COLUMNS[5].maxLines,
      ),
    }
    const rowLines = Math.max(...COLUMNS.map((spec) => cells[spec.key]?.length ?? 1))
    const rowHeight = rowLines * 11.5 + 10

    // Page break (with a repeated header row).
    if (c.y - rowHeight < PAGE_MARGIN + 70) {
      c.newPage()
      c.y = drawTableHeader(c.y)
    }

    if (idx % 2 === 1) {
      c.currentPage.drawRectangle({
        x: c.leftX,
        y: c.y - rowHeight,
        width: c.contentWidth,
        height: rowHeight,
        color: rgb(0.976, 0.98, 0.984),
      })
    }

    COLUMNS.forEach((spec, i) => {
      const { x } = columnAnchor(i, c)
      const lines = cells[spec.key] ?? []
      lines.forEach((ln, li) => {
        c.drawText(ln, {
          size: spec.key === 'num' ? 8 : spec.key === 'name' ? 9.5 : 9,
          bold: spec.key === 'name',
          color: spec.key === 'num' || spec.key === 'instructions' ? MUTED : INK,
          x,
          y: c.y - 12 - li * 11.5,
        })
      })
    })
    c.y -= rowHeight
    c.currentPage.drawLine({
      start: { x: c.leftX, y: c.y + 5 },
      end: { x: c.rightX, y: c.y + 5 },
      thickness: 0.5,
      color: rgb(0.9, 0.91, 0.92),
    })
  })
  c.space(10)

  // ── Notes ────────────────────────────────────────────────────────────
  if (prescription.notes) {
    const noteLines = wrapMixedText(prescription.notes, c.contentWidth - 16, 9.5, bodyFont, 6)
    const noteHeight = noteLines.length * 13 + 24
    c.ensure(noteHeight + 8)
    const noteTop = c.y
    c.currentPage.drawRectangle({
      x: c.leftX,
      y: noteTop - noteHeight,
      width: c.contentWidth,
      height: noteHeight,
      color: rgb(1, 0.984, 0.922),
      borderColor: rgb(0.992, 0.902, 0.541),
      borderWidth: 1,
    })
    c.drawText(t('patients.notes'), {
      size: 7.5,
      bold: true,
      color: rgb(0.85, 0.47, 0.02),
      y: noteTop - 13,
    })
    noteLines.forEach((ln, i) => {
      c.drawText(ln, { size: 9.5, y: noteTop - 27 - i * 13 })
    })
    c.y = noteTop - noteHeight - 12
  }

  // ── Signature ────────────────────────────────────────────────────────
  c.ensure(60)
  c.space(24)
  c.signatureLine()
  c.drawText(t('print.doctorSignature'), { size: 8, color: MUTED, align: 'end' })

  // ── Footer band on every page ────────────────────────────────────────
  c.stampFooters('print.generatedBy')

  return pdf.save()
}
