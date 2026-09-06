/**
 * MediVault Crypto — MVLT v3 File Header
 *
 * Binary format (all multi-byte integers are BIG-ENDIAN):
 *
 * HEADER (authenticated with per-object random headerNonce):
 *   [4B]  Magic: "MVLT" (0x4D564C54)
 *   [2B]  Format version (uint16 BE): 3
 *   [1B]  Algorithm ID: 0x01 = AES-256-GCM
 *   [4B]  Header length (uint32 BE): total header bytes including tag
 *   [1B]  Key ID length K (uint8)
 *   [KB]  Key ID (UTF-8, non-secret version identifier)
 *   [32B] Object salt (random per encryption)
 *   [12B] Header nonce (random per encryption)
 *   [8B]  Nonce prefix (random per encryption)
 *   [8B]  Plaintext size (uint64 BE)
 *   [2B]  MIME type length M (uint16 BE)
 *   [MB]  MIME type (UTF-8)
 *   [4B]  Chunk size in bytes (uint32 BE)
 *   [4B]  Chunk count (uint32 BE)
 *   [32B] Raw SHA-256 of plaintext (32 raw bytes, NOT hex)
 *   [16B] Header auth tag (AES-256-GCM tag)
 *
 * Total header size: 130 + K + M bytes
 *   = 4+2+1+4+1+K+32+12+8+8+2+M+4+4+32+16
 *   = 130 + K + M
 *
 * HEADER AUTHENTICATION:
 *   headerAuthKey = HKDF-SHA256(masterKey, salt=objectSalt, info="MVLT-HEADER-KEY" || keyId, 32)
 *   Uses random headerNonce (12 bytes, stored in header)
 *   AAD = all header bytes EXCLUDING the final 16-byte auth tag
 *   Plaintext = zero-length (tag-only authentication)
 *
 * CHUNKS (each independently authenticated with AAD):
 *   For each chunk i = 0..chunkCount-1:
 *     [12B] Chunk nonce = noncePrefix || uint32BE(i)
 *     [16B] Chunk auth tag (AES-256-GCM, AAD includes metadata)
 *     [?B]  Chunk ciphertext (last chunk may be smaller than chunkSize)
 */

