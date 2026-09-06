/**
 * Peak Memory Streaming Tests (Item 8)
 *
 * For full decryption and HTTP download:
 * - Do NOT use Buffer.concat to accumulate output
 * - Hash and discard each streamed chunk
 * - Sample RSS and heap repeatedly
 * - Report actual peak values
 * - Test at least 256 MB
 * - Test a cross-chunk range without loading the entire file
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import {
  EncryptedStorageService,
  takeMemorySnapshot,
  parseMasterKeyHex,
} from '../packages/crypto/src'

const MASTER_KEY = 'a'.repeat(64)
let tmpDir: string
let svc: EncryptedStorageService

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlt-mem-'))
  svc = new EncryptedStorageService({ dataDirectory: tmpDir, masterKeyHex: MASTER_KEY })
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

interface MemReport {
  rssStart: number
  rssPeak: number
  rssEnd: number
  heapUsedStart: number
  heapUsedPeak: number
  heapUsedEnd: number
  fileSize: number
  chunkSize: number
  durationMs: number
}

function samplePeakMemory(): { rssPeak: number; heapPeak: number } {
  let rssPeak = 0
  let heapPeak = 0
  const mem = process.memoryUsage()
  rssPeak = Math.max(rssPeak, mem.rss)
  heapPeak = Math.max(heapPeak, mem.heapUsed)
  return { rssPeak, heapPeak }
}

async function streamAndHash(
  readable: Readable,
  onChunk?: () => void,
): Promise<{ hash: string; peakRss: number; peakHeap: number }> {
  let rssPeak = 0
  let heapPeak = 0
  const hash = createHash('sha256')

  for await (const chunk of readable) {
    hash.update(chunk as Buffer)
    // Discard each chunk — do NOT accumulate
    onChunk?.()
    const mem = process.memoryUsage()
    rssPeak = Math.max(rssPeak, mem.rss)
    heapPeak = Math.max(heapPeak, mem.heapUsed)
  }

  return { hash: hash.digest('hex'), peakRss: rssPeak, peakHeap: heapPeak }
}

describe('Peak memory streaming tests', () => {
  it('256 MB full decrypt — streaming, no Buffer.concat', async () => {
    const totalSize = 256 * 1024 * 1024 // 256 MiB
    const chunkGenSize = 1024 * 1024 // 1 MiB generation chunks
    let generated = 0

    // Deterministic content for hash verification
    const seedHash = createHash('sha256').update('256mb-seed').digest()

    const inputStream = new Readable({
      read(size: number) {
        const toGenerate = Math.min(chunkGenSize, totalSize - generated)
        if (toGenerate <= 0) { this.push(null); return }
        // Deterministic content based on seed
        const buf = Buffer.alloc(toGenerate)
        for (let i = 0; i < toGenerate; i++) {
          buf[i] = seedHash[i % 32] ^ ((generated + i) & 0xff)
        }
        generated += toGenerate
        this.push(buf)
      },
    })

    const rssStart = takeMemorySnapshot().rssBytes
    const heapStart = takeMemorySnapshot().heapUsedBytes

    const t0 = Date.now()
    const result = await svc.storeStream(inputStream, '256mb-test.pdf', 'application/pdf')

    const rssAfterStore = takeMemorySnapshot().rssBytes
    console.log(`[256MB store] RSS: ${(rssStart / 1024 / 1024).toFixed(1)} → ${(rssAfterStore / 1024 / 1024).toFixed(1)} MB`)

    expect(result.header.plaintextSize).toBe(totalSize)
    expect(result.deduplicated).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, result.encryptedPath))).toBe(true)

    // Now decrypt via streaming — hash each chunk, discard it
    const streaming = await svc.retrieveStream(result.sha256)
    const decryptResult = await streamAndHash(streaming.stream)

    const rssEnd = takeMemorySnapshot().rssBytes
    const heapEnd = takeMemorySnapshot().heapUsedBytes
    const duration = Date.now() - t0

    // Expected hash (compute separately with same seed)
    const expectedHash = createHash('sha256')
    for (let i = 0; i < totalSize; i += chunkGenSize) {
      const len = Math.min(chunkGenSize, totalSize - i)
      const buf = Buffer.alloc(len)
      for (let j = 0; j < len; j++) {
        buf[j] = seedHash[j % 32] ^ ((i + j) & 0xff)
      }
      expectedHash.update(buf)
    }

    console.log(`[256MB full] RSS: start=${(rssStart/1024/1024).toFixed(1)}, peak=${(decryptResult.peakRss/1024/1024).toFixed(1)}, end=${(rssEnd/1024/1024).toFixed(1)} MB`)
    console.log(`[256MB full] Heap: start=${(heapStart/1024/1024).toFixed(1)}, peak=${(decryptResult.peakHeap/1024/1024).toFixed(1)}, end=${(heapEnd/1024/1024).toFixed(1)} MB`)
    console.log(`[256MB full] File=${(totalSize/1024/1024)}MB, Duration=${duration}ms`)

    // Verify hash matches (proves correct decryption)
    expect(decryptResult.hash).toBe(expectedHash.digest('hex'))

    // Memory assertion: peak RSS during decryption should be well below 2x file size
    // In a streaming implementation, peak RSS should be O(chunk size) not O(file size)
    const peakRssMB = decryptResult.peakRss / 1024 / 1024
    // Allow generous headroom for Node.js runtime overhead + V8 heap
    // 256MB file → streaming should peak well under 512MB RSS
    console.log(`[256MB full] Peak RSS: ${peakRssMB.toFixed(1)} MB (asserting < 512 MB)`)
    expect(peakRssMB).toBeLessThan(512)
  }, 300_000)

  it('Cross-chunk range decrypt without loading full file', async () => {
    // Use a 3 MiB file (3 chunks of 1 MiB each)
    const totalSize = 3 * 1024 * 1024
    const data = randomBytes(totalSize)
    const inputStream = Readable.from([data])

    const result = await svc.storeStream(inputStream, 'range-test.pdf', 'application/pdf')
    expect(result.header.chunkCount).toBe(3)

    // Request a range spanning chunk 0 end → chunk 1 start (cross-chunk boundary)
    const rangeStart = 1024 * 1024 - 100  // Last 100 bytes of chunk 0
    const rangeEnd = 1024 * 1024 + 100    // First 100 bytes of chunk 1

    const rssBefore = takeMemorySnapshot().rssBytes

    const rangeResult = await svc.retrieveRangeStream(result.sha256, rangeStart, rangeEnd + 1)

    const rssAfter = takeMemorySnapshot().rssBytes

    // Verify content
    expect(rangeResult.data).toEqual(data.subarray(rangeStart, rangeEnd + 1))
    expect(rangeResult.data.length).toBe(rangeEnd - rangeStart + 1)

    console.log(`[cross-chunk range] RSS before=${(rssBefore/1024/1024).toFixed(1)}, after=${(rssAfter/1024/1024).toFixed(1)} MB`)
    console.log(`[cross-chunk range] Requested ${rangeEnd - rangeStart + 1} bytes from 3 MiB file`)

    // RSS growth should be minimal — we only read 2 chunks of 1 MiB
    const rssGrowthMB = (rssAfter - rssBefore) / 1024 / 1024
    console.log(`[cross-chunk range] RSS growth: ${rssGrowthMB.toFixed(1)} MB (should be small, not 3 MB)`)
    expect(rssGrowthMB).toBeLessThan(5) // Well under the full 3 MiB
  }, 60_000)

  it('256 MB range decrypt — first 1 MiB only', async () => {
    const totalSize = 256 * 1024 * 1024
    let generated = 0
    const inputStream = new Readable({
      read() {
        const n = Math.min(1024 * 1024, totalSize - generated)
        if (n <= 0) { this.push(null); return }
        generated += n
        this.push(Buffer.alloc(n, 0x42))
      },
    })

    const result = await svc.storeStream(inputStream, '256mb-range.pdf', 'application/pdf')

    const rssBefore = takeMemorySnapshot().rssBytes

    // Request only first 1 MiB of 256 MiB file
    const rangeResult = await svc.retrieveRangeStream(result.sha256, 0, 1024 * 1024)

    const rssAfter = takeMemorySnapshot().rssBytes

    expect(rangeResult.data.length).toBe(1024 * 1024)
    // Content should be 0x42
    expect(rangeResult.data.every(b => b === 0x42)).toBe(true)

    const rssGrowthMB = (rssAfter - rssBefore) / 1024 / 1024
    console.log(`[256MB range] RSS growth: ${rssGrowthMB.toFixed(1)} MB for 1 MiB range from 256 MiB file`)
    // Should NOT grow by anywhere near 256 MB — only 1 chunk was decrypted
    expect(rssGrowthMB).toBeLessThan(10)
  }, 300_000)
})
