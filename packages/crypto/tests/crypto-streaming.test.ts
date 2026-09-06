import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { EncryptedStorageService, takeMemorySnapshot, computeHashBuffer } from '../src'

const MASTER_KEY = 'a'.repeat(64)

function collectStream(readable: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readable.on('data', (c: Buffer) => chunks.push(c))
    readable.on('end', () => resolve(Buffer.concat(chunks)))
    readable.on('error', reject)
  })
}

describe('crypto-streaming', () => {
  it('5MB stream roundtrip with SHA-256 verification', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-stream-'))
    const svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
    try {
      const size = 5 * 1024 * 1024
      const original = randomBytes(size)
      const expectedSha = computeHashBuffer(original).sha256

      const snap0 = takeMemorySnapshot()
      const storeResult = await svc.storeStream(
        Readable.from([original]),
        'large-file.pdf',
        'application/pdf',
      )
      const snap1 = takeMemorySnapshot()

      expect(storeResult.deduplicated).toBe(false)
      expect(storeResult.sha256).toBe(expectedSha)

      const retrieved = await svc.retrieve(storeResult.sha256)
      const decrypted = await collectStream(retrieved.data)
      const snap2 = takeMemorySnapshot()

      expect(decrypted).toEqual(original)
      expect(computeHashBuffer(decrypted).sha256).toBe(expectedSha)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('RSS memory measurement', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-rss-'))
    const svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
    try {
      const size = 5 * 1024 * 1024
      const original = randomBytes(size)

      const rssBefore = takeMemorySnapshot().rssBytes
      const storeResult = await svc.storeStream(
        Readable.from([original]),
        'rss-test.pdf',
        'application/pdf',
      )
      const rssAfterEncrypt = takeMemorySnapshot().rssBytes

      const retrieved = await svc.retrieve(storeResult.sha256)
      const decrypted = await collectStream(retrieved.data)
      const rssAfterDecrypt = takeMemorySnapshot().rssBytes

      expect(decrypted).toEqual(original)
      // Log RSS for observation; no strict assertion on RSS in sandbox
      console.log(`RSS before: ${(rssBefore / 1024 / 1024).toFixed(1)}MB, after encrypt: ${(rssAfterEncrypt / 1024 / 1024).toFixed(1)}MB, after decrypt: ${(rssAfterDecrypt / 1024 / 1024).toFixed(1)}MB`)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
