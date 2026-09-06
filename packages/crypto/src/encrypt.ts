/*
 * MediVault Crypto — AES-256-GCM Chunked Encryption (MVLT v3)
 *
 * Encrypts plaintext into the MVLT v3 binary format:
 * 1. Generate random objectKeys (objectSalt, noncePrefix, headerNonce)
 * 2. Compute SHA-256 of plaintext (raw 32B + hex for return)
 * 3. Derive fileKey via HKDF with objectSalt
 * 4. Build authenticated header with all new fields
 * 5. For each chunk: buildChunkNonce(noncePrefix, i), build chunk AAD, encrypt with AAD
 *
 * For large files, use encryptSingleChunk() + storage-service orchestration.
 * The buffer-based encrypt() is suitable for files up to a few hundred MB.
 */

import { createCipheriv, createHash } from 'node:crypto'
import { Writable } from 'node:stream'

import {
  ALGORITHM,
  NONCE_SIZE,
  TAG_SIZE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_KEY_ID,
  FORMAT_VERSION,
} from './constants.js'
import { buildAndSerializeHeader, parseHeaderUnverified } from './header.js'
import { deriveFileKey, generateObjectKeys, buildChunkNonce, parseMasterKeyHex } from './key-management.js'
import { computeHashBufferRaw } from './hash.js'
import type { EncryptResult, MvltHeader, ObjectKeys, ChunkAadParams } from './types'

/**
 * Build the AAD buffer for a chunk.
 * Format:
 *   [2B]  formatVersion (uint16 BE)
 *   [1B]  keyId length
 *   [KB]  keyId (UTF-8)
 *   [32B] rawSha256
 *   [4B]  chunkIndex (uint32 BE)
 *   [4B]  plaintextChunkLength (uint32 BE)
 *   [4B]  totalChunkCount (uint32 BE)
 */
export function buildChunkAad(params: ChunkAadParams): Buffer {
  const keyIdBuf = Buffer.from(params.keyId, 'utf-8')
  const aadLen = 2 + 1 + keyIdBuf.length + 32 + 4 + 4 + 4
  const aad = Buffer.alloc(aadLen)
  let off = 0

  aad.writeUInt16BE(params.formatVersion, off); off += 2
  aad.writeUInt8(keyIdBuf.length, off); off += 1
  keyIdBuf.copy(aad, off); off += keyIdBuf.length
  params.rawSha256.copy(aad, off); off += 32
  aad.writeUInt32BE(params.chunkIndex, off); off += 4
  aad.writeUInt32BE(params.plaintextChunkLength, off); off += 4
  aad.writeUInt32BE(params.totalChunkCount, off); off += 4

  return aad
}

/**
 * Encrypt a single plaintext chunk with AAD.
 * Returns: nonce (12B) + authTag (16B) + ciphertext
 *
 * @param chunkPlaintext - Plaintext bytes for this chunk
 * @param fileKey - 32-byte per-object derived key
 * @param noncePrefix - 8-byte per-object nonce prefix
 * @param chunkIndex - 0-based chunk index
 * @param aad - AAD buffer for this chunk
 * @returns Buffer: nonce + authTag + ciphertext
 */
