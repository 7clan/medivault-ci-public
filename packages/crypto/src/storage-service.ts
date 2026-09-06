/**
 * MediVault Crypto — Encrypted Storage Service (MVLT v3)
 *
 * Manages content-addressable encrypted file storage on disk.
 * Storage path: {MEDIVAULT_DATA_DIR}/objects/{sha256[0:2]}/{fullSha256}.enc
 *
 * Features:
 * - Content-addressable deduplication via SHA-256
 * - Atomic writes (temp file + rename)
 * - Two-pass streaming encryption for large files (never loads full file into memory)
 * - Range-based decryption for HTTP range requests
 * - Reference-counted physical deletion via StoredObject
 * - Disk space checks
 * - Path traversal protection
 * - MIME type validation
 * - Restrictive file permissions (0600)
 * - Stale temp file cleanup on construction
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash, randomBytes } from 'node:crypto'
import os from 'node:os'

import {
  ALLOWED_MIME_TYPES,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_KEY_ID,
  FORMAT_VERSION,
  PLAINTEXT_READ_CHUNK,
} from './constants.js'
import {
  EncryptedFileNotFoundError,
  StoredObjectIntegrityError,
  UnsupportedMimeTypeError,
} from './errors.js'
import { deriveFileKey, parseMasterKeyHex, generateObjectKeys, KeyRing } from './key-management.js'
import { encrypt, encryptSingleChunk, buildHeaderOnly, buildChunkAad } from './encrypt.js'
import { decrypt, decryptRange, decryptFileToStream, decryptRangeFromFile, parseEncryptedHeader } from './decrypt.js'
import { parseAndVerifyHeader } from './header.js'
import type {
  StoreResult,
  RetrieveResult,
  StorageServiceOptions,
  RangeDecryptResult,
  StreamingDecryptResult,
  MvltHeader,
  MemorySnapshot,
  ObjectKeys,
} from './types'

// Path traversal patterns
const PATH_TRAVERSAL_RE = /\.\./

// Safe filename pattern: only alphanumeric, hyphens, underscores, dots
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/

/** SHA-256 validation regex */
const SHA256_RE = /^[0-9a-f]{64}$/

/** File permission mode for temp and encrypted files */
const FILE_MODE = 0o600

export class EncryptedStorageService {
  private dataDirectory: string
  private keyRing: KeyRing

  constructor(options: StorageServiceOptions & { masterKeyHex?: string; keyRing?: KeyRing }) {
    this.dataDirectory = options.dataDirectory

    if (options.keyRing) {
      this.keyRing = options.keyRing
    } else if (options.masterKeyHex) {
      this.keyRing = new KeyRing()
      this.keyRing.add({ keyId: DEFAULT_KEY_ID, masterKeyHex: options.masterKeyHex })
    } else {
      throw new Error('Either masterKeyHex or keyRing must be provided')
    }

    // Ensure data directory exists
    fs.mkdirSync(path.join(this.dataDirectory, 'objects'), { recursive: true })

    // Clean up stale temp files from previous runs
    this.cleanStaleTempFiles()
  }

