/**
 * Patient Summary Report PDF generator (ff-2b).
 *
 * Produces a REAL client-side PDF (pdf-lib) from the EXACT summary shape
 * returned by `POST /api/reports` (mini-services/api-service/src/routes/
 * misc/index.ts) — the same JSON the on-screen dialog already fetched, so
 * no refetch and no API changes are involved. The bytes are handed to the
 * native print/PDF bridge (`src/lib/print-bridge.ts`).
 *
 * Layout: A4, ~56pt margins, MediVault header + generated date, patient
 * info block, document/visit/prescription/notes summaries, recent
 * annotations, signature line, footer with page numbers. RTL + Arabic
 * labels when `locale === 'ar'`.
 */

import { PDFDocument } from 'pdf-lib'
import type { Locale } from '@/i18n'
import { formatFileSize } from '@/lib/utils-helpers'
import { embedPdfFonts } from './fonts'
import { ACCENT, ACCENT_SOFT, PdfComposer, wrapMixedText } from './layout'
import { measureMixedLine } from './arabic'

/** The JSON returned by POST /api/reports (format: 'json'). */
export interface PatientReportSummary {
  generatedAt: string
  doctor: { name: string; email: string; specialty: string | null }
  patient: {
    id: string
    firstName: string
    lastName: string
    dateOfBirth: string | null
    phone: string | null
    email: string | null
    address: string | null
    notes: string | null
    createdAt: string
  }
  documents: {
    total: number
    byCategory: Record<string, number>
    totalStorage: number
    latestDocument: { title?: string | null; fileName?: string | null; scannedAt?: string } | null
  }
  visits: {
    total: number
    byStatus: Record<string, number>
    upcoming: number
    nextUpcoming: { visitDate: string; visitType: string } | null
  }
  prescriptions: { total: number; active: number }
  clinicalNotes: { total: number; pinned: number }
  recentActivity: Array<{
    type: string
    content: string
    documentName: string
    createdAt: string
  }>
}

/** Localized "age" — plain digits (ar-u-nu-latn convention). */
function formatAgeYears(dateOfBirth: string | null): string | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1
  if (age < 0 || age > 130) return null
  return String(age)
}

/**
 * Generate the Patient Summary Report PDF.
 *
 * @param summary the POST /api/reports JSON body the caller already holds
 * @param locale UI locale for labels and base direction ('ar' → RTL)
 */
