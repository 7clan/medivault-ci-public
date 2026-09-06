import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, takeMemorySnapshot, computeHashBuffer } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('crypto-large', () => {
  // Buffer-based large file test — reduced to 4MB to fit sandbox memory limits.
  // The 256MB streaming test is in the integration suite (tests/m3-integration.test.ts).
  it('4MB encrypt/decrypt with RSS measurement', () => {
    const size = 4 * 1024 * 1024
    const original = randomBytes(size)
    const expectedSha = computeHashBuffer(original).sha256

    const rssBefore = takeMemorySnapshot().rssBytes
    const { encryptedData, sha256 } = encrypt(original, MASTER_KEY, 'application/pdf')
    const rssAfterEncrypt = takeMemorySnapshot().rssBytes

    expect(sha256).toBe(expectedSha)

    const result = decrypt(encryptedData, MASTER_KEY)
    const rssAfterDecrypt = takeMemorySnapshot().rssBytes

    expect(result.data).toEqual(original)
    expect(computeHashBuffer(result.data).sha256).toBe(expectedSha)

    console.log(`4MB: RSS before=${(rssBefore / 1024 / 1024).toFixed(1)}MB, after encrypt=${(rssAfterEncrypt / 1024 / 1024).toFixed(1)}MB, after decrypt=${(rssAfterDecrypt / 1024 / 1024).toFixed(1)}MB`)
  }, 120_000)
})