export function encryptSingleChunk(
  chunkPlaintext: Buffer,
  fileKey: Buffer,
  noncePrefix: Buffer,
  chunkIndex: number,
  aad: Buffer,
): Buffer {
  const nonce = buildChunkNonce(noncePrefix, chunkIndex)
  const cipher = createCipheriv(ALGORITHM, fileKey, nonce)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([
    cipher.update(chunkPlaintext),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([nonce, authTag, ciphertext])
}

/**
 * Encrypt a buffer of plaintext into MVLT v3 format.
 * Returns the complete encrypted buffer (header + all chunks).
 *
 * @param plaintext - The data to encrypt
 * @param masterKeyHex - 64-char hex master key
 * @param mimeType - Original MIME type
 * @param keyId - Non-secret key version identifier
 * @param chunkSize - Chunk size in bytes (default 1 MiB)
 */
export function encrypt(
  plaintext: Buffer,
  masterKeyHex: string,
  mimeType: string,
  keyId: string = DEFAULT_KEY_ID,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): EncryptResult {
  const masterKey = parseMasterKeyHex(masterKeyHex)
  const { sha256, rawSha256, size } = computeHashBufferRaw(plaintext)

  // Generate per-object random values
  const objectKeys = generateObjectKeys()

  // Derive per-object file key
  const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, keyId)

  const totalSize = size
  // Empty file produces 1 zero-length chunk
  const chunkCount = totalSize === 0 ? 1 : Math.ceil(totalSize / chunkSize)

  // Build authenticated header
  const headerBuf = buildAndSerializeHeader(
    { keyId, plaintextSize: totalSize, mimeType, chunkSize, chunkCount, sha256, rawSha256 },
    objectKeys,
    masterKey,
  )

  // Encrypt all chunks
  const chunkBuffers: Buffer[] = [headerBuf]
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalSize)
    const chunkPlaintext = totalSize === 0 ? Buffer.alloc(0) : plaintext.subarray(start, end)
    const plaintextChunkLen = chunkPlaintext.length

    const aad = buildChunkAad({
      formatVersion: FORMAT_VERSION,
      keyId,
      rawSha256,
      chunkIndex: i,
      plaintextChunkLength: plaintextChunkLen,
      totalChunkCount: chunkCount,
    })

    chunkBuffers.push(encryptSingleChunk(chunkPlaintext, fileKey, objectKeys.noncePrefix, i, aad))
  }

  const encryptedData = Buffer.concat(chunkBuffers)
  const { header } = parseHeaderUnverified(headerBuf)

  return { sha256, encryptedData, header, originalSize: totalSize }
}

/**
 * Build just the MVLT v3 header (no chunks).
 * Used by storage-service for streaming writes.
 */
export function buildHeaderOnly(
  masterKeyHex: string,
  params: {
    keyId: string
    plaintextSize: number
    mimeType: string
    chunkSize: number
    chunkCount: number
    sha256: string
    rawSha256: Buffer
  },
  objectKeys: ObjectKeys,
): { headerBuf: Buffer; header: MvltHeader } {
  const masterKey = parseMasterKeyHex(masterKeyHex)
  const headerBuf = buildAndSerializeHeader(params, objectKeys, masterKey)
  const { header } = parseHeaderUnverified(headerBuf)
  return { headerBuf, header }
}

/**
 * Write encrypted chunks from a plaintext buffer to a Writable stream.
 * The header must be written separately before calling this.
 *
 * @param plaintext - Full plaintext data
 * @param fileKey - 32-byte per-object derived key
 * @param noncePrefix - 8-byte per-object nonce prefix
 * @param chunkSize - Chunk size
 * @param outputStream - Writable stream to write encrypted chunks to
 * @param aadParams - Parameters for building chunk AAD (formatVersion, keyId, rawSha256, totalChunkCount)
 */
export async function writeChunksToStream(
  plaintext: Buffer,
  fileKey: Buffer,
  noncePrefix: Buffer,
  chunkSize: number,
  outputStream: Writable,
  aadParams: { formatVersion: number; keyId: string; rawSha256: Buffer; totalChunkCount: number },
): Promise<void> {
  const totalSize = plaintext.length
  const chunkCount = totalSize === 0 ? 1 : Math.ceil(totalSize / chunkSize)

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalSize)
    const chunkPlaintext = totalSize === 0 ? Buffer.alloc(0) : plaintext.subarray(start, end)

    const aad = buildChunkAad({
      formatVersion: aadParams.formatVersion,
      keyId: aadParams.keyId,
      rawSha256: aadParams.rawSha256,
      chunkIndex: i,
      plaintextChunkLength: chunkPlaintext.length,
      totalChunkCount: aadParams.totalChunkCount,
    })

    const encryptedChunk = encryptSingleChunk(chunkPlaintext, fileKey, noncePrefix, i, aad)

    if (!outputStream.write(encryptedChunk)) {
      await new Promise<void>((resolve) => outputStream.once('drain', resolve))
    }
  }
}
