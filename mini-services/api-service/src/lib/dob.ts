/**
 * MediVault Fastify — Date-of-Birth Validation (DATAIO_IMPORT_BAD_DOB)
 *
 * Shared, pure, unit-testable validator used by the CSV import route so an
 * invalid or impossible date of birth can never silently become an accepted
 * patient record (the P3 defect: any string — "1990-13-45", "05-06-1990",
 * "not-a-date" — was stored verbatim).
 *
 * Rules (the shipped contract):
 *   1. STRICT `YYYY-MM-DD` — exactly 4-2-2 digits, no other format accepted.
 *   2. REAL calendar date — month 1-12, day 1-daysInMonth(year, month) with
 *      the correct Gregorian leap-year rule (divisible by 4, except centuries
 *      unless divisible by 400: 1920-02-29 and 2000-02-29 are valid,
 *      1900-02-29 and 2023-02-29 are NOT).
 *   3. Year >= 1900 — older "shake-and-bake" values are rejected.
 *   4. Not in the future — the date must be <= today (UTC).
 *
 * Legitimate historical DOBs are PRESERVED: any real calendar date from
 * 1900-01-01 through today (UTC) validates, so 1920-02-29 imports verbatim.
 *
 * NOTE on empty values: the CSV import route treats an EMPTY DOB cell as
 * `null` (DOB is optional) BEFORE calling this validator. The validator
 * itself still rejects an empty/whitespace-only string — callers that do not
 * want that behavior must handle emptiness first, exactly like the route.
 */

// ─── Types ─────────────────────────────────────────────

/** A valid DOB — `normalized` is the trimmed canonical input. */
export interface DobValid {
  ok: true
  normalized: string
}

/** An invalid DOB — `reason` explains exactly which rule failed. */
export interface DobInvalid {
  ok: false
  reason: string
}

/** Discriminated result of {@link validateDateOfBirth}. */
export type DobValidation = DobValid | DobInvalid

// ─── Calendar helpers ──────────────────────────────────

/**
 * Gregorian leap-year rule: divisible by 4, EXCEPT century years unless
 * divisible by 400 (1900 is NOT a leap year; 2000 IS).
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days in a Gregorian month; 0 for an out-of-range month (1-12). */
export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12:
      return 31
    case 4: case 6: case 9: case 11:
      return 30
    case 2:
      return isLeapYear(year) ? 29 : 28
    default:
      return 0
  }
}

// ─── Validator ─────────────────────────────────────────

/** Strict `YYYY-MM-DD` — exactly 4-2-2 digits separated by dashes. */
const DOB_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Today's UTC date as a `YYYY-MM-DD` string (ISO strings are UTC). */
function todayUtcIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Validate a raw date-of-birth string.
 *
 * @param raw - the candidate DOB (typically a CSV cell)
 * @returns `{ ok: true, normalized }` for a real calendar date between
 *          1900-01-01 and today (UTC) in strict YYYY-MM-DD form; otherwise
 *          `{ ok: false, reason }` with a human-readable explanation.
 */
export function validateDateOfBirth(raw: string): DobValidation {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) {
    return { ok: false, reason: 'Date of birth is empty (the caller treats an empty CSV cell as null before validating)' }
  }

  const match = DOB_PATTERN.exec(trimmed)
  if (!match) {
    return { ok: false, reason: `Invalid date of birth "${trimmed}" — expected a real calendar date in YYYY-MM-DD format, year 1900 or later, not in the future` }
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12) {
    return { ok: false, reason: `Invalid date of birth "${trimmed}" — month ${month} does not exist (expected 01-12)` }
  }

  const maxDay = daysInMonth(year, month)
  if (day < 1 || day > maxDay) {
    return { ok: false, reason: `Invalid date of birth "${trimmed}" — day ${day} does not exist in ${year}-${String(month).padStart(2, '0')} (that month has ${maxDay} days)` }
  }

  if (year < 1900) {
    return { ok: false, reason: `Invalid date of birth "${trimmed}" — year ${year} is before the supported minimum of 1900` }
  }

  if (trimmed > todayUtcIsoDate()) {
    return { ok: false, reason: `Invalid date of birth "${trimmed}" — a date of birth cannot be in the future` }
  }

  return { ok: true, normalized: trimmed }
}
