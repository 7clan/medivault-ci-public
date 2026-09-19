/**
 * Font loading for the client-side PDF generators (ff-2b).
 *
 * The clinical PDFs must render ARABIC content correctly (Lebanon clinic
 * use case — Arabic-locale reports and prescriptions exist), so every
 * document embeds Amiri (SIL OFL 1.1, see public/fonts/Amiri-OFL.txt)
 * alongside pdf-lib's standard Helvetica faces.
 *
 * The font is served SAME-ORIGIN by both app surfaces: the Next.js
 * static export copies `public/` into `out/` (the tauri:// first-run
 * surface) and the Fastify static-frontend plugin serves the same
 * `out/` tree at http://127.0.0.1:3001 — so `/fonts/Amiri-Regular.ttf`
 * resolves identically on both.
 */

import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const AMIRI_FONT_URL = '/fonts/Amiri-Regular.ttf'

/** Module-scope cache — the font is fetched at most once per session. */
let amiriBytes: ArrayBuffer | null = null

/**
 * Fetch the Amiri Regular TTF as an ArrayBuffer (cached).
 *
 * Deterministic and dependency-free: plain `fetch`, no font parsing.
 */
export async function loadAmiriFontData(): Promise<ArrayBuffer> {
  if (amiriBytes) return amiriBytes
  const res = await fetch(AMIRI_FONT_URL)
  if (!res.ok) {
    throw new Error(
      `The Arabic font could not be loaded (HTTP ${res.status}) — PDF generation is unavailable.`,
    )
  }
  amiriBytes = await res.arrayBuffer()
  return amiriBytes
}

/** Test/maintenance hook — drop the cached font bytes. */
export function clearAmiriFontCache(): void {
  amiriBytes = null
}

export interface EmbeddedPdfFonts {
  /** Amiri Regular — the ONLY font that can encode Arabic presentation forms. */
  amiri: PDFFont
  /** Helvetica — Latin runs, labels and numerals. */
  latin: PDFFont
  /** Helvetica Bold — headings and emphasis. */
  latinBold: PDFFont
}

/**
 * Embed the standard font set into a PDFDocument.
 *
 * NOTE: standard fonts (Helvetica) use WinAnsi encoding and CANNOT encode
 * Arabic — every Arabic run must be drawn with `amiri` (see arabic.ts).
 * Custom-font embedding REQUIRES a registered fontkit instance (the
 * official `@pdf-lib/fontkit` companion package — pdf-lib deliberately
 * ships without it), registered once per document before `embedFont`.
 */
export async function embedPdfFonts(pdf: PDFDocument): Promise<EmbeddedPdfFonts> {
  pdf.registerFontkit(fontkit)
  const [amiri, latin, latinBold] = await Promise.all([
    pdf.embedFont(await loadAmiriFontData()),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
  ])
  return { amiri, latin, latinBold }
}