export async function generatePatientReportPdf(
  summary: PatientReportSummary,
  locale: Locale,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('MediVault — Patient Summary Report', { showInWindowTitleBar: true })
  pdf.setCreator('MediVault')
  pdf.setCreationDate(new Date())

  const fonts = await embedPdfFonts(pdf)
  const c = new PdfComposer({ pdf, locale, fonts })
  const t = (key: string, params?: Record<string, string | number>) => c.t(key, params)

  // ── Header ───────────────────────────────────────────────────────────
  c.drawText('MediVault', { size: 22, bold: true, color: ACCENT })
  c.y -= 16
  c.drawText(t('report.title'), { size: 13, bold: true })
  c.y -= 14
  c.drawText(
    `${t('report.generated')}: ${c.formatDateTime(summary.generatedAt)}`,
    { size: 9, color: ACCENT },
  )
  c.y -= 6
  c.divider(ACCENT)
  c.space(6)

  // ── Patient information ──────────────────────────────────────────────
  c.sectionHeader(t('report.patientInformation'))
  const p = summary.patient
  c.labelValueRow(t('patients.fullName'), `${p.firstName} ${p.lastName}`.trim())
  const age = formatAgeYears(p.dateOfBirth)
  if (age) c.labelValueRow(t('patients.age'), age)
  if (p.dateOfBirth) c.labelValueRow(t('patients.dob'), c.formatDate(p.dateOfBirth))
  if (p.phone) c.labelValueRow(t('patients.phone'), p.phone)
  if (p.email) c.labelValueRow(t('patients.email'), p.email)
  if (p.address) c.labelValueRow(t('patients.address'), p.address)
  c.space(8)

  // ── Document summary ─────────────────────────────────────────────────
  c.sectionHeader(t('report.documentSummary'))
  c.statBoxes([
    [String(summary.documents.total), 'report.totalDocuments'],
    [String(Object.keys(summary.documents.byCategory ?? {}).length), 'report.categories'],
    [formatFileSize(summary.documents.totalStorage ?? 0), 'health.totalStorage'],
  ])
  const byCategory = summary.documents.byCategory ?? {}
  const categoryEntries = Object.entries(byCategory)
  if (categoryEntries.length > 0) {
    const catFont = { arabic: fonts.amiri, latin: fonts.latin }
    const parts: Array<[string, string]> = categoryEntries.map(([cat, count]) => [cat, String(count)])
    c.ensure(18)
    let currentY = c.y
    let lineParts: Array<[string, string]> = []
    const drawCategoryLine = () => {
      if (lineParts.length === 0) return
      const segments = lineParts.map(([cat, count]) => `${cat} × ${count}`)
      const line = segments.join('   ·   ')
      c.drawText(line, { y: currentY, size: 9 })
      currentY -= 13
    }
    for (const entry of parts) {
      lineParts.push(entry)
      const line = lineParts.map(([cat, count]) => `${cat} × ${count}`).join('   ·   ')
      if (measureMixedLine(line, 9, catFont) > c.contentWidth) {
        lineParts.pop()
        drawCategoryLine()
        lineParts = [entry]
      }
    }
    drawCategoryLine()
    c.y = currentY - 4
  }
  c.space(6)

  // ── Visit summary ────────────────────────────────────────────────────
  c.sectionHeader(t('report.visitSummary'))
  c.statBoxes([
    [String(summary.visits.total), 'report.totalVisits'],
    [String(summary.visits.upcoming), 'report.upcoming'],
    [String(summary.visits.byStatus?.completed ?? 0), 'report.completed'],
  ])
  if (summary.visits.nextUpcoming) {
    const next = summary.visits.nextUpcoming
    c.ensure(24)
    c.currentPage.drawRectangle({
      x: c.leftX,
      y: c.y - 22,
      width: c.contentWidth,
      height: 26,
      color: ACCENT_SOFT,
    })
    c.drawText(
      `${t('overview.next')}: ${c.formatDate(next.visitDate)} — ${next.visitType}`,
      { size: 9.5, y: c.y - 14 },
    )
    c.y -= 36
  }
  c.space(2)

  // ── Prescriptions & clinical notes ───────────────────────────────────
  c.ensure(70)
  c.sectionHeader(t('prescriptions.title'))
  c.labelValueRow(
    t('report.activePrescriptions'),
    t('report.ofTotal', { count: summary.prescriptions.total }),
  )
  c.space(2)
  c.sectionHeader(t('clinical.title'))
  c.labelValueRow(
    t('report.pinnedNotes'),
    t('report.ofTotal', { count: summary.clinicalNotes.total }),
  )
  c.space(8)

  // ── Recent annotations ───────────────────────────────────────────────
  const activity = (summary.recentActivity ?? []).slice(0, 10)
  if (activity.length > 0) {
    c.sectionHeader(t('report.recentAnnotations'))
    const bodyFont = { arabic: fonts.amiri, latin: fonts.latin }
    for (const item of activity) {
      const contentLines = wrapMixedText(item.content || '', c.contentWidth - 110, 9, bodyFont, 2)
      const rowHeight = contentLines.length * 12 + 6
      c.ensure(rowHeight + 6)
      const dateText = c.formatDate(item.createdAt)
      const rowTopY = c.y
      // Content lines (anchored at the START edge of the content box).
      let x = c.leftX
      for (const ln of contentLines) {
        x = c.drawText(ln, { size: 9, x: c.rtl ? c.rightX : c.leftX, y: c.y })
        c.y -= 12
      }
      // "on <document>" continues after the last content line.
      c.drawText(t('report.onDocument', { name: item.documentName }), {
        size: 7.5,
        x,
        y: c.y + 12,
      })
      // Date pinned at the END edge of the row.
      c.drawText(dateText, {
        size: 8,
        x: c.rtl ? c.leftX : c.rightX,
        align: 'end',
        y: rowTopY,
      })
      c.y -= 8
      c.divider()
    }
  }

  // ── Signature block ──────────────────────────────────────────────────
  c.ensure(90)
  c.space(18)
  c.divider()
  c.space(6)
  c.drawText(t('report.generatedOn', { date: c.formatDateTime(summary.generatedAt) }), {
    size: 9,
    color: ACCENT,
  })
  c.y -= 4
  c.drawText(t('common.appTagline'), { size: 9 })
  c.space(30)
  c.signatureLine()
  c.drawText(summary.doctor.name, { size: 9.5, bold: true, align: 'end' })
  if (summary.doctor.specialty) {
    c.y -= 13
    c.drawText(summary.doctor.specialty, { size: 8.5, align: 'end' })
  }

  // ── Footer band on every page ────────────────────────────────────────
  c.stampFooters('print.generatedBy')

  return pdf.save()
}
