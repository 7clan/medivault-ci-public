/**
 * Image → single-page PDF wrapper (ff-2b).
 *
 * The native save command accepts PDF magic ONLY (images are wrapped
 * into a PDF upstream), so JPEG/PNG documents viewed in the document
 * viewer are embedded into a one-page PDF sized to the image before the
 * save/export. Printing opens the raw image bytes directly (the Rust
 * bridge accepts PDF/JPEG/PNG for printing).
 */

import { PDFDocument } from 'pdf-lib'

/** Hard cap so pathological scans never exceed PDF engine page limits. */
const MAX_PAGE_PT = 14000

/**
 * Wrap JPEG/PNG bytes as a one-page PDF whose page is sized to the image
 * (points). Oversized images are scaled down proportionally.
 */
export async function wrapImageAsPdf(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const image =
    mimeType === 'image/png'
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes)

  let width = image.width
  let height = image.height
  const longest = Math.max(width, height)
  if (longest > MAX_PAGE_PT) {
    const scale = MAX_PAGE_PT / longest
    width *= scale
    height *= scale
  }
  const page = pdf.addPage([width, height])
  page.drawImage(image, { x: 0, y: 0, width, height })

  return pdf.save()
}
