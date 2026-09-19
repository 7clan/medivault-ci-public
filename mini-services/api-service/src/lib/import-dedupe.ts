/**
 * MediVault — CSV Import Duplicate Detection
 *
 * DATAIO_IMPORT_NO_DEDUPE fix: a safe, deterministic, CONSERVATIVE duplicate
 * contract for the CSV patient import. No fuzzy identity. No merging of
 * existing records. Skipping is always reported by the route.
 *
 * Identity contract:
 *  - The identity tuple is (firstName, lastName, dateOfBirth, phone, email,
 *    address, notes), each field TRIMMED, with '' standing in for missing.
 *  - Names compare CASE-INSENSITIVELY (lowercased); every other field
 *    compares EXACTLY (byte-for-byte after trim).
 *  - Present-on-one-side / missing-on-the-other is NOT a match: a row with an
 *    empty phone never matches a stored record with a phone set (and vice
 *    versa), so disambiguation by a single differing field always works.
 *
 * Pure, unit-testable, no imports of the route or any framework.
 */

/** Identity fields as they arrive from a parsed CSV row ('' when missing). */
export interface PatientIdentityRow {
  firstName: string
  lastName: string
  dateOfBirth?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

/**
 * Identity fields as they arrive from a stored patient record (null when
 * missing) — the same shape, so one tuple builder serves both sides.
 */
export type ExistingPatientIdentity = PatientIdentityRow

/** Display name of a matched existing patient (for the skip report). */
export interface ExistingPatientMatch {
  firstName: string
  lastName: string
}

/** Normalize one field: trim; '' for null/undefined/blank. */
function normalizeField(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? '' : trimmed
}

/**
 * Build the comparable identity tuple for a row (CSV or stored record).
 * Field order is frozen: [firstName, lastName, dateOfBirth, phone, email,
 * address, notes]. Names are lowercased; all other fields are kept verbatim
 * after trimming, and missing values become ''.
 */
export function buildIdentityTuple(row: PatientIdentityRow): string[] {
  return [
    normalizeField(row.firstName).toLowerCase(),
    normalizeField(row.lastName).toLowerCase(),
    normalizeField(row.dateOfBirth),
    normalizeField(row.phone),
    normalizeField(row.email),
    normalizeField(row.address),
    normalizeField(row.notes),
  ]
}

/** Stable comparable key for an identity tuple (order frozen above). */
export function identityKey(tuple: readonly string[]): string {
  return JSON.stringify(tuple)
}

/**
 * Exact-identity comparison: case-insensitive names, exact everything else.
 * Any single differing field (or a field present on one side only) makes the
 * two rows NOT duplicates.
 */
export function isExactDuplicate(a: PatientIdentityRow, b: PatientIdentityRow): boolean {
  return identityKey(buildIdentityTuple(a)) === identityKey(buildIdentityTuple(b))
}

/**
 * In-memory matcher over the importing doctor's existing patients (loaded
 * ONCE per import by the route). The database here is SQLite via Prisma,
 * which has no case-insensitive query mode — names are case-folded in JS
 * instead. The map is keyed by the exact identity key, so a lookup can only
 * ever return a patient whose ENTIRE identity tuple matches exactly.
 */
export class ExistingPatientMatcher {
  private readonly matchesByKey = new Map<string, ExistingPatientMatch>()

  constructor(existing: readonly ExistingPatientIdentity[]) {
    for (const patient of existing) {
      const key = identityKey(buildIdentityTuple(patient))
      if (!this.matchesByKey.has(key)) {
        this.matchesByKey.set(key, {
          firstName: normalizeField(patient.firstName),
          lastName: normalizeField(patient.lastName),
        })
      }
    }
  }

  /**
   * Returns the matched existing patient's display name (for the skip
   * report), or null when no existing patient shares the exact identity.
   */
  findExistingMatch(row: PatientIdentityRow): ExistingPatientMatch | null {
    return this.matchesByKey.get(identityKey(buildIdentityTuple(row))) ?? null
  }
}