  /**
   * Store a file from a Buffer (encrypts and writes to content-addressable path).
   */
  async store(
    data: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<StoreResult> {
    this.validateFileName(fileName)
    this.validateMimeType(mimeType)

    const primaryEntry = this.keyRing.getPrimary()
    const result = encrypt(data, primaryEntry.masterKeyHex, mimeType, primaryEntry.keyId)

    return this.writeEncryptedFile(result.sha256, result.encryptedData, result.header, mimeType)
  }

  /**
   * Store a file from a Readable stream — true two-pass streaming.
   *
   * Phase 1: Stream to restricted temp plaintext file (mode 0600) while hashing
   * Phase 2: Check dedup (hash-based lookup)
   * Phase 3: If dedup: securely delete temp file, return existing metadata
   * Phase 4: If new: generate objectKeys, build header, open temp enc file,
   *          read plaintext in chunks, encrypt each chunk with AAD, write to temp enc file
   * Phase 5: Atomic rename (temp enc → final path with 0600 permissions)
   */
  async storeStream(
    inputStream: Readable,
    fileName: string,
    mimeType: string,
  ): Promise<StoreResult> {
    this.validateFileName(fileName)
    this.validateMimeType(mimeType)

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mvlt-'))
    // Use random temp filenames to avoid predictable names
    const tmpHashFile = path.join(tmpDir, `plain-${randomBytes(8).toString('hex')}.tmp`)
    const tmpEncFile = path.join(tmpDir, `enc-${randomBytes(8).toString('hex')}.tmp`)

    try {
      // Phase 1: Stream to temp file while computing SHA-256
      const { sha256, rawSha256, size } = await this.streamToTempWithHash(inputStream, tmpHashFile)

      // Phase 2: Check for dedup with integrity verification
      const objectPath = this.objectPath(sha256)
      if (fs.existsSync(objectPath)) {
        try {
          this.verifyStoredObject(sha256, sha256, size)
        } catch (err) {
          if (err instanceof StoredObjectIntegrityError) {
            // Corrupted dedup target — quarantine and fall through to re-encrypt
            console.error(`[MediVault] Quarantining corrupted dedup target: ${sha256.substring(0, 16)}...`)
            // File was quarantined inside verifyStoredObject, so re-encrypt
          } else {
            throw err
          }
        }
      }

      // Re-check after possible quarantine
      if (fs.existsSync(objectPath)) {
        // Genuine dedup — proceed
        const stat = fs.statSync(objectPath)
        const primaryEntry = this.keyRing.getPrimary()
        const headerBuf = this.readHeaderFromDisk(objectPath)
        const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)

        // Securely delete temp plaintext file
        await this.secureDeleteFile(tmpHashFile)

        return {
          sha256,
          encryptedPath: this.relativePath(sha256),
          size: stat.size,
          mimeType: header.mimeType,
          header,
          deduplicated: true,
          chunkCount: header.chunkCount,
          chunkSize: header.chunkSize,
        }
      }

      // Phase 3: Check disk space
      this.checkDiskSpace(size)

      // Phase 4: Encrypt — two-pass streaming from temp file
      const primaryEntry = this.keyRing.getPrimary()
      const masterKey = parseMasterKeyHex(primaryEntry.masterKeyHex)
      const keyId = primaryEntry.keyId

      // Generate per-object random values
      const objectKeys = generateObjectKeys()
      const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, keyId)

      // Compute chunk params
      const chunkSize = DEFAULT_CHUNK_SIZE
      const chunkCount = size === 0 ? 1 : Math.ceil(size / chunkSize)

      // Build header
      const { headerBuf, header } = buildHeaderOnly(primaryEntry.masterKeyHex, {
        keyId,
        plaintextSize: size,
        mimeType,
        chunkSize,
        chunkCount,
        sha256,
        rawSha256,
      }, objectKeys)

      // Open temp enc file for writing
      const encFd = fs.openSync(tmpEncFile, 'w')
      try {
        fs.writeSync(encFd, headerBuf)
        fs.fsyncSync(encFd)

        // Read plaintext in chunks, encrypt, write
        const plainFd = fs.openSync(tmpHashFile, 'r')
        const readBuf = Buffer.alloc(PLAINTEXT_READ_CHUNK)
        try {
          for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            let chunkPlaintext: Buffer

            if (size === 0) {
              chunkPlaintext = Buffer.alloc(0)
            } else {
              const toRead = Math.min(PLAINTEXT_READ_CHUNK, size - chunkIndex * chunkSize)
              const bytesRead = fs.readSync(plainFd, readBuf, 0, toRead, null)
              chunkPlaintext = readBuf.subarray(0, bytesRead)
            }

            const aad = buildChunkAad({
              formatVersion: FORMAT_VERSION,
              keyId,
              rawSha256,
              chunkIndex,
              plaintextChunkLength: chunkPlaintext.length,
              totalChunkCount: chunkCount,
            })

            const encryptedChunk = encryptSingleChunk(chunkPlaintext, fileKey, objectKeys.noncePrefix, chunkIndex, aad)
            fs.writeSync(encFd, encryptedChunk)
          }
        } finally {
          fs.closeSync(plainFd)
        }

        fs.fsyncSync(encFd)
      } finally {
        fs.closeSync(encFd)
      }

