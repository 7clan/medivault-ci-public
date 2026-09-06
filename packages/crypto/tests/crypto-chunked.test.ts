import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, parseEncryptedHeader, buildChunkNonce, NONCE_SIZE, DEFAULT_CHUNK_SIZE, NONCE_PREFIX_SIZE, HEADER_NONCE_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('crypto-chunked', () => {
  it('independent auth tags — tampering one chunk fails the whole decrypt', () => {
    // Encrypt 2-chunk file (use MIN_CHUNK_SIZE to pass semantic validation)
    const chunkSize = 65536 // 64 KiB (MIN_CHUNK_SIZE)
    const data = randomBytes(chunkSize + 100) // 2 chunks
    const { encryptedData, header } = encrypt(data, MASTER_KEY, 'application/pdf', 'key-v1', chunkSize)
    expect(header.chunkCount).toBe(2)

    // Tamper with chunk 1's ciphertext
    const tampered = Buffer.from(encryptedData)
    const chunk0Len = NONCE_SIZE + 16 + chunkSize
    const tamperOffset = header.headerLength + chunk0Len + NONCE_SIZE + 16 // into chunk 1 ciphertext
    tampered[tamperOffset] ^= 0xff

    // Whole decrypt should fail
    expect(() => decrypt(tampered, MASTER_KEY)).toThrow()
  })

  it('per-object nonce uniqueness — same data produces different ciphertext', () => {
    const data = randomBytes(500)
    const enc1 = encrypt(data, MASTER_KEY, 'application/pdf').encryptedData
    const enc2 = encrypt(data, MASTER_KEY, 'application/pdf').encryptedData

    // The two encrypted buffers must be different (random objectSalt, noncePrefix, headerNonce)
    expect(enc1.equals(enc2)).toBe(false)

    // But both decrypt to the same plaintext
    const d1 = decrypt(enc1, MASTER_KEY).data
    const d2 = decrypt(enc2, MASTER_KEY).data
    expect(d1).toEqual(data)
    expect(d2).toEqual(data)
  })

  it('deterministic nonce from prefix+index', () => {
    const data = randomBytes(500)
    const { encryptedData, header } = encrypt(data, MASTER_KEY, 'application/pdf', 'key-v1', DEFAULT_CHUNK_SIZE)

    // Build nonce from prefix and index 0
    const expectedNonce = buildChunkNonce(header.noncePrefix, 0)

    // Read nonce from file at dataOffset
    const storedNonce = encryptedData.subarray(header.dataOffset, header.dataOffset + NONCE_SIZE)
    expect(storedNonce.equals(expectedNonce)).toBe(true)
  })

  it('chunk count for various sizes', () => {
    const testCases = [
      { size: 0, expected: 1 },
      { size: 1, expected: 1 },
      { size: DEFAULT_CHUNK_SIZE, expected: 1 },
      { size: DEFAULT_CHUNK_SIZE + 1, expected: 2 },
      { size: 2 * DEFAULT_CHUNK_SIZE, expected: 2 },
      { size: 2 * DEFAULT_CHUNK_SIZE + 1, expected: 3 },
    ]

    for (const { size, expected } of testCases) {
      const data = size === 0 ? Buffer.alloc(0) : randomBytes(size)
      const { header } = encrypt(data, MASTER_KEY, 'application/pdf', 'key-v1', DEFAULT_CHUNK_SIZE)
      expect(header.chunkCount).toBe(expected)
    }
  })
})
