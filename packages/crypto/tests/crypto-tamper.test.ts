import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, NONCE_SIZE, TAG_SIZE, HEADER_TAG_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)
const WRONG_KEY = 'b'.repeat(64)

describe('crypto-tamper', () => {
  function makeEncrypted(size: number = 50_000): Buffer {
    const data = randomBytes(size)
    return encrypt(data, MASTER_KEY, 'application/pdf').encryptedData
  }

  it('rejects flipped ciphertext byte', () => {
    const enc = Buffer.from(makeEncrypted())
    // Flip a byte somewhere after the header
    const offset = enc.length - 10
    enc[offset] ^= 0xff
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('rejects zeroed auth tag', () => {
    const enc = Buffer.from(makeEncrypted())
    // Zero out the first chunk's auth tag (starts at dataOffset + NONCE_SIZE)
    const headerLen = enc.readUInt32BE(7)
    const tagStart = headerLen + NONCE_SIZE
    enc.fill(0, tagStart, tagStart + TAG_SIZE)
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('rejects tampered header', () => {
    const enc = Buffer.from(makeEncrypted())
    // Flip a byte in the pre-tag section of the header
    enc[4] ^= 0xff // tamper with version byte
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('rejects tampered header tag', () => {
    const enc = Buffer.from(makeEncrypted())
    const headerLen = enc.readUInt32BE(7)
    // Tamper with the header auth tag (last 16 bytes of the header)
    const tagStart = headerLen - HEADER_TAG_SIZE
    enc[tagStart] ^= 0xff
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('rejects modified objectSalt in header', () => {
    const enc = Buffer.from(makeEncrypted())
    // objectSalt starts at offset 11 + 1 (keyIdLen) + keyIdLen
    const keyIdLen = enc.readUInt8(11)
    const saltOffset = 11 + 1 + keyIdLen
    enc[saltOffset] ^= 0xff
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('rejects modified rawSha256 in header', () => {
    const enc = Buffer.from(makeEncrypted())
    const headerLen = enc.readUInt32BE(7)
    // rawSha256 is at the end of pre-tag section: headerLen - TAG_SIZE - RAW_SHA256_SIZE
    const shaOffset = headerLen - HEADER_TAG_SIZE - 32
    enc[shaOffset] ^= 0xff
    expect(() => decrypt(enc, MASTER_KEY)).toThrow()
  })

  it('ignores extra trailing bytes (data unchanged)', () => {
    const data = randomBytes(50_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const withExtra = Buffer.concat([encryptedData, randomBytes(16)])
    // Extra trailing bytes are ignored; decrypted data matches original
    const result = decrypt(withExtra, MASTER_KEY)
    expect(result.data).toEqual(data)
  })

  it('wrong key fails', () => {
    const enc = makeEncrypted()
    expect(() => decrypt(enc, WRONG_KEY)).toThrow()
  })
})