import {
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import {
  MAGIC,
  FORMAT_VERSION,
  ALGORITHM_ID_AES256GCM,
  HEADER_TAG_SIZE,
  OBJECT_SALT_SIZE,
  NONCE_PREFIX_SIZE,
  HEADER_NONCE_SIZE,
  RAW_SHA256_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
} from './constants.js'
import { deriveHeaderAuthKey } from './key-management.js'
import type { MvltHeader, ObjectKeys } from './types'

/**
 * Compute the byte size of a serialized header (including the 16-byte auth tag).
 * Format: 130 + K + M bytes
 */
export function headerByteLength(keyId: string, mimeType: string): number {
  const K = Buffer.byteLength(keyId, 'utf-8')
  const M = Buffer.byteLength(mimeType, 'utf-8')
  return 130 + K + M
}

/**
 * Build and serialize a complete MVLT v3 header (including auth tag).
 *
 * @param params - Header fields
 * @param objectKeys - Per-object random cryptographic material
 * @param masterKey - 32-byte master key
 * @returns Complete header buffer (130 + K + M bytes)
 */
export function buildAndSerializeHeader(
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
  masterKey: Buffer,
): Buffer {
  const keyIdBuf = Buffer.from(params.keyId, 'utf-8')
  const mimeBuf = Buffer.from(params.mimeType, 'utf-8')

  if (params.rawSha256.length !== RAW_SHA256_SIZE) {
    throw new Error(`Raw SHA-256 must be 32 bytes, got ${params.rawSha256.length}`)
  }

  // Pre-tag: 114 + K + M
  const preTagLen = 114 + keyIdBuf.length + mimeBuf.length
  const preTag = Buffer.alloc(preTagLen)
  let offset = 0

  MAGIC.copy(preTag, offset); offset += 4
  preTag.writeUInt16BE(FORMAT_VERSION, offset); offset += 2
  preTag.writeUInt8(ALGORITHM_ID_AES256GCM, offset); offset += 1
  // Placeholder for header length — filled below
  const headerLengthOffset = offset; offset += 4
  preTag.writeUInt8(keyIdBuf.length, offset); offset += 1
  keyIdBuf.copy(preTag, offset); offset += keyIdBuf.length
  objectKeys.objectSalt.copy(preTag, offset); offset += OBJECT_SALT_SIZE
  objectKeys.headerNonce.copy(preTag, offset); offset += HEADER_NONCE_SIZE
  objectKeys.noncePrefix.copy(preTag, offset); offset += NONCE_PREFIX_SIZE
  preTag.writeBigUInt64BE(BigInt(params.plaintextSize), offset); offset += 8
  preTag.writeUInt16BE(mimeBuf.length, offset); offset += 2
  mimeBuf.copy(preTag, offset); offset += mimeBuf.length
  preTag.writeUInt32BE(params.chunkSize, offset); offset += 4
  preTag.writeUInt32BE(params.chunkCount, offset); offset += 4
  params.rawSha256.copy(preTag, offset); offset += RAW_SHA256_SIZE

  const totalHeaderLen = preTagLen + HEADER_TAG_SIZE
  // Write header length back into the preTag buffer
  preTag.writeUInt32BE(totalHeaderLen, headerLengthOffset)

  // Compute header auth tag
  const headerAuthKey = deriveHeaderAuthKey(masterKey, objectKeys.objectSalt, params.keyId)
  const cipher = createCipheriv('aes-256-gcm', headerAuthKey, objectKeys.headerNonce)
  cipher.setAAD(preTag)
  cipher.update(Buffer.alloc(0))
  cipher.final()
  const headerTag = cipher.getAuthTag()

  return Buffer.concat([preTag, headerTag])
}

/**
 * Parse a complete MVLT v3 header from a buffer, verifying the auth tag.
 *
 * The function extracts objectSalt and headerNonce from the buffer first,
 * then derives the header auth key, then verifies the tag.
 *
 * @param buffer - Buffer containing at least the full header
 * @param masterKey - 32-byte master key
 * @returns Parsed header and ObjectKeys
 */
export function parseAndVerifyHeader(
  buffer: Buffer,
  masterKey: Buffer,
): { header: MvltHeader; objectKeys: ObjectKeys; dataOffset: number } {
  // Minimum header: 130 bytes (K=0, M=0)
  if (buffer.length < 130) {
    throw new Error(`Buffer too small for MVLT v3 header: got ${buffer.length} bytes, need at least 130`)
  }

  // Verify magic
  const magicBuf = buffer.subarray(0, 4)
  if (!magicBuf.equals(MAGIC)) {
    throw new Error(`Invalid file magic: expected 'MVLT' (4D564C54), got ${magicBuf.toString('hex')}`)
  }

  // Verify format version
  const formatVersion = buffer.readUInt16BE(4)
  if (formatVersion !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported format version: ${formatVersion}. Only version ${FORMAT_VERSION} is supported.`,
    )
  }

  // Verify algorithm ID
  const algorithmId = buffer.readUInt8(6)
  if (algorithmId !== ALGORITHM_ID_AES256GCM) {
    throw new Error(
      `Unsupported algorithm ID: 0x${algorithmId.toString(16)}. Only 0x01 (AES-256-GCM) is supported.`,
    )
  }

  // Read header length
  const headerLength = buffer.readUInt32BE(7)

  if (buffer.length < headerLength) {
    throw new Error(
      `Buffer too small for complete MVLT v3 header: need ${headerLength} bytes, got ${buffer.length}`,
    )
  }

  // Read variable lengths and fields
  let off = 11
  const keyIdLen = buffer.readUInt8(off); off += 1
  const keyId = buffer.subarray(off, off + keyIdLen).toString('utf-8'); off += keyIdLen
  const objectSalt = Buffer.from(buffer.subarray(off, off + OBJECT_SALT_SIZE)); off += OBJECT_SALT_SIZE
  const headerNonce = Buffer.from(buffer.subarray(off, off + HEADER_NONCE_SIZE)); off += HEADER_NONCE_SIZE
  const noncePrefix = Buffer.from(buffer.subarray(off, off + NONCE_PREFIX_SIZE)); off += NONCE_PREFIX_SIZE
  const plaintextSize = Number(buffer.readBigUInt64BE(off)); off += 8
  const mimeLen = buffer.readUInt16BE(off); off += 2
  const mimeType = buffer.subarray(off, off + mimeLen).toString('utf-8'); off += mimeLen
  const chunkSize = buffer.readUInt32BE(off); off += 4
  const chunkCount = buffer.readUInt32BE(off); off += 4
  const rawSha256 = Buffer.from(buffer.subarray(off, off + RAW_SHA256_SIZE)); off += RAW_SHA256_SIZE

  // Derive header auth key using objectSalt from the header itself
  const headerAuthKey = deriveHeaderAuthKey(masterKey, objectSalt, keyId)

  // Verify header auth tag
  const preTag = buffer.subarray(0, headerLength - HEADER_TAG_SIZE)
  const tag = buffer.subarray(headerLength - HEADER_TAG_SIZE, headerLength)

  const decipher = createDecipheriv('aes-256-gcm', headerAuthKey, headerNonce)
  decipher.setAAD(preTag)
  decipher.setAuthTag(tag)
  try {
    decipher.update(Buffer.alloc(0))
    decipher.final()
  } catch (err) {
    throw new Error(
      `Header authentication failed: tag mismatch or corrupted header. ${err instanceof Error ? err.message : ''}`,
    )
  }

  const sha256 = rawSha256.toString('hex')

  const header: MvltHeader = {
    magic: Buffer.from(MAGIC),
    formatVersion,
    algorithmId,
    headerLength,
    keyId,
    objectSalt,
    headerNonce,
    noncePrefix,
    plaintextSize,
    mimeType,
    chunkSize,
    chunkCount,
    sha256,
    rawSha256,
    headerTag: Buffer.from(tag),
    dataOffset: headerLength,
  }

  // Semantic validation — reject malformed headers before any memory allocation or seeking
  validateHeaderSemantics(header)

  return {
    header,
    objectKeys: { objectSalt, noncePrefix, headerNonce },
    dataOffset: headerLength,
  }
}

/**
 * Validate semantic consistency of a parsed MVLT v3 header.
 *
 * Called after auth tag verification succeeds, before the header is returned
 * to the caller. Rejects malformed headers that would cause division-by-zero,
 * integer overflow, or inconsistent range calculations downstream.
 *
 * @throws Error if any semantic invariant is violated
 */
function validateHeaderSemantics(header: MvltHeader): void {
  // Zero chunk size is invalid (would cause division by zero in range calculations)
  if (header.chunkSize === 0) {
    throw new Error('Invalid header: chunk size is zero')
  }

  // Chunk size must be within allowed bounds (64 KiB to 4 MiB)
  if (header.chunkSize < MIN_CHUNK_SIZE || header.chunkSize > MAX_CHUNK_SIZE) {
    throw new Error(`Invalid header: chunk size ${header.chunkSize} outside allowed range [${MIN_CHUNK_SIZE}, ${MAX_CHUNK_SIZE}]`)
  }

  // Chunk count must be consistent with plaintext size
  // (skip if chunkSize * chunkCount would overflow — the overflow check below catches it)
  const productOverflow = header.chunkSize * header.chunkCount > Number.MAX_SAFE_INTEGER
  if (!productOverflow) {
    if (header.plaintextSize > 0) {
      const expectedChunks = Math.ceil(header.plaintextSize / header.chunkSize)
      if (header.chunkCount !== expectedChunks) {
        throw new Error(
          `Invalid header: chunk count ${header.chunkCount} inconsistent with plaintext size ${header.plaintextSize} and chunk size ${header.chunkSize} (expected ${expectedChunks})`
        )
      }
    } else {
      // Zero-length file must have exactly 1 chunk (empty chunk)
      if (header.chunkCount !== 1) {
        throw new Error(`Invalid header: zero-length file must have chunk count 1, got ${header.chunkCount}`)
      }
    }
  }

  // Integer overflow: chunkSize * chunkCount should not exceed 2^53
  // (safe integer range in JavaScript). Check BEFORE plaintext size limit
  // because a large chunkCount with a valid chunkSize could overflow even
  // if plaintextSize appears reasonable after BigInt→Number conversion.
  const estimatedMaxSize = header.chunkSize * header.chunkCount
  if (estimatedMaxSize > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Invalid header: chunkSize * chunkCount (${header.chunkSize} * ${header.chunkCount}) exceeds safe integer range`
    )
  }

  // Plaintext size declared in header must not be excessively large
  // Max 10 TiB to prevent integer issues
  const MAX_PLAINTEXT_SIZE = BigInt(10) * BigInt(1024) * BigInt(1024) * BigInt(1024) * BigInt(1024)
  if (BigInt(header.plaintextSize) > MAX_PLAINTEXT_SIZE) {
    throw new Error(`Invalid header: declared plaintext size ${header.plaintextSize} exceeds maximum`)
  }

  // MIME type length must be reasonable (max 500 chars)
  if (header.mimeType.length > 500) {
    throw new Error(`Invalid header: MIME type length ${header.mimeType.length} exceeds maximum`)
  }

  // Key ID length must be reasonable (max 100 chars)
  if (header.keyId.length > 100) {
    throw new Error(`Invalid header: key ID length ${header.keyId.length} exceeds maximum`)
  }

  // Header length arithmetic must be consistent
  // Expected: 130 + keyIdLen + mimeLen
  const expectedHeaderLength = 130 + Buffer.byteLength(header.keyId, 'utf-8') + Buffer.byteLength(header.mimeType, 'utf-8')
  if (header.headerLength !== expectedHeaderLength) {
    throw new Error(
      `Invalid header: declared length ${header.headerLength} does not match expected ${expectedHeaderLength} (keyId=${header.keyId.length}, mime=${header.mimeType.length})`
    )
  }

  // dataOffset must equal headerLength
  if (header.dataOffset !== header.headerLength) {
    throw new Error(
      `Invalid header: dataOffset ${header.dataOffset} does not equal headerLength ${header.headerLength}`
    )
  }
}

