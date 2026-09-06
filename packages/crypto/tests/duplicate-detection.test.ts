import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { EncryptedStorageService } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('duplicate-detection', () => {
  let tmpDir: string
  let svc: EncryptedStorageService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-dedup-'))
    svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('same content -> same path', async () => {
    const data = randomBytes(50_000)
    const r1 = await svc.store(data, 'first.pdf', 'application/pdf')
    const r2 = await svc.store(data, 'second.pdf', 'application/pdf')
    expect(r2.encryptedPath).toBe(r1.encryptedPath)
    expect(r2.deduplicated).toBe(true)
    // Only one file on disk
    expect(fs.existsSync(path.join(tmpDir, r1.encryptedPath))).toBe(true)
  })

  it('different content -> different paths', async () => {
    const d1 = randomBytes(50_000)
    const d2 = randomBytes(50_000)
    const r1 = await svc.store(d1, 'file-a.pdf', 'application/pdf')
    const r2 = await svc.store(d2, 'file-b.pdf', 'application/pdf')
    expect(r2.encryptedPath).not.toBe(r1.encryptedPath)
    expect(r2.deduplicated).toBe(false)
  })
})
