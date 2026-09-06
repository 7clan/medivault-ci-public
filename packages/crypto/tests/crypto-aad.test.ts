import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, NONCE_SIZE, TAG_SIZE, encryptSingleChunk, buildChunkAad, buildChunkNonce, generateObjectKeys, deriveFileKey, parseMasterKeyHex, buildHeaderOnly, FORMAT_VERSION, DEFAULT_CHUNK_SIZE, computeHashBufferRaw, DEFAULT_KEY_ID, MIN_CHUNK_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)

// Helper: minimum valid chunk size for semantic validation (64 KiB)
const CS = MIN_CHUNK_SIZE // 65536

describe('crypto-aad', () => {
  function makeEncrypted2Chunks(): { enc: Buffer; original: Buffer; headerLen: number } {
    // Use MIN_CHUNK_SIZE to pass semantic validation
    const chunkSize = CS
    const original = randomBytes(chunkSize + 100) // 2 chunks
    const { encryptedData, header } = encrypt(original, MASTER_KEY, 'application/pdf', 'key-v1', chunkSize)
    return { enc: encryptedData, original, headerLen: header.headerLength }
  }

  it('rejects swapped chunks', () => {
    const { enc, headerLen } = makeEncrypted2Chunks()
    const tampered = Buffer.from(enc)
    const chunk0Len = NONCE_SIZE + TAG_SIZE + CS
    const chunk1CipherLen = tampered.length - headerLen - chunk0Len
    const chunk1Total = NONCE_SIZE + TAG_SIZE + chunk1CipherLen

    // Swap the two chunks (nonce+tag+ciphertext blocks)
    const chunk0Copy = Buffer.from(tampered.subarray(headerLen, headerLen + chunk0Len))
    const chunk1Copy = Buffer.from(tampered.subarray(headerLen + chunk0Len, headerLen + chunk0Len + chunk1Total))
    chunk1Copy.copy(tampered, headerLen)
    chunk0Copy.copy(tampered, headerLen + chunk0Len)

    expect(() => decrypt(tampered, MASTER_KEY)).toThrow()
  })

  it('rejects duplicated chunk', () => {
    const { enc, headerLen } = makeEncrypted2Chunks()
    const tampered = Buffer.from(enc)
    const chunk0Len = NONCE_SIZE + TAG_SIZE + CS

    // Copy chunk 0 over chunk 1
    const chunk0 = tampered.subarray(headerLen, headerLen + chunk0Len)
    chunk0.copy(tampered, headerLen + chunk0Len)

    // Truncate to correct size
    const chunk1CipherLen = (tampered.length - headerLen - chunk0Len) - (NONCE_SIZE + TAG_SIZE)
    const finalLen = headerLen + chunk0Len + NONCE_SIZE + TAG_SIZE + chunk1CipherLen
    const trimmed = tampered.subarray(0, finalLen)

    expect(() => decrypt(trimmed, MASTER_KEY)).toThrow()
  })

  it('rejects removed chunk', () => {
    const { enc, headerLen } = makeEncrypted2Chunks()
    // Truncate the last chunk entirely - keep only header + first chunk
    const chunk0Len = NONCE_SIZE + TAG_SIZE + CS
    const truncated = enc.subarray(0, headerLen + chunk0Len)
    expect(() => decrypt(truncated, MASTER_KEY)).toThrow(/missing|truncated/i)
  })

  it('rejects chunk from another file', () => {
    const originalA = randomBytes(CS + 100)
    const originalB = randomBytes(CS + 100)
    const encA = encrypt(originalA, MASTER_KEY, 'application/pdf', 'key-v1', CS).encryptedData
    const encB = encrypt(originalB, MASTER_KEY, 'application/pdf', 'key-v1', CS).encryptedData

    const headerLenA = encA.readUInt32BE(7)
    const headerLenB = encB.readUInt32BE(7)

    // Replace chunk 1 of file A with chunk 1 of file B
    const chunk0Len = NONCE_SIZE + TAG_SIZE + CS
    const chunk1CipherLenA = encA.length - headerLenA - chunk0Len
    const chunk1TotalA = NONCE_SIZE + TAG_SIZE + chunk1CipherLenA

    const chunk1CipherLenB = encB.length - headerLenB - chunk0Len
    const chunk1TotalB = NONCE_SIZE + TAG_SIZE + chunk1CipherLenB

    const tampered = Buffer.from(encA)
    const bChunk1 = encB.subarray(headerLenB + chunk0Len, headerLenB + chunk0Len + chunk1TotalB)
    bChunk1.copy(tampered, headerLenA + chunk0Len)

    expect(() => decrypt(tampered, MASTER_KEY)).toThrow()
  })

  it('rejects modified chunk index in AAD', () => {
    // Build an encrypted buffer manually with wrong chunkIndex in AAD for chunk 0
    const masterKey = parseMasterKeyHex(MASTER_KEY)
    const objectKeys = generateObjectKeys()
    const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, DEFAULT_KEY_ID)
    const plaintext = randomBytes(CS)
    const { sha256, rawSha256, size } = computeHashBufferRaw(plaintext)
    const chunkSize = CS
    const chunkCount = 1

    const { headerBuf, header } = buildHeaderOnly(MASTER_KEY, {
      keyId: DEFAULT_KEY_ID, plaintextSize: size, mimeType: 'application/pdf',
      chunkSize, chunkCount, sha256, rawSha256,
    }, objectKeys)

    // Build chunk 0 with WRONG chunkIndex in AAD (say chunkIndex=5 instead of 0)
    const wrongAad = buildChunkAad({
      formatVersion: FORMAT_VERSION, keyId: DEFAULT_KEY_ID, rawSha256,
      chunkIndex: 5, // WRONG - should be 0
      plaintextChunkLength: plaintext.length, totalChunkCount: chunkCount,
    })
    const encChunk = encryptSingleChunk(plaintext, fileKey, objectKeys.noncePrefix, 0, wrongAad)

    const fullEnc = Buffer.concat([headerBuf, encChunk])
    expect(() => decrypt(fullEnc, MASTER_KEY)).toThrow()
  })

  it('rejects modified chunk length in AAD', () => {
    const masterKey = parseMasterKeyHex(MASTER_KEY)
    const objectKeys = generateObjectKeys()
    const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, DEFAULT_KEY_ID)
    const plaintext = randomBytes(CS)
    const { sha256, rawSha256, size } = computeHashBufferRaw(plaintext)
    const chunkSize = CS
    const chunkCount = 1

    const { headerBuf } = buildHeaderOnly(MASTER_KEY, {
      keyId: DEFAULT_KEY_ID, plaintextSize: size, mimeType: 'application/pdf',
      chunkSize, chunkCount, sha256, rawSha256,
    }, objectKeys)

    // Build with wrong plaintextChunkLength in AAD
    const wrongAad = buildChunkAad({
      formatVersion: FORMAT_VERSION, keyId: DEFAULT_KEY_ID, rawSha256,
      chunkIndex: 0,
      plaintextChunkLength: 999, // WRONG
      totalChunkCount: chunkCount,
    })
    const encChunk = encryptSingleChunk(plaintext, fileKey, objectKeys.noncePrefix, 0, wrongAad)

    const fullEnc = Buffer.concat([headerBuf, encChunk])
    expect(() => decrypt(fullEnc, MASTER_KEY)).toThrow()
  })

  it('rejects truncated final chunk', () => {
    const original = randomBytes(CS + 100)
    const enc = encrypt(original, MASTER_KEY, 'application/pdf', 'key-v1', CS).encryptedData
    // Truncate the last chunk's ciphertext by 1 byte
    const truncated = enc.subarray(0, enc.length - 1)
    expect(() => decrypt(truncated, MASTER_KEY)).toThrow()
  })
})
