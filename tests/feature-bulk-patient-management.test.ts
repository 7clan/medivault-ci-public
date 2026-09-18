/**
 * Feature coverage — DIRECTIVE FEATURES A + B (bulk patient management).
 *
 * FEATURE A — "Reset All Data" is REMOVED completely (settings Danger Zone
 * stub): the old control was a no-op placeholder that promised
 * "Permanently delete all patients, documents, and settings" while leaving
 * the data fully intact (the SETTINGS_DANGERZONE_STUB P3). A destructive
 * global-delete affordance must not exist in the UI at all, and no
 * casually-reachable global-delete may exist in the API.
 *
 * FEATURE B — SAFE bulk patient management (Select Patients mode):
 * checkbox selection of the FILTERED/visible patients, select-all /
 * deselect-all, a selected-count display, a strong confirmation dialog
 * that shows the exact count AND the identifying names of every selected
 * patient, a bulk delete API with the same auth/CSRF as the single delete,
 * doctor-isolated, transactional, with per-patient results — partial
 * failures are reported exactly and full success is never claimed.
 *
 * Fail-closed static coverage — the same pattern as
 * pd23/pd24/pd26: the contract is pinned to the source.
 *
 * i18n era: every bulk-surface label resolves through the locale catalog
 * (patients.bulk.*). The ENGLISH catalog values are the rendered-UI OCR
 * needle contract for the QA harness — assertions pin BOTH the catalog
 * value AND the t() usage in the component.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function readTree(dir: string): string {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(readFileSync(full, 'utf8'))
    }
  }
  walk(join(repoRoot, dir))
  return out.join('\n')
}

describe('FEATURE A — "Reset All Data" is removed completely', () => {
  const settings = readRepo('src/components/settings-view.tsx')

  it('the Reset All Data control is GONE (title, description, buttons, state)', () => {
    expect(settings).not.toMatch(/Reset All Data/i)
    expect(settings).not.toMatch(/Confirm Reset/)
    expect(settings).not.toMatch(/dangerConfirm/)
    expect(settings).not.toMatch(/Danger Zone/)
    expect(settings).not.toMatch(/Feature Placeholder/)
  })

  it('no destructive global-delete control remains anywhere in the web frontend', () => {
    const frontend = readTree('src')
    expect(frontend).not.toMatch(/Reset All Data/i)
    expect(frontend).not.toMatch(/delete all patients/i)
    expect(frontend).not.toMatch(/danger-zone/)
    // i18n era: the catalogs must not carry dead destructive strings either
    // (the settings.danger.* keys were pruned when FEATURE A removed the UI)
    const enCatalog = readRepo('src/i18n/locales/en.json')
    const arCatalog = readRepo('src/i18n/locales/ar.json')
    expect(enCatalog).not.toMatch(/settings\.danger\./)
    expect(arCatalog).not.toMatch(/settings\.danger\./)
  })

  it('NO casually-reachable global-delete exists in the API (no patient.deleteMany, no reset endpoint)', () => {
    const api = readTree('mini-services/api-service/src')
    expect(api).not.toMatch(/patient\.deleteMany/)
    expect(api).not.toMatch(/deleteMany\(\{\s*where:\s*\{\s*doctorId/)
    // "reset" only survives in its legitimate, non-patient senses
    const resets = [...new Set((api.match(/reset\w*/gi) ?? []).map((r) => r.toLowerCase()))]
    const legit = new Set(['resetuserpassword', 'reset password', 'reset-password', 'resets', 'reset'])
    for (const r of resets) expect(legit.has(r)).toBe(true)
  })

  it('the legitimate backup/export options are RETAINED', () => {
    // i18n era: the strings live in the catalog; the English values are the
    // rendered-UI OCR needle contract (harness BUG-PD29 scroll-finds exactly
    // 'Download Complete Backup (ZIP)')
    const enCatalog = readRepo('src/i18n/locales/en.json')
    expect(enCatalog).toMatch(/"settings\.backup\.title":\s*"Backup & Export"/)
    expect(enCatalog).toMatch(/"settings\.backup\.download":\s*"Download Complete Backup \(ZIP\)"/)
    expect(settings).toMatch(/settings\.backup\.title/)
    expect(settings).toMatch(/settings\.backup\.download/)
    const dashboard = readRepo('src/components/dashboard.tsx')
    expect(dashboard).toMatch(/handleExportCsv/)
  })
})

