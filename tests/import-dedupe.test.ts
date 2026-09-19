/**
 * DATAIO_IMPORT_NO_DEDUPE — pure unit coverage for the CSV import duplicate
 * contract (mini-services/api-service/src/lib/import-dedupe.ts).
 *
 * The contract is CONSERVATIVE by design: a duplicate requires the ENTIRE
 * identity tuple to match exactly after trim — case-insensitive names,
 * byte-exact everything else, and present-on-one-side/missing-on-the-other
 * is NOT a match. No fuzzy identity, no merging; skipping is always reported
 * by the route (covered by tests/csv-import-duplicate.test.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  ExistingPatientMatcher,
  buildIdentityTuple,
  identityKey,
  isExactDuplicate,
} from '../mini-services/api-service/src/lib/import-dedupe.js'

const baseRow = {
  firstName: 'John',
  lastName: 'Smith',
  dateOfBirth: '1990-01-01',
  phone: '555-0100',
  email: 'John@Example.com',
  address: '1 Main St',
  notes: 'penicillin allergy',
}

describe('buildIdentityTuple', () => {
  it('builds the 7-field tuple in the frozen order: names, dob, phone, email, address, notes', () => {
    expect(buildIdentityTuple(baseRow)).toEqual([
      'john',
      'smith',
      '1990-01-01',
      '555-0100',
      'John@Example.com',
      '1 Main St',
      'penicillin allergy',
    ])
  })

  it('lowercases names but leaves every other field byte-exact (email case preserved)', () => {
    const tuple = buildIdentityTuple(baseRow)
    expect(tuple[0]).toBe('john')
    expect(tuple[1]).toBe('smith')
    expect(tuple[4]).toBe('John@Example.com')
  })

  it('trims surrounding whitespace on every field', () => {
    expect(
      buildIdentityTuple({
        firstName: '  John  ',
        lastName: ' Smith ',
        dateOfBirth: ' 1990-01-01 ',
        phone: ' 555-0100 ',
        email: ' John@Example.com ',
        address: ' 1 Main St ',
        notes: ' penicillin allergy ',
      }),
    ).toEqual([
      'john',
      'smith',
      '1990-01-01',
      '555-0100',
      'John@Example.com',
      '1 Main St',
      'penicillin allergy',
    ])
  })

  it('uses "" for missing values — null, undefined, and blank all normalize the same', () => {
    const viaNull = buildIdentityTuple({
      firstName: 'John',
      lastName: 'Smith',
      dateOfBirth: null,
      phone: null,
      email: null,
      address: null,
      notes: null,
    })
    const viaUndefined = buildIdentityTuple({ firstName: 'John', lastName: 'Smith' })
    const viaBlank = buildIdentityTuple({
      firstName: 'John',
      lastName: 'Smith',
      dateOfBirth: '   ',
      phone: '',
      email: '',
      address: ' ',
      notes: '',
    })
    expect(viaNull).toEqual(['john', 'smith', '', '', '', '', ''])
    expect(viaUndefined).toEqual(viaNull)
    expect(viaBlank).toEqual(viaNull)
  })
})

describe('identityKey', () => {
  it('produces the same key for case-different names, different keys for any differing field', () => {
    const a = buildIdentityTuple(baseRow)
    const b = buildIdentityTuple({ ...baseRow, firstName: 'JOHN', lastName: 'SMITH' })
    expect(identityKey(a)).toBe(identityKey(b))

    const differentDob = buildIdentityTuple({ ...baseRow, dateOfBirth: '1991-01-01' })
    expect(identityKey(a)).not.toBe(identityKey(differentDob))
  })
})

describe('isExactDuplicate', () => {
  it('case-insensitive names with every other field identical => duplicate', () => {
    expect(
      isExactDuplicate(baseRow, {
        ...baseRow,
        firstName: 'JOHN',
        lastName: 'smiTH',
      }),
    ).toBe(true)
  })

  it('a differing DOB disambiguates — NOT a duplicate', () => {
    expect(isExactDuplicate(baseRow, { ...baseRow, dateOfBirth: '1991-02-02' })).toBe(false)
  })

  it('a differing phone disambiguates — NOT a duplicate', () => {
    expect(isExactDuplicate(baseRow, { ...baseRow, phone: '555-0199' })).toBe(false)
  })

  it('a differing email disambiguates — and email compares case-SENSITIVELY', () => {
    expect(isExactDuplicate(baseRow, { ...baseRow, email: 'other@example.com' })).toBe(false)
    // Names fold case; other fields do not — a case-only email difference is a
    // different identity, conservatively never merged away.
    expect(isExactDuplicate(baseRow, { ...baseRow, email: 'john@example.com' })).toBe(false)
  })

  it('a differing address or notes disambiguates — NOT a duplicate', () => {
    expect(isExactDuplicate(baseRow, { ...baseRow, address: '2 Oak St' })).toBe(false)
    expect(isExactDuplicate(baseRow, { ...baseRow, notes: '' })).toBe(false)
  })

  it('field presence mismatch is NOT a match — phone present vs absent, both directions', () => {
    const withoutPhone = { ...baseRow, phone: '' }
    expect(isExactDuplicate(baseRow, withoutPhone)).toBe(false)
    expect(isExactDuplicate(withoutPhone, baseRow)).toBe(false)
  })

  it('field presence mismatch is NOT a match — DOB present vs absent, both directions', () => {
    const withoutDob = { ...baseRow, dateOfBirth: '' }
    expect(isExactDuplicate(baseRow, withoutDob)).toBe(false)
    expect(isExactDuplicate(withoutDob, baseRow)).toBe(false)
  })

  it('fully identical rows (stored-record nulls vs CSV "" missing) => duplicate', () => {
    expect(
      isExactDuplicate(
        { ...baseRow, email: 'john@example.com' },
        {
          firstName: 'John',
          lastName: 'Smith',
          dateOfBirth: '1990-01-01',
          phone: '555-0100',
          email: 'john@example.com',
          address: '1 Main St',
          notes: 'penicillin allergy',
        },
      ),
    ).toBe(true)
    // The stored-record side: null for missing, and names case-folded too.
    expect(
      isExactDuplicate(
        { ...baseRow, email: 'john@example.com', notes: null },
        {
          firstName: 'john',
          lastName: 'Smith',
          dateOfBirth: '1990-01-01',
          phone: '555-0100',
          email: 'john@example.com',
          address: '1 Main St',
          notes: null,
        },
      ),
    ).toBe(true)
  })
})

describe('ExistingPatientMatcher', () => {
  const storedJohn = {
    firstName: 'John',
    lastName: 'Smith',
    dateOfBirth: '1990-01-01',
    phone: '555-0100',
    email: 'john@example.com',
    address: '1 Main St',
    notes: null,
  }

  it('matches a CSV row ("" missing) against a stored record (null missing) with case-folded names', () => {
    const matcher = new ExistingPatientMatcher([storedJohn])
    const match = matcher.findExistingMatch({
      firstName: 'JOHN',
      lastName: 'smith',
      dateOfBirth: '1990-01-01',
      phone: '555-0100',
      email: 'john@example.com',
      address: '1 Main St',
      notes: '',
    })
    expect(match).toEqual({ firstName: 'John', lastName: 'Smith' })
  })

  it('returns the STORED display name (for the skip report), not the row spelling', () => {
    const matcher = new ExistingPatientMatcher([{ ...storedJohn, firstName: 'Jonathan', lastName: 'Smith-Jones' }])
    const match = matcher.findExistingMatch({
      firstName: 'JONATHAN',
      lastName: 'SMITH-JONES',
      dateOfBirth: '1990-01-01',
      phone: '555-0100',
      email: 'john@example.com',
      address: '1 Main St',
      notes: '',
    })
    expect(match).toEqual({ firstName: 'Jonathan', lastName: 'Smith-Jones' })
  })

  it('phone set on the record but empty in the row => NO match (created, not skipped)', () => {
    const matcher = new ExistingPatientMatcher([{ ...storedJohn, phone: '+1-555-0300' }])
    expect(
      matcher.findExistingMatch({ ...storedJohn, phone: '' }),
    ).toBeNull()
  })

  it('phone empty on the record but set in the row => NO match (both directions checked)', () => {
    const matcher = new ExistingPatientMatcher([{ ...storedJohn, phone: null }])
    expect(
      matcher.findExistingMatch({ ...storedJohn, phone: '555-0100' }),
    ).toBeNull()
  })

  it('same name, different DOB => NO match', () => {
    const matcher = new ExistingPatientMatcher([storedJohn])
    expect(
      matcher.findExistingMatch({ ...storedJohn, dateOfBirth: '1991-02-02' }),
    ).toBeNull()
  })

  it('same name and DOB but different email => NO match', () => {
    const matcher = new ExistingPatientMatcher([storedJohn])
    expect(
      matcher.findExistingMatch({ ...storedJohn, email: 'js@example.com' }),
    ).toBeNull()
  })

  it('first stored record wins when the existing set itself contains identical identities', () => {
    const matcher = new ExistingPatientMatcher([
      { ...storedJohn, firstName: 'John', lastName: 'Smith' },
      { ...storedJohn, firstName: 'JOHN', lastName: 'SMITH' },
    ])
    expect(matcher.findExistingMatch(storedJohn)).toEqual({ firstName: 'John', lastName: 'Smith' })
  })

  it('empty existing set matches nothing', () => {
    const matcher = new ExistingPatientMatcher([])
    expect(matcher.findExistingMatch(storedJohn)).toBeNull()
  })
})
