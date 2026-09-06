import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  encrypt,
  decrypt,
  parseEncryptedHeader,
  EncryptedStorageService,
  takeMemorySnapshot,
  OBJECT_SALT_SIZE,
  NONCE_PREFIX_SIZE,
  HEADER_NONCE_SIZE,
  RAW_SHA256_SIZE,
  computeHashBuffer,
} from '../src'

const MASTER_KEY = 'a'.repeat(64) // 64 hex chars = 256-bit key

function collectStream(readable: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readable.on('data', (c: Buffer) => chunks.push(c))
    readable.on('end', () => resolve(Buffer.concat(chunks)))
    readable.on('error', reject)
  })
}

describe('crypto-roundtrip', () => {
  it('encrypts and decrypts a PDF buffer', () => {
    const pdf = randomBytes(50_000)
    const { encryptedData, sha256, header } = encrypt(pdf, MASTER_KEY, 'application/pdf')
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(pdf)
    expect(result.mimeType).toBe('application/pdf')
    expect(result.originalSize).toBe(pdf.length)
    const hash = computeHashBuffer(result.data)
    expect(hash.sha256).toBe(sha256)
  })

  it('encrypts and decrypts a PNG buffer', () => {
    const png = randomBytes(120_000)
    const { encryptedData, sha256 } = encrypt(png, MASTER_KEY, 'image/png')
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(png)
    expect(result.mimeType).toBe('image/png')
    expect(computeHashBuffer(result.data).sha256).toBe(sha256)
  })

  it('preserves empty file', () => {
    const empty = Buffer.alloc(0)
    const { encryptedData } = encrypt(empty, MASTER_KEY, 'application/pdf')
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(empty)
    expect(result.mimeType).toBe('application/pdf')
    expect(result.originalSize).toBe(0)
  })

  it('handles 1MB buffer', () => {
    const data = randomBytes(1024 * 1024) // exactly 1 chunk
    const { encryptedData, sha256 } = encrypt(data, MASTER_KEY, 'application/pdf')
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(data)
    expect(computeHashBuffer(result.data).sha256).toBe(sha256)
  })

  it('handles 1 byte over 1 chunk', () => {
    const chunkSize = 1024 * 1024
    const data = randomBytes(chunkSize + 1)
    const { encryptedData, sha256, header } = encrypt(data, MASTER_KEY, 'application/pdf', 'key-v1', chunkSize)
    expect(header.chunkCount).toBe(2)
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(data)
    expect(computeHashBuffer(result.data).sha256).toBe(sha256)
  })

  it('custom chunk size works', () => {
    const chunkSize = 256 * 1024
    const data = randomBytes(700_000) // ~2.7 chunks → 3 chunks
    const { encryptedData, header, sha256 } = encrypt(data, MASTER_KEY, 'image/jpeg', 'key-v1', chunkSize)
    expect(header.chunkSize).toBe(chunkSize)
    expect(header.chunkCount).toBe(3)
    const result = decrypt(encryptedData, MASTER_KEY)
    expect(result.data).toEqual(data)
    expect(computeHashBuffer(result.data).sha256).toBe(sha256)
  })

  it('header contains v3 fields', () => {
    const data = randomBytes(1024)
    const { encryptedData, header } = encrypt(data, MASTER_KEY, 'image/png')
    const parsed = parseEncryptedHeader(encryptedData, MASTER_KEY)
    expect(parsed.formatVersion).toBe(3)
    expect(parsed.objectSalt.length).toBe(OBJECT_SALT_SIZE)
    expect(parsed.headerNonce.length).toBe(HEADER_NONCE_SIZE)
    expect(parsed.noncePrefix.length).toBe(NONCE_PREFIX_SIZE)
    expect(parsed.rawSha256.length).toBe(RAW_SHA256_SIZE)
    expect(parsed.headerLength).toBeGreaterThan(0)
    expect(parsed.dataOffset).toBe(parsed.headerLength)
  })

  it('stream store/retrieve roundtrip', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-test-'))
    const svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
    try {
      const original = randomBytes(200_000)
      const storeResult = await svc.storeStream(
        Readable.from([original]),
        'test-stream.pdf',
        'application/pdf',
      )
      expect(storeResult.deduplicated).toBe(false)
      const retrieved = await svc.retrieve(storeResult.sha256)
      const decrypted = await collectStream(retrieved.data)
      expect(decrypted).toEqual(original)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