/**
 * Parse header without authentication verification.
 * For inspection/debugging only.
 */
export function parseHeaderUnverified(buffer: Buffer): { header: MvltHeader; objectKeys: ObjectKeys; dataOffset: number } {
  if (buffer.length < 130) {
    throw new Error(`Buffer too small for MVLT v3 header: got ${buffer.length} bytes`)
  }

  const magicBuf = buffer.subarray(0, 4)
  const formatVersion = buffer.readUInt16BE(4)
  const algorithmId = buffer.readUInt8(6)
  const headerLength = buffer.readUInt32BE(7)

  if (buffer.length < headerLength) {
    throw new Error(`Buffer too small for complete MVLT v3 header`)
  }

  let off = 11
  const keyIdLen = buffer.readUInt8(off); off += 1
  const keyId = buffer.subarray(off, off + keyIdLen).toString('utf-8'); off += keyIdLen
  const objectSalt = Buffer.from(buffer.subarray(off, off + OBJECT_SALT_SIZE)); off += OBJECT_SALT_SIZE
  const headerNonce = Buffer.from(buffer.subarray(off, off + HEADER_NONCE_SIZE)); off += HEADER_NONCE_SIZE
  const noncePrefix = Buffer.from(buffer.subarray(off, off + NONCE_PREFIX_SIZE)); off += NONCE_PREFIX_SIZE
  const plaintextSize = Number(buffer.readBigUInt64BE(off)); off += 8
  const mimeLen = buffer.readUInt16BE(off); off += 2
  const mimeType = buffer.subarray(off, off + mimeLen).toString('utf-8'); off += mimeLen
  const chunkSize = buffer.readUInt32BE(off); off += 4
  const chunkCount = buffer.readUInt32BE(off); off += 4
  const rawSha256 = Buffer.from(buffer.subarray(off, off + RAW_SHA256_SIZE)); off += RAW_SHA256_SIZE

  const tag = buffer.subarray(headerLength - HEADER_TAG_SIZE, headerLength)

  const header: MvltHeader = {
    magic: magicBuf,
    formatVersion,
    algorithmId,
    headerLength,
    keyId,
    objectSalt,
    headerNonce,
    noncePrefix,
    plaintextSize,
    mimeType,
    chunkSize,
    chunkCount,
    sha256: rawSha256.toString('hex'),
    rawSha256,
    headerTag: Buffer.from(tag),
    dataOffset: headerLength,
  }

  return {
    header,
    objectKeys: { objectSalt, noncePrefix, headerNonce },
    dataOffset: headerLength,
  }
}

