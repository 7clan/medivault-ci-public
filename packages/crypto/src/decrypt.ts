/*
 * MediVault Crypto — AES-256-GCM Chunked Decryption (MVLT v3)
 *
 * Supports:
 * - Full file decryption (buffer and stream)
 * - Genuine file-descriptor-based streaming decryption (never loads full file)
 * - Range-based decryption for HTTP range requests (from fd)
 * - Per-chunk AAD auth tag validation (tampered chunk → error)
 * - Header authentication validation with per-object key derivation
 * - Memory-bounded: only decrypts requested chunks
 */

import fs from 'node:fs'
import { createDecipheriv } from 'node:crypto'
import { Readable } from 'node:stream'

import { ALGORITHM, NONCE_SIZE, TAG_SIZE, FORMAT_VERSION, MAX_CHUNK_SIZE } from './constants.js'
import { parseAndVerifyHeader } from './header.js'
import { deriveFileKey, buildChunkNonce, parseMasterKeyHex } from './key-management.js'
import { buildChunkAad } from './encrypt.js'
import type { DecryptResult, StreamingDecryptResult, RangeDecryptResult, MvltHeader, ByteRange, ObjectKeys } from './types'

/**
 * Compute the plaintext ciphertext length for a given chunk.
 */
function chunkCipherLen(header: MvltHeader, chunkIndex: number): number {
  const isLast = chunkIndex === header.chunkCount - 1
  if (isLast) {
    const remainder = header.plaintextSize % header.chunkSize
    if (remainder === 0 && header.plaintextSize > 0) return header.chunkSize
    return remainder || 0
  }
  return header.chunkSize
}

/**
 * Decrypt a complete MVLT v3 encrypted buffer.
 *
 * @param encryptedData - Full encrypted buffer (header + all chunks)
 * @param masterKeyHex - 64-char hex master key
 * @throws Error if header auth fails, any chunk auth fails, or key is wrong
 */
export function decrypt(encryptedData: Buffer, masterKeyHex: string): DecryptResult {
  const masterKey = parseMasterKeyHex(masterKeyHex)
  const { header, objectKeys, dataOffset } = parseAndVerifyHeader(encryptedData, masterKey)

  // Derive per-object file key
  const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, header.keyId)

  // Decrypt all chunks
  const plaintextChunks: Buffer[] = []
  let filePos = dataOffset

  for (let i = 0; i < header.chunkCount; i++) {
    const ctLen = chunkCipherLen(header, i)

    // Read chunk nonce (12B)
    if (filePos + NONCE_SIZE > encryptedData.length) {
      throw new Error(`Truncated encrypted file: missing nonce for chunk ${i}`)
    }
    const chunkNonce = encryptedData.subarray(filePos, filePos + NONCE_SIZE)
    filePos += NONCE_SIZE

    // Read auth tag (16B)
    if (filePos + TAG_SIZE > encryptedData.length) {
      throw new Error(`Truncated encrypted file: missing auth tag for chunk ${i}`)
    }
    const chunkTag = encryptedData.subarray(filePos, filePos + TAG_SIZE)
    filePos += TAG_SIZE

    if (filePos + ctLen > encryptedData.length) {
      throw new Error(`Truncated encrypted file: missing ciphertext for chunk ${i}`)
    }
    const ciphertext = encryptedData.subarray(filePos, filePos + ctLen)
    filePos += ctLen

    // Verify nonce matches expected
    const expectedNonce = buildChunkNonce(objectKeys.noncePrefix, i)
    if (!chunkNonce.equals(expectedNonce)) {
      throw new Error(
        `Chunk ${i} nonce mismatch: file may be corrupted or encrypted with a different key`,
      )
    }

    // Build AAD and decrypt
    const aad = buildChunkAad({
      formatVersion: header.formatVersion,
      keyId: header.keyId,
      rawSha256: header.rawSha256,
      chunkIndex: i,
      plaintextChunkLength: ctLen,
      totalChunkCount: header.chunkCount,
    })

    const decipher = createDecipheriv(ALGORITHM, fileKey, chunkNonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(chunkTag)

    let plaintext: Buffer
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch (err) {
      throw new Error(
        `Decryption failed for chunk ${i}: authentication tag mismatch. ${err instanceof Error ? err.message : ''}`,
      )
    }

    plaintextChunks.push(plaintext)
  }

  return {
    data: Buffer.concat(plaintextChunks),
    mimeType: header.mimeType,
    originalSize: header.plaintextSize,
    keyId: header.keyId,
  }
}

/**
 * Decrypt a single chunk by index.
 * Used for range requests where only specific chunks need decryption.
 */
