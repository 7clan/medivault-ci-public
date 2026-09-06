import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { EncryptedStorageService } from '../src'

const MASTER_KEY = 'a'.repeat(64)

function makeService(): { svc: EncryptedStorageService; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-ptrav-'))
  const svc = new EncryptedStorageService({ dataDirectory: dir, masterKeyHex: MASTER_KEY })
  return { svc, dir }
}

// All these must be rejected by validateFileName
const DANGEROUS_FILENAMES: string[] = [
  '../etc/passwd',
  '..\\etc\\passwd',
  '/etc/passwd',
  '../../etc/shadow',
  '..%2f..%2fetc',
  '....//....//etc',
  'foo/../bar',
  'foo/..',
  'foo/bar/../../../etc/passwd',
  './hidden',
  'file/with/slashes',
  'file\\with\\backslashes',
  'file\x00null.pdf',
  'file<script>alert(1)</script>.pdf',
  'file with spaces.pdf',
  'file\twith\ttab.pdf',
  'file\nwith\nnewline.pdf',
  'file\rwith\rcarriage.pdf',
  '',
  '   ',
  '...',
  '.. ',
  ' .hidden',
  '<<<bad>>>',
]

const SAFE_FILENAMES = [
  'document.pdf',
  'image-01.png',
  'report_final_v2.jpeg',
  'scan.heic',
  'photo.webp',
  'xray.tiff',
  'mri.bmp',
  'test.heif',
  'a.b',
  'Medical-Report_2024-01.pdf',
]

describe('path-traversal', () => {
  let svc: EncryptedStorageService
  let dir: string

  beforeEach(() => {
    const r = makeService()
    svc = r.svc
    dir = r.dir
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  for (const name of DANGEROUS_FILENAMES) {
    it(`rejects dangerous filename: ${JSON.stringify(name)}`, async () => {
      await expect(
        svc.store(randomBytes(100), name, 'application/pdf')
      ).rejects.toThrow()
    })
  }

  for (const name of SAFE_FILENAMES) {
    it(`accepts safe filename: ${name}`, async () => {
      const data = randomBytes(100)
      const result = await svc.store(data, name, 'application/pdf')
      expect(result.sha256).toHaveLength(64)
    })
  }
})
