/**
 * Authenticated Semantic Parser Tests (Item 7)
 *
 * These tests construct CORRECTLY AUTHENTICATED MVLT v3 headers
 * with invalid SEMANTIC values. The GCM auth tag will pass,
 * but the semantic validation should reject each case.
 *
 * This is different from parser-malformed.test.ts which corrupts bytes
 * and relies on the GCM tag failing.
 */
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  parseAndVerifyHeader,
  parseMasterKeyHex,
  generateObjectKeys,
  buildAndSerializeHeader,
  DEFAULT_KEY_ID,
  DEFAULT_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
} from '../src'

const MASTER_KEY_HEX = 'a'.repeat(64)
const masterKey = parseMasterKeyHex(MASTER_KEY_HEX)

/**
 * Build an authenticated header with custom semantic values.
 * Because we use buildAndSerializeHeader, the GCM auth tag will be VALID.
 */
function buildAuthenticatedHeader(overrides: {
  keyId?: string
  plaintextSize?: number
  mimeType?: string
  chunkSize?: number
  chunkCount?: number
}): Buffer {
  const objectKeys = generateObjectKeys()
  const rawSha256 = randomBytes(32)
  const sha256Hex = rawSha256.toString('hex')
  return buildAndSerializeHeader(
    {
      keyId: overrides.keyId ?? DEFAULT_KEY_ID,
      plaintextSize: overrides.plaintextSize ?? 1000,
      mimeType: overrides.mimeType ?? 'application/pdf',
      chunkSize: overrides.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkCount: overrides.chunkCount ?? 1,
      sha256: sha256Hex,
      rawSha256,
    },
    objectKeys,
    masterKey,
  )
}

describe('parser-semantic', () => {
  // 1. Zero chunk size — header is authenticated but semantically invalid
  it('rejects authenticated header with zero chunk size', () => {
    const buf = buildAuthenticatedHeader({ chunkSize: 0, chunkCount: 1 })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/chunk size is zero/)
  })

  // 2. Excessive chunk size — above MAX_CHUNK_SIZE (4 MiB)
  it('rejects authenticated header with excessive chunk size (8 MiB)', () => {
    const buf = buildAuthenticatedHeader({
      chunkSize: MAX_CHUNK_SIZE + 1,
      chunkCount: 1,
      plaintextSize: MAX_CHUNK_SIZE + 1,
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/chunk size.*outside allowed range/)
  })

  // 3. Chunk size below minimum (64 KiB)
  it('rejects authenticated header with chunk size below minimum', () => {
    const buf = buildAuthenticatedHeader({
      chunkSize: MIN_CHUNK_SIZE - 1,
      chunkCount: 1,
      plaintextSize: MIN_CHUNK_SIZE - 1,
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/chunk size.*outside allowed range/)
  })

  // 4. Inconsistent chunk count — too few chunks
  it('rejects authenticated header with inconsistent chunk count (too few)', () => {
    // 2 MiB with 1 MiB chunks = should be 2 chunks, but declare 1
    const plaintextSize = 2 * 1024 * 1024
    const buf = buildAuthenticatedHeader({
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 1, // Should be 2
      plaintextSize,
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/chunk count.*inconsistent/)
  })

  // 5. Inconsistent chunk count — too many chunks
  it('rejects authenticated header with inconsistent chunk count (too many)', () => {
    // 1 byte with 1 MiB chunks = should be 1 chunk, but declare 100
    const buf = buildAuthenticatedHeader({
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 100, // Should be 1
      plaintextSize: 1,
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/chunk count.*inconsistent/)
  })

  // 6. Excessive declared plaintext size (10 TiB + 1)
  it('rejects authenticated header with excessive plaintext size', () => {
    // Max is 10 TiB. Use 11 TiB.
    const elevenTiB = 11 * 1024 * 1024 * 1024 * 1024
    const chunks = Math.ceil(elevenTiB / DEFAULT_CHUNK_SIZE)
    const buf = buildAuthenticatedHeader({
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: chunks,
      plaintextSize: elevenTiB,
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/plaintext size.*exceeds maximum/)
  })

  // 7. Excessive MIME type length (501 characters)
  it('rejects authenticated header with excessive MIME type length', () => {
    const longMime = 'application/' + 'x'.repeat(500) // 512 chars total
    const buf = buildAuthenticatedHeader({ mimeType: longMime })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/MIME type length.*exceeds maximum/)
  })

  // 8. Excessive key ID length (101 characters)
  it('rejects authenticated header with excessive key ID length', () => {
    const longKeyId = 'x'.repeat(101)
    const buf = buildAuthenticatedHeader({ keyId: longKeyId })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/key ID length.*exceeds maximum/)
  })

  // 9. Zero-length file with chunkCount=0
  it('rejects authenticated header with zero plaintext and zero chunks', () => {
    const buf = buildAuthenticatedHeader({
      plaintextSize: 0,
      chunkCount: 0, // Should be 1 for empty files
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/zero-length file must have chunk count 1/)
  })

  // 10. Zero-length file with chunkCount=2
  it('rejects authenticated header with zero plaintext and 2 chunks', () => {
    const buf = buildAuthenticatedHeader({
      plaintextSize: 0,
      chunkCount: 2, // Should be 1 for empty files
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/zero-length file must have chunk count 1/)
  })

  // 11. Integer overflow: chunkSize * chunkCount exceeds MAX_SAFE_INTEGER
  it('rejects authenticated header with integer overflow in total size', () => {
    // chunkSize = 4194304 (MAX_CHUNK_SIZE, valid), chunkCount = 2147483648 (fits in uint32)
    // product = 4194304 * 2147483648 = 9007199254740992 > MAX_SAFE_INTEGER (9007199254740991)
    // The chunk count consistency check is skipped when overflow is detected,
    // so any plaintextSize value works.
    const buf = buildAuthenticatedHeader({
      chunkSize: 4194304,
      chunkCount: 2147483648,
      plaintextSize: 100, // Value doesn't matter — overflow check runs first
    })
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/exceeds safe integer range/)
  })

  // 12. Valid header should still parse correctly (positive control)
  it('accepts correctly constructed authenticated header', () => {
    const buf = buildAuthenticatedHeader({
      plaintextSize: 100,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 1,
    })
    const { header } = parseAndVerifyHeader(buf, masterKey)
    expect(header.plaintextSize).toBe(100)
    expect(header.chunkSize).toBe(DEFAULT_CHUNK_SIZE)
    expect(header.chunkCount).toBe(1)
  })

  // 13. Valid multi-chunk header (positive control)
  it('accepts correctly constructed multi-chunk authenticated header', () => {
    const size = 3 * 1024 * 1024 // 3 MiB, should be 3 chunks
    const buf = buildAuthenticatedHeader({
      plaintextSize: size,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 3,
    })
    const { header } = parseAndVerifyHeader(buf, masterKey)
    expect(header.plaintextSize).toBe(size)
    expect(header.chunkCount).toBe(3)
  })

  // 14. Valid zero-length file (positive control)
  it('accepts correctly constructed zero-length authenticated header', () => {
    const buf = buildAuthenticatedHeader({
      plaintextSize: 0,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 1,
    })
    const { header } = parseAndVerifyHeader(buf, masterKey)
    expect(header.plaintextSize).toBe(0)
    expect(header.chunkCount).toBe(1)
  })
})
