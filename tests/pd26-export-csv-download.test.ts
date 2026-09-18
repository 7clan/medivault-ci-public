/**
 * BUG-PD26 regression coverage — the Export CSV webview navigation.
 *
 * Product bug (run 35341388397, shard E, de6 — the first-red P2, only
 * reachable after the PD23 viewer fix let the desktop battery proceed):
 * the dashboard's Export CSV button did
 * `window.location.href = '/api/patients/export'` — a TOP-LEVEL WEBVIEW
 * NAVIGATION to an attachment endpoint. macOS WKWebView (Tauri) does not
 * turn that into a file save in this app: it rendered the raw CSV inline,
 * REPLACING the app UI with patient data (the evidence: the webview showed
 * the CSV rows — headers + both fixture patients — nothing landed in
 * ~/Downloads, and the battery had to recover the app).
 *
 * The fix mirrors the viewer's proven Download pattern: fetch (with
 * credentials) -> blob -> object URL -> <a download> click -> revoke —
 * which WKWebView handles as a real file save.
 * Fail-closed static coverage — the same pattern as
 * pd23-view-scroll-reset.test.ts / pd24-import-cancel-inflight.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

describe('BUG-PD26 — Export CSV must save a file, never navigate the webview', () => {
  const dashboard = readRepo('src/components/dashboard.tsx')

  it('the Export CSV button is wired to the blob-download handler (no inline arrow)', () => {
    expect(dashboard).toMatch(/onClick=\{handleExportCsv\}/)
  })

  it('NO top-level webview navigation to the export endpoint remains (the defect itself)', () => {
    expect(dashboard).not.toMatch(/window\.location\.href\s*=\s*['"`]\/api\/patients\/export/)
  })

  it('the handler fetches with credentials (the auth cookie must ride the export request)', () => {
    const handlerAt = dashboard.indexOf('const handleExportCsv')
    const handler = dashboard.slice(handlerAt, dashboard.indexOf('const handleScanDocument', handlerAt) === -1 ? undefined : dashboard.indexOf('\n  }', handlerAt) + 6)
    expect(handler).toMatch(/fetch\(['"`]\/api\/patients\/export['"`],\s*\{\s*credentials:\s*'include'\s*\}\)/)
  })

  it('the handler uses the blob -> object URL -> anchor download pattern (the WKWebView-safe save)', () => {
    const handlerAt = dashboard.indexOf('const handleExportCsv')
    const handler = dashboard.slice(handlerAt, handlerAt + 1600)
    expect(handler).toMatch(/await res\.blob\(\)/)
    expect(handler).toMatch(/URL\.createObjectURL\(blob\)/)
    expect(handler).toMatch(/a\.download\s*=\s*`medivault-patients-/)
    expect(handler).toMatch(/a\.click\(\)/)
    expect(handler).toMatch(/URL\.revokeObjectURL\(url\)/)
  })

  it('the handler surfaces both outcomes (started + failed toasts)', () => {
    const handlerAt = dashboard.indexOf('const handleExportCsv')
    const handler = dashboard.slice(handlerAt, handlerAt + 1800)
    // FEATURE D (i18n): the toast titles moved from hardcoded literals to the
    // dashboard.exportStartedTitle / dashboard.exportFailedTitle catalog keys
    // (en values "Export Started" / "Export Failed"); both outcomes are still
    // surfaced by the handler.
    expect(handler).toMatch(/Export Started|dashboard\.exportStartedTitle/)
    expect(handler).toMatch(/Export Failed|dashboard\.exportFailedTitle/)
  })

  it('the API route still declares the attachment disposition (the server side of the contract)', () => {
    const route = readRepo('mini-services/api-service/src/routes/patients/index.ts')
    expect(route).toMatch(
      /Content-Disposition', `attachment; filename="medivault-patients-/,
    )
  })

  it('the analytics Export CSV button is NOT affected (the client-side exportCSV helper is the separate, correct path)', () => {
    const analytics = readRepo('src/components/analytics-dashboard.tsx')
    expect(analytics).toMatch(/onClick=\{handleExportAll\}/)
    expect(analytics).not.toMatch(/window\.location\.href/)
  })
})