      // Set restrictive permissions
      await fsp.chmod(tmpEncFile, FILE_MODE)

      // Phase 5: Atomic rename
      const prefix = path.dirname(objectPath)
      fs.mkdirSync(prefix, { recursive: true })
      await fsp.rename(tmpEncFile, objectPath)
      // Set final permissions after rename (rename may reset on some systems)
      await fsp.chmod(objectPath, FILE_MODE)

      // Securely delete temp plaintext
      await this.secureDeleteFile(tmpHashFile)

      const stat = fs.statSync(objectPath)
      return {
        sha256,
        encryptedPath: this.relativePath(sha256),
        size: stat.size,
        mimeType,
        header,
        deduplicated: false,
        chunkCount,
        chunkSize,
      }
    } catch (err) {
      // Clean up temp files on error
      for (const f of [tmpHashFile, tmpEncFile]) {
        try { await this.secureDeleteFile(f) } catch { /* ignore */ }
      }
      throw err
    } finally {
      // Clean up temp directory
      try { await fsp.rmdir(tmpDir) } catch { /* ignore */ }
    }
  }

  /**
   * Retrieve and decrypt a file by SHA-256 hash using genuine streaming.
   * Reads chunks from the file descriptor one at a time — never loads the full file.
   */
  async retrieve(sha256: string): Promise<RetrieveResult> {
    const streaming = await this.retrieveStream(sha256)
    return {
      data: streaming.stream,
      mimeType: streaming.mimeType,
      originalSize: streaming.originalSize,
      keyId: streaming.keyId,
    }
  }

  /**
   * Retrieve and decrypt a file by SHA-256 hash — returns full StreamingDecryptResult.
   * Reads chunks from the file descriptor one at a time via decryptFileToStream().
   */
  async retrieveStream(sha256: string): Promise<StreamingDecryptResult> {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (!fs.existsSync(objectPath)) {
      throw new EncryptedFileNotFoundError(sha256)
    }

    // Read header from disk to resolve the key ID
    const primaryEntry = this.keyRing.getPrimary()
    const headerBuf = this.readHeaderFromDisk(objectPath)
    const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)
    const keyEntry = this.resolveKeyEntry(header.keyId)
    const masterKey = parseMasterKeyHex(keyEntry.masterKeyHex)

    return decryptFileToStream(objectPath, masterKey)
  }

  /**
   * Retrieve a file as a fully-buffered decrypt (loads entire file into memory).
   * Kept for backward compatibility with tests and migration scripts that need a buffer.
   */
  async retrieveBuffer(sha256: string): Promise<RetrieveResult> {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (!fs.existsSync(objectPath)) {
      throw new EncryptedFileNotFoundError(sha256)
    }

    const primaryEntry = this.keyRing.getPrimary()
    const headerBuf = this.readHeaderFromDisk(objectPath)
    const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)
    const keyEntry = this.resolveKeyEntry(header.keyId)

    // Buffer-based decrypt: loads full file into memory
    const encryptedBuf = fs.readFileSync(objectPath)
    const result = decrypt(encryptedBuf, keyEntry.masterKeyHex)

    return {
      data: Readable.from([result.data]),
      mimeType: result.mimeType,
      originalSize: result.originalSize,
      keyId: result.keyId,
    }
  }

  /**
   * Retrieve a byte range from an encrypted file.
   * Uses fd-based range decrypt — only reads needed chunks from disk.
   */
  async retrieveRange(sha256: string, start: number, end: number): Promise<RangeDecryptResult> {
    return this.retrieveRangeStream(sha256, start, end)
  }

  /**
   * Retrieve a byte range from an encrypted file using fd-based streaming.
   * Only reads and decrypts the chunks that overlap the requested range.
   */
  async retrieveRangeStream(sha256: string, start: number, end: number): Promise<RangeDecryptResult> {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (!fs.existsSync(objectPath)) {
      throw new EncryptedFileNotFoundError(sha256)
    }

    const primaryEntry = this.keyRing.getPrimary()
    const headerBuf = this.readHeaderFromDisk(objectPath)
    const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)
    const keyEntry = this.resolveKeyEntry(header.keyId)
    const masterKey = parseMasterKeyHex(keyEntry.masterKeyHex)

    return decryptRangeFromFile(objectPath, masterKey, { start, end })
  }

  /**
   * Parse the header of an encrypted file (without decrypting).
   */
  async getHeader(sha256: string): Promise<MvltHeader> {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (!fs.existsSync(objectPath)) {
      throw new EncryptedFileNotFoundError(sha256)
    }

    const headerBuf = this.readHeaderFromDisk(objectPath)
    const primaryEntry = this.keyRing.getPrimary()
    const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)
    return header
  }

  /**
   * Check if an encrypted file exists by SHA-256.
   */
  exists(sha256: string): boolean {
    return fs.existsSync(this.objectPath(sha256))
  }

  /**
   * Delete the physical encrypted file.
   * Should only be called when no active Document or DocumentVersion references the StoredObject.
   */
  async deletePhysical(sha256: string): Promise<void> {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (fs.existsSync(objectPath)) {
      await fsp.unlink(objectPath)
      // Try to clean up empty prefix directory
      const prefixDir = path.dirname(objectPath)
      try {
        const remaining = await fsp.readdir(prefixDir)
        if (remaining.length === 0) {
          await fsp.rmdir(prefixDir)
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get the absolute path for an object by SHA-256.
   * Path format: {dataDirectory}/objects/{sha256[0:2]}/{sha256}.enc
   */
  objectPath(sha256: string): string {
    const prefix = sha256.substring(0, 2)
    return path.join(this.dataDirectory, 'objects', prefix, `${sha256}.enc`)
  }

  /**
   * Get the relative path for an object by SHA-256 (for database storage).
   * Path format: objects/{sha256[0:2]}/{sha256}.enc
   */
  relativePath(sha256: string): string {
    const prefix = sha256.substring(0, 2)
    return `objects/${prefix}/${sha256}.enc`
  }

  // ─── Validation ────────────────────────────────────

  validateFileName(fileName: string): void {
    if (!fileName || fileName.trim().length === 0) {
      throw new Error('Filename is required')
    }
    if (PATH_TRAVERSAL_RE.test(fileName)) {
      throw new Error(`Path traversal detected in filename: ${fileName}`)
    }
    if (path.isAbsolute(fileName)) {
      throw new Error(`Absolute paths are not allowed in filenames: ${fileName}`)
    }
    if (fileName.includes('/') || fileName.includes('\\')) {
      throw new Error(`Path separators are not allowed in filenames: ${fileName}`)
    }
    if (!SAFE_FILENAME_RE.test(fileName)) {
      throw new Error(`Filename contains invalid characters: ${fileName}`)
    }
  }

  validateMimeType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new UnsupportedMimeTypeError(mimeType, [...ALLOWED_MIME_TYPES])
    }
  }

  validateSha256Hex(sha256: string): void {
    if (!SHA256_RE.test(sha256)) {
      throw new Error(
        `Invalid SHA-256 hash: must be 64 lowercase hex characters, got '${sha256?.substring(0, 20)}...'`,
      )
    }
  }

  // ─── Internal Helpers ──────────────────────────────

  private resolveKeyEntry(keyId: string): { keyId: string; masterKeyHex: string } {
    if (this.keyRing.has(keyId)) {
      return this.keyRing.get(keyId)
    }
    // Fall back to primary key (for files encrypted before key versioning)
    return this.keyRing.getPrimary()
  }

  /**
   * Atomically replace a corrupted encrypted object.
   * Uses separate temp output, verifies the replacement, then atomically renames.
   * Concurrency-safe: does not remove the old file until replacement is verified.
   */
  async replaceCorruptedObject(
    sha256: string,
    inputStream: Readable,
    fileName: string,
    mimeType: string,
  ): Promise<StoreResult> {
    this.validateFileName(fileName)
    this.validateMimeType(mimeType)
    this.validateSha256Hex(sha256)

    const objectPath = this.objectPath(sha256)

    // Use a DIFFERENT temp directory to avoid conflicts with the existing file
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mvlt-replace-'))
    const tmpHashFile = path.join(tmpDir, `plain-${randomBytes(8).toString('hex')}.tmp`)
    const tmpEncFile = path.join(tmpDir, `enc-${randomBytes(8).toString('hex')}.tmp`)

    try {
      // Phase 1: Stream to temp file while hashing
      const { sha256: computedSha, rawSha256, size } = await this.streamToTempWithHash(inputStream, tmpHashFile)

      // Verify computed hash matches expected
      if (computedSha !== sha256) {
        throw new StoredObjectIntegrityError(
          `Hash mismatch during replacement: expected ${sha256.substring(0, 16)}..., got ${computedSha.substring(0, 16)}...`
        )
      }

      // Phase 2: Encrypt to separate temp file
      const primaryEntry = this.keyRing.getPrimary()
      const masterKey = parseMasterKeyHex(primaryEntry.masterKeyHex)
      const keyId = primaryEntry.keyId
      const objectKeys = generateObjectKeys()
      const fileKey = deriveFileKey(masterKey, objectKeys.objectSalt, keyId)
      const chunkSize = DEFAULT_CHUNK_SIZE
      const chunkCount = size === 0 ? 1 : Math.ceil(size / chunkSize)

      const { headerBuf, header } = buildHeaderOnly(primaryEntry.masterKeyHex, {
        keyId, plaintextSize: size, mimeType, chunkSize, chunkCount, sha256, rawSha256,
      }, objectKeys)

      const encFd = fs.openSync(tmpEncFile, 'w')
      try {
        fs.writeSync(encFd, headerBuf)
        fs.fsyncSync(encFd)

        const plainFd = fs.openSync(tmpHashFile, 'r')
        const readBuf = Buffer.alloc(PLAINTEXT_READ_CHUNK)
        try {
          for (let ci = 0; ci < chunkCount; ci++) {
            let chunkPlaintext: Buffer
            if (size === 0) {
              chunkPlaintext = Buffer.alloc(0)
            } else {
              const toRead = Math.min(PLAINTEXT_READ_CHUNK, size - ci * chunkSize)
              const bytesRead = fs.readSync(plainFd, readBuf, 0, toRead, null)
              chunkPlaintext = readBuf.subarray(0, bytesRead)
            }

            const aad = buildChunkAad({
              formatVersion: FORMAT_VERSION, keyId, rawSha256, chunkIndex: ci,
              plaintextChunkLength: chunkPlaintext.length, totalChunkCount: chunkCount,
            })
            const encryptedChunk = encryptSingleChunk(chunkPlaintext, fileKey, objectKeys.noncePrefix, ci, aad)
            fs.writeSync(encFd, encryptedChunk)
          }
        } finally {
          fs.closeSync(plainFd)
        }
        fs.fsyncSync(encFd)
      } finally {
        fs.closeSync(encFd)
      }

      await fsp.chmod(tmpEncFile, FILE_MODE)

      // Phase 3: Verify the replacement file can be parsed and authenticated
      const verifyBuf = Buffer.alloc(11)
      const verifyFd = fs.openSync(tmpEncFile, 'r')
      try {
        fs.readSync(verifyFd, verifyBuf, 0, 11, 0)
        const hLen = verifyBuf.readUInt32BE(7)
        const fullHeader = Buffer.alloc(hLen)
        fs.readSync(verifyFd, fullHeader, 0, hLen, 0)
        // This will throw if the header auth tag is invalid
        parseAndVerifyHeader(fullHeader, masterKey)
      } finally {
        fs.closeSync(verifyFd)
      }

      // Phase 4: Atomic rename (old file, if any, is overwritten atomically)
      const prefix = path.dirname(objectPath)
      fs.mkdirSync(prefix, { recursive: true })
      await fsp.rename(tmpEncFile, objectPath)
      await fsp.chmod(objectPath, FILE_MODE)

      // Phase 5: Cleanup temp plaintext
      await this.secureDeleteFile(tmpHashFile)

      const stat = fs.statSync(objectPath)
      return {
        sha256, encryptedPath: this.relativePath(sha256), size: stat.size,
        mimeType, header, deduplicated: false, chunkCount, chunkSize,
      }
    } catch (err) {
      for (const f of [tmpHashFile, tmpEncFile]) {
        try { await this.secureDeleteFile(f) } catch { /* ignore */ }
      }
      throw err
    } finally {
      try { await fsp.rmdir(tmpDir) } catch { /* ignore */ }
    }
  }

  private async writeEncryptedFile(
    sha256: string,
    encryptedData: Buffer,
    header: MvltHeader,
    mimeType: string,
    deduplicated: boolean = false,
  ): Promise<StoreResult> {
    const objectPath = this.objectPath(sha256)

    // Dedup check with integrity verification
    if (!deduplicated && fs.existsSync(objectPath)) {
      try {
        this.verifyStoredObject(sha256, sha256, header.plaintextSize)
      } catch (err) {
        if (err instanceof StoredObjectIntegrityError) {
          // Corrupted dedup target — quarantine and fall through to re-encrypt
          console.error(`[MediVault] Quarantining corrupted dedup target (buffer): ${sha256.substring(0, 16)}...`)
          // File was quarantined inside verifyStoredObject, so re-encrypt
        } else {
          throw err
        }
      }
    }

    // Re-check after possible quarantine
    if (!deduplicated && fs.existsSync(objectPath)) {
      // Genuine dedup — proceed
      const stat = fs.statSync(objectPath)
      return {
        sha256,
        encryptedPath: this.relativePath(sha256),
        size: stat.size,
        mimeType: header.mimeType,
        header,
        deduplicated: true,
        chunkCount: header.chunkCount,
        chunkSize: header.chunkSize,
      }
    }

    if (!deduplicated) {
      this.checkDiskSpace(header.plaintextSize)
    }

    // Atomic write via temp + rename
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mvlt-enc-'))
    const tmpFile = path.join(tmpDir, `${sha256}.enc.tmp`)

    try {
      await fsp.writeFile(tmpFile, encryptedData, { mode: FILE_MODE })
      const prefix = path.dirname(objectPath)
      fs.mkdirSync(prefix, { recursive: true })
      await fsp.rename(tmpFile, objectPath)
      await fsp.chmod(objectPath, FILE_MODE)
    } catch (err) {
      try { await fsp.unlink(tmpFile) } catch { /* ignore */ }
      throw err
    } finally {
      try { await fsp.rmdir(tmpDir) } catch { /* ignore */ }
    }

    const stat = fs.statSync(objectPath)
    return {
      sha256,
      encryptedPath: this.relativePath(sha256),
      size: stat.size,
      mimeType,
      header,
      deduplicated: false,
      chunkCount: header.chunkCount,
      chunkSize: header.chunkSize,
    }
  }

  /**
   * Stream input to a temp file while computing SHA-256.
   * Memory-bounded: only reads one chunk at a time.
   */
  private async streamToTempWithHash(
    inputStream: Readable,
    tmpFilePath: string,
  ): Promise<{ sha256: string; rawSha256: Buffer; size: number }> {
    const hash = createHash('sha256')
    let totalSize = 0

    // Create temp file with restrictive permissions
    const writeStream = fs.createWriteStream(tmpFilePath, { mode: FILE_MODE })

    return new Promise((resolve, reject) => {
      inputStream.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        totalSize += chunk.length
        writeStream.write(chunk)
      })

      inputStream.on('end', () => {
        writeStream.end()
        writeStream.on('finish', () => {
          const raw = hash.digest()
          resolve({ sha256: raw.toString('hex'), rawSha256: raw, size: totalSize })
        })
        writeStream.on('error', reject)
      })

      inputStream.on('error', reject)
    })
  }

  /**
   * Read the header portion of an encrypted file from disk.
   * Reads enough bytes to cover any reasonable header (up to 500 bytes).
   */
  private readHeaderFromDisk(filePath: string): Buffer {
    // Read enough to cover any header (magic + version + headerLength field at offset 7)
    // The header length is at offset 7 (4B uint32 BE), so read at least 11 bytes first,
    // then read the full header based on the length field.
    const probeSize = 11
    const probe = Buffer.alloc(probeSize)
    const fd = fs.openSync(filePath, 'r')
    try {
      const bytesRead = fs.readSync(fd, probe, 0, probeSize, 0)
      if (bytesRead < probeSize) {
        throw new Error(`File too small to read MVLT header length: ${bytesRead} bytes`)
      }

      // Verify magic
      if (!probe.subarray(0, 4).equals(Buffer.from('MVLT', 'ascii'))) {
        throw new Error('Invalid file magic: not an MVLT file')
      }

      const headerLength = probe.readUInt32BE(7)
      if (headerLength < 130 || headerLength > 10000) {
        throw new Error(`Invalid header length: ${headerLength}`)
      }

      const headerBuf = Buffer.alloc(headerLength)
      fs.readSync(fd, headerBuf, 0, headerLength, 0)
      return headerBuf
    } finally {
      fs.closeSync(fd)
    }
  }

  /**
   * Parse and verify a header buffer, returning both the header and ObjectKeys.
   */
  private parseAndVerifyHeaderFromFile(
    headerBuf: Buffer,
    masterKeyHex: string,
  ): { header: MvltHeader; objectKeys: ObjectKeys } {
    try {
      const masterKey = parseMasterKeyHex(masterKeyHex)
      return parseAndVerifyHeader(headerBuf, masterKey)
    } catch (err) {
      throw new StoredObjectIntegrityError(
        err instanceof Error ? err.message : 'Header parse/verify failed',
      )
    }
  }

  /**
   * Verify the integrity of a stored encrypted object before dedup reuse.
   * Checks: file exists, header auth tag, SHA-256 match, plaintext size match.
   * If any check fails, quarantines the file and throws StoredObjectIntegrityError.
   */
  verifyStoredObject(sha256: string, expectedSha256: string, expectedSize: number): void {
    this.validateSha256Hex(sha256)
    const objectPath = this.objectPath(sha256)

    if (!fs.existsSync(objectPath)) {
      throw new StoredObjectIntegrityError(`Stored object not found: ${sha256.substring(0, 16)}...`)
    }

    const primaryEntry = this.keyRing.getPrimary()
    const headerBuf = this.readHeaderFromDisk(objectPath)
    const { header } = this.parseAndVerifyHeaderFromFile(headerBuf, primaryEntry.masterKeyHex)

    // Compare header's SHA-256 with expected
    if (header.sha256 !== expectedSha256) {
      this.quarantineObject(sha256)
      throw new StoredObjectIntegrityError(
        `SHA-256 mismatch: expected ${expectedSha256.substring(0, 16)}..., got ${header.sha256.substring(0, 16)}...`,
      )
    }

    // Compare plaintext size
    if (header.plaintextSize !== expectedSize) {
      this.quarantineObject(sha256)
      throw new StoredObjectIntegrityError(
        `Plaintext size mismatch: expected ${expectedSize}, got ${header.plaintextSize}`,
      )
    }
  }

  /**
   * Quarantine a corrupted encrypted object by renaming it to .enc.quarantine.
   * If rename fails, attempts to unlink the corrupted file.
   */
  private quarantineObject(sha256: string): void {
    const objectPath = this.objectPath(sha256)
    const quarantinePath = `${objectPath}.quarantine`
    try {
      fs.renameSync(objectPath, quarantinePath)
      console.error(`[MediVault] Quarantined corrupted object: ${sha256.substring(0, 16)}... -> ${quarantinePath}`)
    } catch {
      // Rename failed — try to at least unlink the corrupted file
      console.error(`[MediVault] Quarantine rename failed for ${sha256.substring(0, 16)}..., unlinking instead`)
      try {
        fs.unlinkSync(objectPath)
      } catch {
        // Give up silently — file may already be gone
      }
    }
  }

  /**
   * Best-effort secure file deletion.
   *
   * Does NOT guarantee secure deletion. Overwriting with zeros is a best-effort
   * mitigation only — it does not account for:
   * - Journaling filesystems that may retain data in journal blocks
   * - Copy-on-write filesystems (ZFS, Btrfs, APFS) that may preserve old blocks
   * - SSD wear-leveling that may remap erased blocks
   * - Page cache or OS-level buffers that may retain the data
   * - Full-disk encryption is recommended as a defense-in-depth measure
   *
   * Mitigations applied:
   * - Restricted private temporary directory (mode 0700 via mkdtemp)
   * - Restrictive file permissions (mode 0600) on all temp files
   * - Random temporary filenames (via os.mkdtemp)
   * - Best-effort zero-overwrite before unlink (files < 100 MiB)
   * - Startup cleanup of abandoned temporary files (older than 1 hour)
   */
  private async secureDeleteFile(filePath: string): Promise<void> {
    try {
      const stat = await fsp.stat(filePath)
      const size = stat.size
      if (size > 0 && size < 100 * 1024 * 1024) { // Only overwrite files < 100MB
        const fd = fs.openSync(filePath, 'w')
        try {
          const zeroBuf = Buffer.alloc(Math.min(size, 1024 * 1024))
          let written = 0
          while (written < size) {
            const toWrite = Math.min(zeroBuf.length, size - written)
            fs.writeSync(fd, zeroBuf, 0, toWrite)
            written += toWrite
          }
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
      }
      await fsp.unlink(filePath)
    } catch {
      // File may not exist
    }
  }

  /**
   * Clean up abandoned temporary files from previous runs.
   *
   * Scans the system temp directory for MediVault temp files/directories
   * (prefixed with 'mvlt-') that are older than 1 hour and removes them.
   *
   * Safety: Only targets files with the 'mvlt-' prefix to avoid affecting
   * other applications. The 1-hour age threshold prevents accidental
   * deletion of active temp files from concurrent processes.
   */
  private cleanStaleTempFiles(): void {
    try {
      const entries = fs.readdirSync(os.tmpdir())
      for (const entry of entries) {
        if (entry.startsWith('mvlt-')) {
          const p = path.join(os.tmpdir(), entry)
          try {
            const stat = fs.statSync(p)
            // Only delete temp files older than 1 hour (age-based safety check)
            if (Date.now() - stat.mtimeMs > 3600_000) {
              if (stat.isDirectory()) {
                fs.rmSync(p, { recursive: true, force: true })
              } else {
                fs.unlinkSync(p)
              }
            }
          } catch {
            // Ignore individual cleanup errors — continue to next entry
          }
        }
      }
    } catch {
      // Ignore errors reading the temp directory
    }
  }

  /**
   * Check available disk space.
   */
  checkDiskSpace(plaintextSize: number): void {
    try {
      const fsTyped = fs as unknown as { statfs?: (p: string) => { bavail: number; bsize: number } }
      if (typeof fsTyped.statfs === 'function') {
        const fsInfo = fsTyped.statfs(this.dataDirectory)
        const availableBytes = fsInfo.bavail * fsInfo.bsize
        const requiredBytes = Math.ceil(plaintextSize * 1.5)
        if (availableBytes < requiredBytes) {
          throw new Error(
            `Insufficient disk space: ${availableBytes} bytes available, ${requiredBytes} required`,
          )
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Insufficient disk space')) {
        throw err
      }
    }
  }
}

/**
 * Take a memory measurement snapshot.
 */
export function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage()
  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    externalBytes: mem.external,
  }
}

/**
 * Validate that a SHA-256 hex string is valid (64 lowercase hex chars).
 */
export function validateSha256Hex(sha256: string): boolean {
  return /^[0-9a-f]{64}$/.test(sha256)
}