describe('FEATURE B — Select Patients mode (frontend contract)', () => {
  const dashboard = readRepo('src/components/dashboard.tsx')
  const enCatalog = readRepo('src/i18n/locales/en.json')
  const arCatalog = readRepo('src/i18n/locales/ar.json')

  it('the patients.bulk.* catalog family is complete in BOTH locales (en/ar parity)', () => {
    const expected = [
      'patients.bulk.selectPatients',
      'patients.bulk.selectAll',
      'patients.bulk.deselectAll',
      'patients.bulk.selectedCount',
      'patients.bulk.cancel',
      'patients.bulk.deleteSelected',
      'patients.bulk.selectPatientAria',
      'patients.bulk.confirmTitleOne',
      'patients.bulk.confirmTitleOther',
      'patients.bulk.confirmWarningIntro',
      'patients.bulk.confirmCountOne',
      'patients.bulk.confirmCountOther',
      'patients.bulk.confirmWarning',
      'patients.bulk.confirmReview',
      'patients.bulk.dobLabel',
      'patients.bulk.noIdentifiers',
      'patients.bulk.confirmDeleteOne',
      'patients.bulk.confirmDeleteOther',
      'patients.bulk.failedTitle',
      'patients.bulk.failedDesc',
      'patients.bulk.networkFailedDesc',
      'patients.bulk.partialFailureTitle',
      'patients.bulk.partialFailureDesc',
      'patients.bulk.moreCount',
      'patients.bulk.unknownPatient',
      'patients.bulk.successTitle',
      'patients.bulk.successDescOne',
      'patients.bulk.successDescOther',
    ]
    const en = JSON.parse(enCatalog)
    const ar = JSON.parse(arCatalog)
    for (const key of expected) {
      expect(en[key], `missing en catalog key: ${key}`).toBeDefined()
      expect(ar[key], `missing ar catalog key: ${key}`).toBeDefined()
    }
  })

  it('has the "Select Patients" mode entry (and only enters bulk mode explicitly)', () => {
    // i18n era: the label lives in the catalog; the EN value is the OCR
    // needle the harness clicks (the rendered button says 'Select Patients').
    expect(enCatalog).toMatch(/"patients\.bulk\.selectPatients":\s*"Select Patients"/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.selectPatients'\)/)
    expect(dashboard).toMatch(/onClick=\{\(\) => setSelectMode\(true\)\}/)
  })

  it('checkboxes appear on patient rows in select mode, wired to the selection set', () => {
    expect(dashboard).toMatch(/\{selectMode && \(\s*<Checkbox/)
    expect(dashboard).toMatch(/checked=\{isSelected\}/)
    expect(dashboard).toMatch(/onCheckedChange=\{\(\) => togglePatientSelection\(patient\.id\)\}/)
    // Clicking a row in select mode toggles selection instead of opening the patient
    expect(dashboard).toMatch(/if \(selectMode\) \{\s*togglePatientSelection\(patient\.id\)/)
    // The checkbox aria-label localizes while the patient NAME (medical
    // data) passes through verbatim.
    expect(dashboard).toMatch(
      /t\('patients\.bulk\.selectPatientAria', \{ name: getPatientDisplayName\(patient\) \}\)/,
    )
  })

  it('select-all applies ONLY to the filtered/search-visible patients', () => {
    // the visible set is exactly the search-filtered results (or loaded list)
    expect(dashboard).toMatch(/const displayPatients = searchQuery\.trim\(\) \? searchResults : patients/)
    // select-all builds the selection from that visible set only
    expect(dashboard).toMatch(
      /setSelectedPatientIds\(allVisibleSelected \? new Set\(\) : new Set\(displayPatients\.map\(\(p\) => p\.id\)\)\)/,
    )
    expect(dashboard).toMatch(/allVisibleSelected = displayPatients\.length > 0/)
  })

  it('deselect-all and the selected-count display exist', () => {
    expect(enCatalog).toMatch(/"patients\.bulk\.selectAll":\s*"Select All"/)
    expect(enCatalog).toMatch(/"patients\.bulk\.deselectAll":\s*"Deselect All"/)
    expect(enCatalog).toMatch(/"patients\.bulk\.selectedCount":\s*"selected"/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.deselectAll'\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.selectAll'\)/)
    expect(dashboard).toMatch(
      /\{selectedPatientIds\.size\}<\/span>\{' '\}\{t\('patients\.bulk\.selectedCount'\)\}/,
    )
  })

  it('the selection resets when the visible set changes (no stale selections)', () => {
    expect(dashboard).toMatch(/useEffect\(\(\) => \{\s*setSelectedPatientIds\(new Set\(\)\)\s*\}, \[searchQuery\]\)/)
  })

  it('Delete Selected is gated behind an explicit selection and disabled while deleting', () => {
    expect(enCatalog).toMatch(/"patients\.bulk\.deleteSelected":\s*"Delete Selected"/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.deleteSelected'\)/)
    expect(dashboard).toMatch(/disabled=\{selectedPatientIds\.size === 0 \|\| bulkDeleting\}/)
  })

  it('the confirmation dialog shows the EXACT count, the identifying names, and a Cancel', () => {
    // i18n era: the count + names + warning resolve through the catalog;
    // the EN values pin the exact rendered English (singular AND plural —
    // the dialog must never misstate the count).
    expect(enCatalog).toMatch(/"patients\.bulk\.confirmTitleOne":\s*"Delete \{count\} Patient\?"/)
    expect(enCatalog).toMatch(/"patients\.bulk\.confirmTitleOther":\s*"Delete \{count\} Patients\?"/)
    expect(enCatalog).toMatch(
      /"patients\.bulk\.confirmWarning":\s*"along with ALL of their documents, visits, clinical notes, and prescriptions\. This action cannot be undone\."/,
    )
    expect(enCatalog).toMatch(
      /"patients\.bulk\.confirmReview":\s*"Please review the list below carefully before confirming:"/,
    )
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmTitleOne', \{ count: selectedPatients\.length \}\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmTitleOther', \{ count: selectedPatients\.length \}\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmWarning'\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmReview'\)/)
    expect(dashboard).toMatch(/getPatientDisplayName\(patient\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.dobLabel', \{ value: patient\.dateOfBirth \}\)/)
    expect(dashboard).toMatch(/onClick=\{\(\) => setBulkDeleteConfirm\(false\)\}/)
  })

  it('the confirm button requires an explicit confirm and is disabled while deleting', () => {
    // the button itself restates the exact count (singular + plural forms)
    expect(enCatalog).toMatch(/"patients\.bulk\.confirmDeleteOne":\s*"Delete \{count\} Patient"/)
    expect(enCatalog).toMatch(/"patients\.bulk\.confirmDeleteOther":\s*"Delete \{count\} Patients"/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmDeleteOne', \{ count: selectedPatients\.length \}\)/)
    expect(dashboard).toMatch(/t\('patients\.bulk\.confirmDeleteOther', \{ count: selectedPatients\.length \}\)/)
    expect(dashboard).toMatch(/onClick=\{handleBulkDeletePatients\}/)
    expect(dashboard).toMatch(/disabled=\{bulkDeleting \|\| selectedPatients\.length === 0\}/)
  })

  it('NEVER a one-click "Delete All Patients" — the delete dispatch always sends the explicit ID list', () => {
    expect(dashboard).not.toMatch(/Delete All/i)
    expect(dashboard).toMatch(
      /fetch\('\/api\/patients\/bulk', \{\s*method: 'DELETE',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*credentials: 'include',\s*body: JSON\.stringify\(\{ patientIds: \[\.\.\.selectedPatientIds\] \}\),/,
    )
  })

  it('partial failure is reported EXACTLY — never a full-success claim when failedCount > 0', () => {
    expect(enCatalog).toMatch(/"patients\.bulk\.partialFailureTitle":\s*"\{deleted\} deleted — \{failed\} failed"/)
    expect(enCatalog).toMatch(
      /"patients\.bulk\.partialFailureDesc":\s*"Could not delete: \{names\}\. They remain selected so you can retry\."/,
    )
    expect(enCatalog).toMatch(/"patients\.bulk\.moreCount":\s*"\(\+\{count\} more\)"/)
    expect(enCatalog).toMatch(/"patients\.bulk\.unknownPatient":\s*"Unknown patient"/)
    expect(dashboard).toMatch(/if \(result\.failedCount > 0\) \{/)
    expect(dashboard).toMatch(
      /t\('patients\.bulk\.partialFailureTitle', \{ deleted: result\.deletedCount, failed: result\.failedCount \}\)/,
    )
    expect(dashboard).toMatch(
      /t\('patients\.bulk\.partialFailureDesc', \{ names: `\$\{shown\}\$\{extra\}` \}\)/,
    )
    expect(dashboard).toMatch(/variant: 'destructive'/)
    // the failed patients stay selected for a retry
    expect(dashboard).toMatch(/setSelectedPatientIds\(new Set\(result\.failed\.map\(\(f\) => f\.id\)\)\)/)
  })

  it('the outcome toasts resolve through the catalog (total failure / success / network failure)', () => {
    expect(enCatalog).toMatch(/"patients\.bulk\.failedTitle":\s*"Bulk Delete Failed"/)
    expect(enCatalog).toMatch(
      /"patients\.bulk\.failedDesc":\s*"No patients were deleted\. Please try again\."/,
    )
    expect(enCatalog).toMatch(
      /"patients\.bulk\.networkFailedDesc":\s*"The request failed before a result was received\. The patient list has been refreshed from the server\."/,
    )
    expect(enCatalog).toMatch(/"patients\.bulk\.successTitle":\s*"Patients Deleted"/)
    expect(enCatalog).toMatch(
      /"patients\.bulk\.successDescOne":\s*"\{count\} patient and all their documents, visits, notes, and prescriptions have been removed\."/,
    )
    expect(enCatalog).toMatch(
      /"patients\.bulk\.successDescOther":\s*"\{count\} patients and all their documents, visits, notes, and prescriptions have been removed\."/,
    )
    for (const key of [
      'patients.bulk.failedTitle',
      'patients.bulk.failedDesc',
      'patients.bulk.networkFailedDesc',
      'patients.bulk.successTitle',
      'patients.bulk.successDescOne',
      'patients.bulk.successDescOther',
    ]) {
      expect(dashboard).toMatch(new RegExp(`t\\('${key.replace(/\./g, '\\.')}'(?:,|\\))`))
    }
  })

  it('the frontend re-verifies after deletion (list, counts, visits, and the active search all refresh)', () => {
    expect(dashboard).toMatch(/const refreshAfterBulkChange = useCallback\(async \(\) => \{/)
    expect(dashboard).toMatch(/loadRecentPatients\(\), loadStats\(\), loadUpcomingVisits\(\)/)
    expect(dashboard).toMatch(/search=\$\{encodeURIComponent\(q\)\}&limit=20/)
    expect(dashboard).toMatch(/await refreshAfterBulkChange\(\)/)
  })

  it('deleted patients are pruned from the recently-viewed strip', () => {
    expect(dashboard).toMatch(/removeFromRecentlyViewed\(result\.deleted\.map\(\(p\) => p\.id\)\)/)
    const store = readRepo('src/store/app-store.ts')
    expect(store).toMatch(/removeFromRecentlyViewed: \(ids\) => \{/)
    expect(store).toMatch(/saveRecentlyViewed\(updated\)/)
  })
})

describe('FEATURE B — bulk delete API (backend contract)', () => {
  const route = readRepo('mini-services/api-service/src/routes/patients/index.ts')

  it('the bulk route exists with the SAME auth + CSRF pre-handlers as the single delete', () => {
    expect(route).toMatch(
      /server\.delete\('\/api\/patients\/bulk', \{ preHandler: \[requireAuth, requirePermission\('patient:delete'\), csrfPreHandler\] \}/,
    )
  })

  it('the single-patient delete route is UNCHANGED and still present', () => {
    expect(route).toMatch(
      /server\.delete\('\/api\/patients\/:id', \{ preHandler: \[requireAuth, requirePermission\('patient:delete'\), csrfPreHandler\] \}/,
    )
    expect(route).toMatch(/\/\/ Cascade deletes documents/)
  })

  it('deletes inside ONE transaction', () => {
    expect(route).toMatch(/db\.\$transaction\(async \(tx\) => \{/)
  })

  it('ownership isolation: each patient is verified against the authenticated doctor inside the transaction', () => {
    expect(route).toMatch(/where: \{ id, doctorId: session\.user\.id \}/)
  })

  it('the request must be an explicit, validated, non-empty list of patient IDs (never "all")', () => {
    expect(route).toMatch(/patientIds must be a non-empty array of patient IDs/)
    expect(route).toMatch(/const MAX_BULK_DELETE = \d+/)
    expect(route).toMatch(/new Set\(/)
  })

  it('per-patient results: deleted (id + name) and failed (id + reason) are reported individually', () => {
    expect(route).toMatch(/failed\.push\(\{ id, error: 'Patient not found' \}\)/)
    expect(route).toMatch(/failed\.push\(\{ id, error: 'Delete failed' \}\)/)
    expect(route).toMatch(/deletedCount: txDeleted\.length/)
    expect(route).toMatch(/failedCount: failed\.length/)
    expect(route).toMatch(/success: failed\.length === 0/)
  })

  it('fail-closed verification — reported deletions are re-counted inside the transaction before commit', () => {
    expect(route).toMatch(/tx\.patient\.count\(/)
    expect(route).toMatch(/if \(remaining !== 0\) \{/)
    expect(route).toMatch(/throw new Error\('Bulk delete verification failed'\)/)
  })

  it('a transaction failure reports that NOTHING was applied (no false success)', () => {
    expect(route).toMatch(/Failed to delete patients — no changes were applied/)
  })

  it('the bulk delete is audit-logged (inside the transaction)', () => {
    expect(route).toMatch(/action: 'PATIENT_BULK_DELETE'/)
  })

  it('the route-permission registry documents the bulk route with patient:delete', () => {
    const registry = readRepo('src/lib/route-permissions.ts')
    expect(registry).toMatch(
      /\{ method: 'DELETE', path: '\/api\/patients\/bulk',\s+permission: 'patient:delete' \}/,
    )
  })
})
