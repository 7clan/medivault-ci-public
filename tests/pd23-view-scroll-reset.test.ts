/**
 * BUG-PD23 regression coverage — the view-transition scroll reset.
 *
 * Product bug (the DE1/DB6 document-viewer P1, proven across three macOS
 * runs + the local production repro): the window is the scroll owner for
 * every top-level view (main's content grows the body; the overflow-hidden
 * on main is inert), and no view transition ever reset it — a deep
 * patient-detail scroll carried into the document viewer CLAMPED to the
 * new page's maxScroll, opening the document BELOW its header (back
 * button/title/category/toolbar scrolled out of view; identical for the
 * image and the PDF branch; the viewer itself mounted and rendered
 * correctly the whole time).
 *
 * The fix is a single useEffect in src/app/page.tsx keyed on currentView
 * that resets the window scroll. This test pins the contract to the
 * source (fail-closed static coverage — the same pattern as
 * helper-name-regression.test.ts): the reset must exist, must be keyed on
 * currentView, must be instant (no smooth behavior), and must live in the
 * navigation layer (page.tsx), NOT inside the Zustand store.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

describe('BUG-PD23 — view-transition scroll reset (the viewer P1 root cause)', () => {
  const page = readRepo('src/app/page.tsx')

  it('page.tsx resets the window scroll on every currentView change', () => {
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*window\.scrollTo\(0, 0\)\s*\}, \[currentView\]\)/,
    )
  })

  it('the reset is instant — no smooth scrolling on the view transition', () => {
    expect(page).not.toMatch(/scrollTo\(\{[^}]*behavior:\s*['"]smooth/)
  })

  it('the reset lives in the navigation layer (page.tsx), not the store', () => {
    const store = readRepo('src/store/app-store.ts')
    expect(store).not.toMatch(/scrollTo|scroll/)
  })

  it('the DocumentViewer exposes stable QA anchors (title + container)', () => {
    const viewer = readRepo('src/components/document-viewer.tsx')
    expect(viewer).toContain('data-qa="document-viewer"')
    expect(viewer).toContain('data-qa="document-viewer-title"')
    expect(viewer).toContain('data-qa="document-viewer-frame"')
  })

  it('the store contract is unchanged: selectDocument switches the view + doc', () => {
    const store = readRepo('src/store/app-store.ts')
    expect(store).toMatch(
      /selectedDocument: doc, currentView: 'document-viewer', previousView: 'patient-detail'/,
    )
  })
})