export function decryptSingleChunk(
  encryptedData: Buffer,
  chunkIndex: number,
  fileKey: Buffer,
  header: MvltHeader,
  objectKeys: ObjectKeys,
): Buffer {
  let filePos = header.dataOffset

  // Seek to the requested chunk
  for (let i = 0; i < chunkIndex; i++) {
    const ctLen = chunkCipherLen(header, i)
    filePos += NONCE_SIZE + TAG_SIZE + ctLen
  }

  // Read nonce
  const chunkNonce = encryptedData.subarray(filePos, filePos + NONCE_SIZE)
  filePos += NONCE_SIZE

  // Read auth tag
  const chunkTag = encryptedData.subarray(filePos, filePos + TAG_SIZE)
  filePos += TAG_SIZE

  const ctLen = chunkCipherLen(header, chunkIndex)
  const ciphertext = encryptedData.subarray(filePos, filePos + ctLen)

  // Verify nonce
  const expectedNonce = buildChunkNonce(objectKeys.noncePrefix, chunkIndex)
  if (!chunkNonce.equals(expectedNonce)) {
    throw new Error(`Chunk ${chunkIndex} nonce mismatch`)
  }

  // Build AAD and decrypt
  const aad = buildChunkAad({
    formatVersion: header.formatVersion,
    keyId: header.keyId,
    rawSha256: header.rawSha256,
    chunkIndex,
    plaintextChunkLength: ctLen,
    totalChunkCount: header.chunkCount,
  })

  const decipher = createDecipheriv(ALGORITHM, fileKey, chunkNonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(chunkTag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (err) {
    throw new Error(
      `Decryption failed for chunk ${chunkIndex}: ${err instanceof Error ? err.message : ''}`,
    )
  }
}

/**
 * Decrypt a byte range from an encrypted buffer.
 * Only decrypts the chunks that overlap the requested range.
 */
export function decryptRange(
  encryptedData: Buffer,
  masterKeyHex: string,
  range: ByteRange,
): RangeDecryptResult {
  const masterKey = parseMasterKeyHex(masterKeyHex)
  const { header, objectKeys } = parseAndVerifyHeader(encryptedData, masterKey)
  const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, header.keyId)

  // Clamp range to file size
  const start = Math.max(0, Math.min(range.start, header.plaintextSize))
  const end = Math.min(range.end, header.plaintextSize)
  if (start >= end) {
    return { data: Buffer.alloc(0), mimeType: header.mimeType, totalSize: header.plaintextSize, keyId: header.keyId }
  }

  // Determine which chunks overlap the range
  const firstChunk = Math.floor(start / header.chunkSize)
  const lastChunk = Math.min(Math.floor((end - 1) / header.chunkSize), header.chunkCount - 1)

  const resultBuffers: Buffer[] = []

  for (let ci = firstChunk; ci <= lastChunk; ci++) {
    const chunkPlaintext = decryptSingleChunk(encryptedData, ci, fileKey, header, objectKeys)
    const chunkStart = ci * header.chunkSize
    const chunkEnd = Math.min(chunkStart + header.chunkSize, header.plaintextSize)

    // Extract the overlapping portion
    const overlapStart = Math.max(start, chunkStart) - chunkStart
    const overlapEnd = Math.min(end, chunkEnd) - chunkStart
    resultBuffers.push(chunkPlaintext.subarray(overlapStart, overlapEnd))
  }

  return {
    data: Buffer.concat(resultBuffers),
    mimeType: header.mimeType,
    totalSize: header.plaintextSize,
    keyId: header.keyId,
  }
}

/**
 * Decrypt a MVLT v3 encrypted buffer and return as a Readable stream.
 */
export function decryptToStream(
  encryptedData: Buffer,
  masterKeyHex: string,
): StreamingDecryptResult {
  const result = decrypt(encryptedData, masterKeyHex)
  return {
    stream: Readable.from([result.data]),
    mimeType: result.mimeType,
    originalSize: result.originalSize,
    keyId: result.keyId,
    contentLength: result.originalSize,
  }
}

/**
 * Parse and verify the header of an encrypted buffer without decrypting.
 * Returns the parsed header.
 */
export function parseEncryptedHeader(
  encryptedData: Buffer,
  masterKeyHex: string,
): MvltHeader {
  const masterKey = parseMasterKeyHex(masterKeyHex)
  const { header } = parseAndVerifyHeader(encryptedData, masterKey)
  return header
}

/**
 * Compute the on-disk byte offset for a given chunk index.
 */
function chunkFileOffset(header: MvltHeader, chunkIndex: number): number {
  let offset = header.dataOffset
  for (let i = 0; i < chunkIndex; i++) {
    offset += NONCE_SIZE + TAG_SIZE + chunkCipherLen(header, i)
  }
  return offset
}

/**
 * Read and decrypt a single chunk from a file descriptor.
 * Reuses the same decryption logic as decryptSingleChunk but reads from fd.
 */
function decryptChunkFromFd(
  fd: number,
  chunkIndex: number,
  fileKey: Buffer,
  header: MvltHeader,
  objectKeys: ObjectKeys,
): Buffer {
  const ctLen = chunkCipherLen(header, chunkIndex)
  const chunkOffset = chunkFileOffset(header, chunkIndex)
  const readSize = NONCE_SIZE + TAG_SIZE + ctLen
  const buf = Buffer.alloc(readSize)

  const bytesRead = fs.readSync(fd, buf, 0, readSize, chunkOffset)
  if (bytesRead !== readSize) {
    throw new Error(
      `Truncated encrypted file: expected ${readSize} bytes for chunk ${chunkIndex}, got ${bytesRead}`,
    )
  }

  const chunkNonce = buf.subarray(0, NONCE_SIZE)
  const chunkTag = buf.subarray(NONCE_SIZE, NONCE_SIZE + TAG_SIZE)
  const ciphertext = buf.subarray(NONCE_SIZE + TAG_SIZE)

  // Verify nonce matches expected
  const expectedNonce = buildChunkNonce(objectKeys.noncePrefix, chunkIndex)
  if (!chunkNonce.equals(expectedNonce)) {
    throw new Error(
      `Chunk ${chunkIndex} nonce mismatch: file may be corrupted or encrypted with a different key`,
    )
  }

  // Build AAD and decrypt
  const aad = buildChunkAad({
    formatVersion: header.formatVersion,
    keyId: header.keyId,
    rawSha256: header.rawSha256,
    chunkIndex,
    plaintextChunkLength: ctLen,
    totalChunkCount: header.chunkCount,
  })

  const decipher = createDecipheriv(ALGORITHM, fileKey, chunkNonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(chunkTag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (err) {
    throw new Error(
      `Decryption failed for chunk ${chunkIndex}: ${err instanceof Error ? err.message : ''}`,
    )
  }
}

/**
 * Decrypt a MVLT v3 encrypted file directly to a Readable stream.
 * Never loads the full file into memory — reads and decrypts one chunk at a time
 * from the file descriptor, respecting backpressure.
 *
 * @param filePath - Path to the .enc file on disk
 * @param masterKey - 32-byte master key Buffer (not hex)
 */
export function decryptFileToStream(
  filePath: string,
  masterKey: Buffer,
): StreamingDecryptResult {
  // Open fd and read header (typically < 300 bytes)
  const PROBE_SIZE = 11
  const probe = Buffer.alloc(PROBE_SIZE)
  const fd = fs.openSync(filePath, 'r')

  let header: MvltHeader
  let objectKeys: ObjectKeys
  let fileKey: Buffer

  try {
    const probeRead = fs.readSync(fd, probe, 0, PROBE_SIZE, 0)
    if (probeRead < PROBE_SIZE) {
      throw new Error(`File too small to read MVLT header length: ${probeRead} bytes`)
    }
    const headerLength = probe.readUInt32BE(7)
    if (headerLength < 130 || headerLength > 10000) {
      throw new Error(`Invalid header length: ${headerLength}`)
    }

    const headerBuf = Buffer.alloc(headerLength)
    fs.readSync(fd, headerBuf, 0, headerLength, 0)

    const parsed = parseAndVerifyHeader(headerBuf, masterKey)
    header = parsed.header
    objectKeys = parsed.objectKeys
    fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, header.keyId)
  } catch (err) {
    fs.closeSync(fd)
    throw err
  }

  // Pre-compute chunk file offsets for sequential reading
  const chunkOffsets: number[] = []
  let offset = header.dataOffset
  for (let i = 0; i < header.chunkCount; i++) {
    chunkOffsets.push(offset)
    offset += NONCE_SIZE + TAG_SIZE + chunkCipherLen(header, i)
  }

  // Reusable read buffer (sized for largest possible chunk + nonce + tag)
  const readBuf = Buffer.alloc(NONCE_SIZE + TAG_SIZE + MAX_CHUNK_SIZE)

  // Track state for the stream
  let currentChunk = 0
  let fdClosed = false

  // Handle empty files
  const isEmpty = header.chunkCount === 1 && header.plaintextSize === 0

  const stream = new Readable({
    read(this: Readable) {
      if (fdClosed) {
        this.push(null)
        return
      }

      if (isEmpty) {
        this.push(Buffer.alloc(0))
        this.push(null)
        closeFd()
        return
      }

      if (currentChunk >= header.chunkCount) {
        this.push(null)
        closeFd()
        return
      }

      try {
        const ctLen = chunkCipherLen(header, currentChunk)
        const readSize = NONCE_SIZE + TAG_SIZE + ctLen
        const fileOffset = chunkOffsets[currentChunk]

        const bytesRead = fs.readSync(fd, readBuf, 0, readSize, fileOffset)
        if (bytesRead !== readSize) {
          closeFd()
          this.destroy(new Error(
            `Truncated encrypted file: expected ${readSize} bytes for chunk ${currentChunk}, got ${bytesRead}`,
          ))
          return
        }

        const chunkNonce = readBuf.subarray(0, NONCE_SIZE)
        const chunkTag = readBuf.subarray(NONCE_SIZE, NONCE_SIZE + TAG_SIZE)
        const ciphertext = readBuf.subarray(NONCE_SIZE + TAG_SIZE, NONCE_SIZE + TAG_SIZE + ctLen)

        // Verify nonce
        const expectedNonce = buildChunkNonce(objectKeys.noncePrefix, currentChunk)
        if (!chunkNonce.equals(expectedNonce)) {
          closeFd()
          this.destroy(new Error(
            `Chunk ${currentChunk} nonce mismatch: file may be corrupted`,
          ))
          return
        }

        // Build AAD and decrypt
        const aad = buildChunkAad({
          formatVersion: header.formatVersion,
          keyId: header.keyId,
          rawSha256: header.rawSha256,
          chunkIndex: currentChunk,
          plaintextChunkLength: ctLen,
          totalChunkCount: header.chunkCount,
        })

        const decipher = createDecipheriv(ALGORITHM, fileKey, chunkNonce)
        decipher.setAAD(aad)
        decipher.setAuthTag(chunkTag)

        try {
          const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
          currentChunk++
          this.push(plaintext)
        } catch (err) {
          closeFd()
          this.destroy(new Error(
            `Decryption failed for chunk ${currentChunk}: ${err instanceof Error ? err.message : ''}`,
          ))
        }
      } catch (err) {
        closeFd()
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })

  // Close fd when stream is destroyed (e.g. client disconnect)
  stream.on('close', () => {
    closeFd()
  })

  function closeFd() {
    if (!fdClosed) {
      fdClosed = true
      try { fs.closeSync(fd) } catch { /* already closed */ }
    }
  }

  return {
    stream,
    mimeType: header.mimeType,
    originalSize: header.plaintextSize,
    keyId: header.keyId,
    contentLength: header.plaintextSize,
  }
}

/**
 * Decrypt a byte range from an encrypted file on disk.
 * Only reads and decrypts the chunks that overlap the requested range.
 *
 * @param filePath - Path to the .enc file on disk
 * @param masterKey - 32-byte master key Buffer (not hex)
 * @param range - { start, end } byte range in plaintext space
 */
export async function decryptRangeFromFile(
  filePath: string,
  masterKey: Buffer,
  range: { start: number; end: number },
): Promise<RangeDecryptResult> {
  // Read header
  const probeSize = 11
  const probe = Buffer.alloc(probeSize)
  const fd = fs.openSync(filePath, 'r')
  try {
    const probeRead = fs.readSync(fd, probe, 0, probeSize, 0)
    if (probeRead < probeSize) {
      throw new Error(`File too small to read MVLT header length`)
    }
    const headerLength = probe.readUInt32BE(7)
    if (headerLength < 130 || headerLength > 10000) {
      throw new Error(`Invalid header length: ${headerLength}`)
    }
    const headerBuf = Buffer.alloc(headerLength)
    fs.readSync(fd, headerBuf, 0, headerLength, 0)

    const { header, objectKeys } = parseAndVerifyHeader(headerBuf, masterKey)
    const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, header.keyId)

    // Clamp range
    const start = Math.max(0, Math.min(range.start, header.plaintextSize))
    const end = Math.min(range.end, header.plaintextSize)
    if (start >= end) {
      return {
        data: Buffer.alloc(0),
        mimeType: header.mimeType,
        totalSize: header.plaintextSize,
        keyId: header.keyId,
      }
    }

    // Determine overlapping chunks
    const firstChunk = Math.floor(start / header.chunkSize)
    const lastChunk = Math.min(Math.floor((end - 1) / header.chunkSize), header.chunkCount - 1)

    const resultBuffers: Buffer[] = []

    for (let ci = firstChunk; ci <= lastChunk; ci++) {
      const chunkPlaintext = decryptChunkFromFd(fd, ci, fileKey, header, objectKeys)
      const chunkStart = ci * header.chunkSize
      const chunkEnd = Math.min(chunkStart + header.chunkSize, header.plaintextSize)

      // Extract the overlapping portion
      const overlapStart = Math.max(start, chunkStart) - chunkStart
      const overlapEnd = Math.min(end, chunkEnd) - chunkStart
      resultBuffers.push(chunkPlaintext.subarray(overlapStart, overlapEnd))
    }

    return {
      data: Buffer.concat(resultBuffers),
      mimeType: header.mimeType,
      totalSize: header.plaintextSize,
      keyId: header.keyId,
    }
  } finally {
    fs.closeSync(fd)
  }
}
