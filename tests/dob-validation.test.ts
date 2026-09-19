/**
 * DATAIO_IMPORT_BAD_DOB — pure unit coverage for the shared DOB validator
 * (mini-services/api-service/src/lib/dob.ts).
 *
 * The defect: the CSV import route stored ANY non-empty DOB cell verbatim,
 * so impossible dates ("1990-13-45", "2023-02-29", "05-06-1990") silently
 * became accepted patient records. The fix contract:
 *
 *   1. STRICT YYYY-MM-DD (exactly 4-2-2 digits — no loose formats).
 *   2. REAL calendar date (month 1-12, day 1-daysInMonth with the correct
 *      Gregorian leap rule: /4, except centuries unless /400).
 *   3. Year >= 1900.
 *   4. Not in the future (<= today, UTC).
 *
 * Legitimate historical values MUST be preserved: 1920-02-29 is valid and
 * must import; 1900-02-29 is NOT valid (1900 is not a leap year).
 */
import { describe, expect, it } from 'vitest'
import { validateDateOfBirth, isLeapYear, daysInMonth } from '../mini-services/api-service/src/lib/dob.js'

// ─── Dynamic dates (computed, never hardcoded — the suite stays green any day it runs) ──

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayUtc(): string {
  return isoDateUtc(new Date())
}

function tomorrowUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return isoDateUtc(d)
}

function isLeapYearUtc(year: number): boolean {
  // A leap year always contains Feb 29; a common year rolls over to Mar 1.
  const feb29 = new Date(Date.UTC(year, 1, 29))
  return feb29.getUTCMonth() === 1
}

// ─── Tests ─────────────────────────────────────────────

describe('DATAIO_IMPORT_BAD_DOB — validateDateOfBirth (pure validator)', () => {
  describe('valid dates (legitimate historical values are preserved)', () => {
    it.each([
      ['1920-02-29'],   // historical leap-year Feb 29 — MUST import
      ['1900-01-01'],   // the exact minimum supported date
      ['2000-02-29'],   // leap CENTURY (divisible by 400)
      ['2024-12-31'],   // plain valid date
      ['1985-03-25'],   // the documented example DOB
    ])('%s validates and normalizes to the trimmed canonical form', (raw) => {
      const result = validateDateOfBirth(raw)
      expect(result).toEqual({ ok: true, normalized: raw })
    })

    it("today's UTC date is valid (a DOB equal to today is not in the future)", () => {
      const result = validateDateOfBirth(todayUtc())
      expect(result.ok).toBe(true)
    })

    it('trims surrounding whitespace and returns the canonical trimmed value', () => {
      const result = validateDateOfBirth('  1920-02-29  ')
      expect(result).toEqual({ ok: true, normalized: '1920-02-29' })
    })
  })

  describe('impossible calendar dates (real-calendar rule)', () => {
    it('rejects 1900-02-29 — 1900 is a century NOT divisible by 400 (not a leap year)', () => {
      const result = validateDateOfBirth('1900-02-29')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/1900-02-29/)
    })

    it('rejects 2023-02-29 — 2023 is a common year (February has 28 days)', () => {
      const result = validateDateOfBirth('2023-02-29')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/2023-02-29/)
    })

    it.each([
      ['1990-13-01'],   // month 13
      ['1990-00-10'],   // month 0
      ['1990-04-31'],   // April has 30 days
      ['1990-13-45'],   // the documented impossible import cell
      ['2023-02-30'],   // February, common year, day 30
    ])('rejects %s', (raw) => {
      const result = validateDateOfBirth(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
    })

    it('every invalid result carries a clear human-readable reason', () => {
      for (const raw of ['1900-02-29', '1990-13-01', '1990-04-31']) {
        const result = validateDateOfBirth(raw)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(new RegExp(raw))
      }
    })
  })

  describe('strict format rule (4-2-2 digits, nothing else)', () => {
    it.each([
      ['1990-1-5'],      // loose single-digit month/day
      ['1990/01/05'],    // slash separators
      ['05-06-1990'],    // DD-MM-YYYY
      ['not-a-date'],    // free text
      ['1990-01'],       // missing day
      ['1990-01-05x'],   // trailing junk
      ['  '],            // whitespace-only
    ])('rejects %s', (raw) => {
      const result = validateDateOfBirth(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
    })
  })

  describe('empty input (documented caller contract)', () => {
    it('rejects the empty string — the import route treats an empty cell as null BEFORE calling this validator', () => {
      const result = validateDateOfBirth('')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/empty/i)
    })
  })

  describe('range rules (year >= 1900, not in the future)', () => {
    it('rejects year 1899 (before the supported minimum)', () => {
      const result = validateDateOfBirth('1899-12-31')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/1900/)
    })

    it("rejects tomorrow's date (a DOB cannot be in the future)", () => {
      const result = validateDateOfBirth(tomorrowUtc())
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/future/i)
    })

    it('rejects a far-future date such as 2100-01-01 (beyond today)', () => {
      const result = validateDateOfBirth('2100-01-01')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/future/)
    })
  })

  describe('calendar helpers (the leap-year rule, pinned independently)', () => {
    it('isLeapYear: /4 except centuries unless /400', () => {
      for (const year of [1904, 1920, 2004, 2024, 2400]) {
        expect(isLeapYear(year)).toBe(true)
        expect(isLeapYearUtc(year)).toBe(true) // cross-checked against Date
      }
      for (const year of [1900, 2001, 2023, 2100]) {
        expect(isLeapYear(year)).toBe(false)
        expect(isLeapYearUtc(year)).toBe(false)
      }
      expect(isLeapYear(2000)).toBe(true) // the leap-century exception
    })

    it('daysInMonth: February follows the leap rule; out-of-range months yield 0', () => {
      expect(daysInMonth(1920, 2)).toBe(29)
      expect(daysInMonth(1900, 2)).toBe(28)
      expect(daysInMonth(2000, 2)).toBe(29)
      expect(daysInMonth(2023, 2)).toBe(28)
      expect(daysInMonth(1990, 4)).toBe(30)
      expect(daysInMonth(1990, 12)).toBe(31)
      expect(daysInMonth(1990, 0)).toBe(0)
      expect(daysInMonth(1990, 13)).toBe(0)
    })
  })
})
