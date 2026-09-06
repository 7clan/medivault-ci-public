import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, decryptRange, DEFAULT_CHUNK_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('crypto-range', () => {
  it('full range', () => {
    const data = randomBytes(200_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const full = decrypt(encryptedData, MASTER_KEY).data
    const range = decryptRange(encryptedData, MASTER_KEY, { start: 0, end: data.length })
    expect(range.data).toEqual(full)
  })

  it('first 100 bytes', () => {
    const data = randomBytes(200_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const range = decryptRange(encryptedData, MASTER_KEY, { start: 0, end: 100 })
    expect(range.data).toEqual(data.subarray(0, 100))
  })

  it('last 100 bytes', () => {
    const data = randomBytes(200_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const range = decryptRange(encryptedData, MASTER_KEY, { start: data.length - 100, end: data.length })
    expect(range.data).toEqual(data.subarray(data.length - 100))
  })

  it('middle 100 bytes', () => {
    const data = randomBytes(200_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const start = 100_000
    const end = 100_100
    const range = decryptRange(encryptedData, MASTER_KEY, { start, end })
    expect(range.data).toEqual(data.subarray(start, end))
  })

  it('cross-chunk range', () => {
    // Use MIN_CHUNK_SIZE so we cross chunk boundaries within semantic validation bounds
    const chunkSize = 65536 // 64 KiB (MIN_CHUNK_SIZE)
    const data = randomBytes(chunkSize * 2 + 1000) // 3 chunks
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf', 'key-v1', chunkSize)
    // Range spanning chunk 0 and chunk 1 boundary (at chunkSize)
    const start = chunkSize - 10
    const end = chunkSize + 10
    const range = decryptRange(encryptedData, MASTER_KEY, { start, end })
    expect(range.data).toEqual(data.subarray(start, end))
  })

  it('out of bounds returns empty', () => {
    const data = randomBytes(200_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    const range = decryptRange(encryptedData, MASTER_KEY, { start: 999_999, end: 1_000_000 })
    expect(range.data).toEqual(Buffer.alloc(0))
    expect(range.totalSize).toBe(data.length)
  })
})
