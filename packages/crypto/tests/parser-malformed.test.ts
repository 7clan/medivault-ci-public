import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  parseAndVerifyHeader,
  parseMasterKeyHex,
  generateObjectKeys,
  buildAndSerializeHeader,
  FORMAT_VERSION,
  ALGORITHM_ID_AES256GCM,
  HEADER_TAG_SIZE,
  OBJECT_SALT_SIZE,
  NONCE_PREFIX_SIZE,
  HEADER_NONCE_SIZE,
  RAW_SHA256_SIZE,
  DEFAULT_KEY_ID,
  DEFAULT_CHUNK_SIZE,
  MAGIC,
} from '../src'

const MASTER_KEY_HEX = 'a'.repeat(64)
const masterKey = parseMasterKeyHex(MASTER_KEY_HEX)

/**
 * Build a valid MVLT v3 header buffer using the default key ID and a short MIME type.
 * Byte layout with K=6 ("key-v1") and M=15 ("application/pdf"):
 *   [0-3]    Magic (4B)
 *   [4-5]    Version (2B)
 *   [6]      Algorithm (1B)
 *   [7-10]   Header length (4B)
 *   [11]     Key ID length = 6 (1B)
 *   [12-17]  Key ID "key-v1" (6B)
 *   [18-49]  Object salt (32B)
 *   [50-61]  Header nonce (12B)
 *   [62-69]  Nonce prefix (8B)
 *   [70-77]  Plaintext size (8B)
 *   [78-79]  MIME length = 15 (2B)
 *   [80-94]  MIME type (15B)
 *   [95-98]  Chunk size (4B)
 *   [99-102] Chunk count (4B)
 *   [103-134] Raw SHA-256 (32B)
 *   [135-150] Header auth tag (16B)
 *   Total: 151 bytes
 */
function buildValidHeader(): Buffer {
  const objectKeys = generateObjectKeys()
  const rawSha256 = randomBytes(32)
  const sha256Hex = rawSha256.toString('hex')
  return buildAndSerializeHeader(
    {
      keyId: DEFAULT_KEY_ID,
      plaintextSize: 1000,
      mimeType: 'application/pdf',
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkCount: 1,
      sha256: sha256Hex,
      rawSha256,
    },
    objectKeys,
    masterKey,
  )
}

// Offsets for K=6, M=15
const K = Buffer.byteLength(DEFAULT_KEY_ID, 'utf-8') // 6
const M = Buffer.byteLength('application/pdf', 'utf-8') // 15
const OFF_MAGIC = 0
const OFF_VERSION = 4
const OFF_ALGORITHM = 6
const OFF_HEADER_LEN = 7
const OFF_KEY_ID_LEN = 11
const OFF_OBJECT_SALT = 12 + K // 18
const OFF_HEADER_NONCE = OFF_OBJECT_SALT + OBJECT_SALT_SIZE // 50
const OFF_NONCE_PREFIX = OFF_HEADER_NONCE + HEADER_NONCE_SIZE // 62
const OFF_PLAINTEXT_SIZE = OFF_NONCE_PREFIX + NONCE_PREFIX_SIZE // 70
const OFF_MIME_LEN = OFF_PLAINTEXT_SIZE + 8 // 78
const OFF_MIME_TYPE = OFF_MIME_LEN + 2 // 80
const OFF_CHUNK_SIZE = OFF_MIME_TYPE + M // 95
const OFF_CHUNK_COUNT = OFF_CHUNK_SIZE + 4 // 99
const OFF_RAW_SHA256 = OFF_CHUNK_COUNT + 4 // 103
const TOTAL_HEADER_LEN = 130 + K + M // 151

