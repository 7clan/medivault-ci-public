import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { EncryptedStorageService, validateSha256Hex, computeHashBuffer } from '../src'

const MASTER_KEY = 'a'.repeat(64)

function collectStream(readable: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readable.on('data', (c: Buffer) => chunks.push(c))
    readable.on('end', () => resolve(Buffer.concat(chunks)))
    readable.on('error', reject)
  })
}

describe('storage-service', () => {
  let tmpDir: string
  let svc: EncryptedStorageService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-svc-'))
    svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('store and retrieve', async () => {
    const data = randomBytes(10_000)
    const result = await svc.store(data, 'test.pdf', 'application/pdf')
    const retrieved = await svc.retrieve(result.sha256)
    const decrypted = await collectStream(retrieved.data)
    expect(decrypted).toEqual(data)
  })

  it('dedup returns same path', async () => {
    const data = randomBytes(10_000)
    const r1 = await svc.store(data, 'test.pdf', 'application/pdf')
    const r2 = await svc.store(data, 'test2.pdf', 'application/pdf')
    expect(r2.deduplicated).toBe(true)
    expect(r2.encryptedPath).toBe(r1.encryptedPath)
  })

  it('custom data directory', async () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-custom-'))
    const customSvc = new EncryptedStorageService({ dataDirectory: customDir, masterKeyHex: MASTER_KEY })
    try {
      const data = randomBytes(5_000)
      const result = await customSvc.store(data, 'custom.pdf', 'application/pdf')
      expect(fs.existsSync(path.join(customDir, result.encryptedPath))).toBe(true)
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true })
    }
  })

  it('path traversal rejected', async () => {
    await expect(svc.store(randomBytes(100), '../etc/passwd', 'application/pdf')).rejects.toThrow(/traversal|path/i)
  })

  it('unsupported MIME rejected', async () => {
    await expect(svc.store(randomBytes(100), 'test.exe', 'application/octet-stream')).rejects.toThrow(/unsupported/i)
  })

  it('SHA-256 validation', async () => {
    const data = randomBytes(10_000)
    const expected = computeHashBuffer(data).sha256
    const result = await svc.store(data, 'sha-test.pdf', 'application/pdf')
    expect(result.sha256).toBe(expected)
  })

  it('deletePhysical removes file', async () => {
    const data = randomBytes(10_000)
    const result = await svc.store(data, 'delete-test.pdf', 'application/pdf')
    expect(svc.exists(result.sha256)).toBe(true)
    await svc.deletePhysical(result.sha256)
    expect(svc.exists(result.sha256)).toBe(false)
  })

  it('exists returns correct boolean', async () => {
    const data = randomBytes(10_000)
    const result = await svc.store(data, 'exists-test.pdf', 'application/pdf')
    expect(svc.exists(result.sha256)).toBe(true)
    expect(svc.exists('a'.repeat(64))).toBe(false)
  })

  it('validateSha256Hex', () => {
    expect(validateSha256Hex('a'.repeat(64))).toBe(true)
    expect(validateSha256Hex('A'.repeat(64))).toBe(false) // uppercase
    expect(validateSha256Hex('a'.repeat(63))).toBe(false)
    expect(validateSha256Hex('a'.repeat(65))).toBe(false)
    expect(validateSha256Hex('g'.repeat(64))).toBe(false) // invalid hex
  })
})
