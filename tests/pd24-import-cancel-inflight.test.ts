/**
 * BUG-PD24 regression coverage — the CSV import in-flight Cancel race (P2).
 *
 * Product bug (shard D dataio, the deferred P2): Cancel (or ESC / overlay /
 * X — every close path funnels through the dialog's onOpenChange) while the
 * import POST was in flight CLOSED the dialog even though the import still
 * committed server-side, and the user never saw the final result.
 *
 * Root cause: React commits the 'uploading' phase only AFTER handleImport
 * has already dispatched the fetch — in that render-lag window handleClose
 * still saw phase='idle' and closed the dialog; the request then committed
 * with no visible result. The import route writes per-row db.patient.create
 * calls with no mid-flight rollback, so a client-side "cancel" after
 * dispatch can never be a real cancel (no AbortController — that would only
 * stop the client listening and leave the commit ambiguous, which the
 * directive explicitly forbids).
 *
 * The fix is a synchronous in-flight authority (importInFlightRef) that is
 * armed BEFORE the request can leave, checked by handleClose (so the dialog
 * cannot close mid-flight regardless of phase-commit lag), doubling as the
 * duplicate-dispatch guard, and lifted only in a finally on a terminal phase.
 * Fail-closed static coverage — the same pattern as
 * pd23-view-scroll-reset.test.ts: the contract is pinned to the source.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

describe('BUG-PD24 — CSV import in-flight Cancel race (the D import-Cancel P2)', () => {
  const dialog = readRepo('src/components/import-patients-dialog.tsx')

  it('declares the synchronous in-flight authority (useRef) beside the other refs', () => {
    expect(dialog).toMatch(
      /const importInFlightRef = useRef\(false\)/,
    )
  })

  it('handleImport arms the ref BEFORE the uploading phase is requested', () => {
    const armAt = dialog.indexOf('importInFlightRef.current = true')
    const phaseAt = dialog.indexOf("setPhase('uploading')")
    expect(armAt).toBeGreaterThan(-1)
    expect(phaseAt).toBeGreaterThan(-1)
    expect(armAt).toBeLessThan(phaseAt)
  })

  it('handleImport refuses a duplicate dispatch while one is already in flight', () => {
    const guard = 'if (importInFlightRef.current) return'
    const guardAt = dialog.indexOf(guard)
    const armAt = dialog.indexOf('importInFlightRef.current = true')
    expect(guardAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(armAt)
  })

  it('handleImport lifts the lock in a finally — only a terminal phase ends the in-flight hold', () => {
    expect(dialog).toMatch(
      /} finally \{\s*\/\/ BUG-D-IMPORT-CANCEL[\s\S]*?importInFlightRef\.current = false\s*\}/,
    )
  })

  it('handleClose refuses to close while the import POST is in flight (the render-lag-proof guard)', () => {
    const closeAt = dialog.indexOf('const handleClose')
    const closeBody = dialog.slice(closeAt, dialog.indexOf('}, [phase, resetState, onOpenChange])', closeAt))
    const refGuardAt = closeBody.indexOf('if (importInFlightRef.current) return')
    const openChangeAt = closeBody.indexOf('onOpenChange(false)')
    expect(refGuardAt).toBeGreaterThan(-1)
    expect(openChangeAt).toBeGreaterThan(refGuardAt)
  })

  it('the phase guard in handleClose is retained (belt-and-braces)', () => {
    expect(dialog).toMatch(
      /if \(phase === 'uploading' \|\| phase === 'processing'\) return/,
    )
  })

  it('NO AbortController — the import must never pretend to cancel a non-atomic server commit', () => {
    expect(dialog).not.toMatch(/abort/i)
  })

  it('the Importing state is shown while in flight (the user sees the import running)', () => {
    expect(dialog).toMatch(/Importing\.\.\./)
    expect(dialog).toMatch(/disabled=\{!file \|\| isUploading\}/)
  })

  it('the Cancel affordances stay disabled/hidden while uploading', () => {
    expect(dialog).toMatch(/disabled=\{isUploading\}/)
    expect(dialog).toMatch(/showCloseButton=\{!isUploading\}/)
  })

  it('the final result is still shown — the success panel, the error phase, and the refresh callback are intact', () => {
    expect(dialog).toMatch(/phase === 'complete' && result &&/)
    expect(dialog).toMatch(/setPhase\('error'\)/)
    expect(dialog).toMatch(/onImportComplete\(\)/)
  })
})