describe('parser-malformed', () => {
  // 1. Wrong magic
  it('rejects wrong magic bytes', () => {
    const buf = Buffer.from(buildValidHeader())
    buf[OFF_MAGIC] = 0x58 // 'X'
    buf[OFF_MAGIC + 1] = 0x58
    buf[OFF_MAGIC + 2] = 0x58
    buf[OFF_MAGIC + 3] = 0x58
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Invalid file magic/)
  })

  // 2. Unsupported version (version 2)
  it('rejects unsupported format version 2', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt16BE(2, OFF_VERSION)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Unsupported format version/)
  })

  // 2b. Unsupported version (version 99)
  it('rejects unsupported format version 99', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt16BE(99, OFF_VERSION)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Unsupported format version/)
  })

  // 3. Unsupported algorithm
  it('rejects unsupported algorithm ID 0x02', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt8(0x02, OFF_ALGORITHM)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Unsupported algorithm ID/)
  })

  // 4. Invalid header length (too small: 50 < 130)
  // The buffer is still 151 bytes so it passes the length check,
  // but the auth tag is extracted from the wrong offset and verification fails.
  it('rejects header length too small (50)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt32BE(50, OFF_HEADER_LEN)
    // headerLength=50 < 130 is NOT checked by parseAndVerifyHeader;
    // but the tag is extracted from wrong bytes, so auth fails.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 5. Invalid header length (excessive: 50000)
  it('rejects header length exceeding buffer (50000)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt32BE(50000, OFF_HEADER_LEN)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Buffer too small for complete MVLT v3 header/)
  })

  // 6. Invalid key ID length (200 but buffer is only 151 bytes)
  // Reading 200 bytes of keyId from offset 12 causes subsequent fixed-field
  // reads (objectSalt, etc.) to land beyond buffer bounds → RangeError or auth failure.
  it('rejects key ID length exceeding buffer bounds', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt8(200, OFF_KEY_ID_LEN)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 7. Invalid MIME length (50000, far exceeds buffer)
  // Similar to test 6: subsequent reads overflow buffer.
  it('rejects MIME length exceeding buffer bounds', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt16BE(50000, OFF_MIME_LEN)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 8. Zero chunk size
  // parseAndVerifyHeader reads but doesn't validate chunkSize bounds.
  // The corruption is in the pre-tag region, so auth tag verification fails.
  it('rejects zero chunk size (auth tag mismatch from corruption)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt32BE(0, OFF_CHUNK_SIZE)
    // Note: parseAndVerifyHeader does not validate chunkSize bounds directly.
    // This throws because the corrupted pre-tag bytes invalidate the auth tag.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 9. Excessive chunk size (0xFFFFFFFF = 4GiB, exceeds MAX_CHUNK_SIZE 4MiB)
  // Same as test 8: corruption in pre-tag region causes auth failure.
  it('rejects excessive chunk size (auth tag mismatch from corruption)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt32BE(0xFFFFFFFF, OFF_CHUNK_SIZE)
    // Note: parseAndVerifyHeader does not validate chunkSize <= MAX_CHUNK_SIZE.
    // This throws because the corrupted pre-tag bytes invalidate the auth tag.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 10. Incorrect chunk count
  // chunkCount=1000 but plaintext=100 bytes with chunkSize=1MB → should be 1.
  // Corruption in pre-tag region causes auth failure.
  it('rejects incorrect chunk count (auth tag mismatch from corruption)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeUInt32BE(1000, OFF_CHUNK_COUNT)
    // Note: parseAndVerifyHeader does not validate chunkCount consistency.
    // This throws because the corrupted pre-tag bytes invalidate the auth tag.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 11. Truncated header (only 50 bytes)
  it('rejects truncated header (50 bytes)', () => {
    const valid = buildValidHeader()
    const buf = valid.subarray(0, 50)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Buffer too small for MVLT v3 header/)
  })

  // 12. Truncated header (missing auth tag — last 16 bytes removed)
  // headerLength field still says 151, but buffer is only 135 bytes.
  it('rejects truncated header missing auth tag', () => {
    const valid = buildValidHeader()
    const buf = valid.subarray(0, TOTAL_HEADER_LEN - HEADER_TAG_SIZE) // 135 bytes
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Buffer too small for complete MVLT v3 header/)
  })

  // 13. Excessive declared plaintext size
  // Corruption in pre-tag region causes auth failure.
  it('rejects excessive plaintext size (Number.MAX_SAFE_INTEGER)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER), OFF_PLAINTEXT_SIZE)
    // Note: parseAndVerifyHeader does not validate plaintextSize bounds.
    // This throws because the corrupted pre-tag bytes invalidate the auth tag.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 14. Integer boundary: plaintextSize = 0 with chunkCount = 0
  // For an empty file, chunkCount should still be at least 1 (one empty chunk).
  // Corruption in pre-tag region causes auth failure.
  it('rejects plaintextSize=0 with chunkCount=0 (auth tag mismatch from corruption)', () => {
    const buf = Buffer.from(buildValidHeader())
    buf.writeBigUInt64BE(0n, OFF_PLAINTEXT_SIZE)
    buf.writeUInt32BE(0, OFF_CHUNK_COUNT)
    // Note: parseAndVerifyHeader does not validate chunkCount > 0 for empty files.
    // This throws because the corrupted pre-tag bytes invalidate the auth tag.
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow()
  })

  // 15. Buffer too small for MVLT v3 header (129 bytes, minimum is 130)
  it('rejects buffer of 129 bytes (below 130 minimum)', () => {
    const valid = buildValidHeader()
    const buf = valid.subarray(0, 129)
    expect(() => parseAndVerifyHeader(buf, masterKey)).toThrow(/Buffer too small for MVLT v3 header: got 129 bytes, need at least 130/)
  })
})
