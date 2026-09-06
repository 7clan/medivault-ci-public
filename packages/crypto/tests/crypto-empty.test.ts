import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, DEFAULT_CHUNK_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('crypto-empty', () => {
  it('0 byte encrypt/decrypt', () => {
    const empty = Buffer.alloc(0)
    const { encryptedData, header, sha256 } = encrypt(empty, MASTER_KEY, 'application/pdf')
    expect(header.chunkCount).toBe(1)
    expect(header.plaintextSize).toBe(0)
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(empty)
    expect(result.originalSize).toBe(0)
  })

  it('1 byte encrypt/decrypt', () => {
    const one = Buffer.from([0x42])
    const { encryptedData, header } = encrypt(one, MASTER_KEY, 'image/png')
    expect(header.chunkCount).toBe(1)
    expect(header.plaintextSize).toBe(1)
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(one)
  })

  it('exactly 1 chunk encrypt/decrypt', () => {
    const data = randomBytes(DEFAULT_CHUNK_SIZE)
    const { encryptedData, header } = encrypt(data, MASTER_KEY, 'image/jpeg')
    expect(header.chunkCount).toBe(1)
    expect(header.plaintextSize).toBe(DEFAULT_CHUNK_SIZE)
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(data)
  })
})
