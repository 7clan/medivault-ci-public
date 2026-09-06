/**
 * MediVault Crypto — SHA-256 Hash Computation (Streaming)
 */

import { createHash } from 'node:crypto'
import { openSync, readSync, closeSync, statSync, createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import type { HashResult, FileHashResult } from './types'

/**
 * Compute the SHA-256 hash of a Buffer.
 */
export function computeHashBuffer(data: Buffer): HashResult {
  const hash = createHash('sha256')
  hash.update(data)
  return { sha256: hash.digest('hex'), size: data.length }
}

/**
 * Compute the SHA-256 hash and get raw digest of a Buffer.
 */
export function computeHashBufferRaw(data: Buffer): { sha256: string; rawSha256: Buffer; size: number } {
  const hash = createHash('sha256')
  hash.update(data)
  const raw = hash.digest()
  return { sha256: raw.toString('hex'), rawSha256: raw, size: data.length }
}

/**
 * Compute the SHA-256 hash of a Node.js Readable stream.
 * Streams chunks through to avoid loading the entire file into memory.
 */
export function computeHash(readable: Readable): Promise<HashResult> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let totalSize = 0

    readable.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      totalSize += chunk.length
    })

    readable.on('end', () => {
      resolve({ sha256: hash.digest('hex'), size: totalSize })
    })

    readable.on('error', (err: Error) => {
      reject(err)
    })
  })
}

/**
 * Compute SHA-256 hash of a file on disk, streaming through without
 * loading the entire file into memory.
 *
 * Used by the storage-service two-pass streaming flow.
 *
 * @param filePath - Absolute path to the file
 * @returns sha256 (hex), rawSha256 (32B Buffer), size (number)
 */
export function computeHashFile(filePath: string): FileHashResult {
  const hash = createHash('sha256')
  const stat = statSync(filePath)
  let totalSize = 0

  const fd = openSync(filePath, 'r')
  const buf = Buffer.alloc(1024 * 1024)
  try {
    let bytesRead: number
    while ((bytesRead = readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead))
      totalSize += bytesRead
    }
  } finally {
    closeSync(fd)
  }

  const raw = hash.digest()
  return { sha256: raw.toString('hex'), rawSha256: raw, size: totalSize }
}
