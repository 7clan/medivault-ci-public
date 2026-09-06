/**
 * MediVault Crypto — TypeScript Interfaces (MVLT Format Version 3)
 */
import type { Readable } from 'node:stream'

/** Per-object random cryptographic material */
export interface ObjectKeys {
  /** 32 random bytes — used as HKDF salt for file key and header key derivation */
  objectSalt: Buffer
  /** 8 random bytes — prefix for all chunk nonces in this object */
  noncePrefix: Buffer
  /** 12 random bytes — nonce for header AES-GCM authentication */
  headerNonce: Buffer
}

/** Parameters for building chunk AAD */
export interface ChunkAadParams {
  formatVersion: number
  keyId: string
  rawSha256: Buffer
  chunkIndex: number
  plaintextChunkLength: number
  totalChunkCount: number
}

/** Parsed MVLT v3 file header */
export interface MvltHeader {
  /** Magic bytes: 'MVLT' */
  magic: Buffer
  /** Format version (must be 3) */
  formatVersion: number
  /** Algorithm identifier (0x01 = AES-256-GCM) */
  algorithmId: number
  /** Total header bytes including auth tag */
  headerLength: number
  /** Non-secret key version identifier (e.g. 'key-v1') */
  keyId: string
  /** 32 raw bytes — per-object HKDF salt */
  objectSalt: Buffer
  /** 12 raw bytes — random header auth nonce */
  headerNonce: Buffer
  /** 8 raw bytes — random nonce prefix for chunk nonces */
  noncePrefix: Buffer
  /** Size of the original plaintext in bytes */
  plaintextSize: number
  /** Original MIME type */
  mimeType: string
  /** Chunk size in bytes (e.g. 1048576) */
  chunkSize: number
  /** Total number of encrypted chunks */
  chunkCount: number
  /** SHA-256 hex hash of the original plaintext (64 hex chars, for DB compat) */
  sha256: string
  /** 32 raw bytes — SHA-256 digest of plaintext (for crypto operations) */
  rawSha256: Buffer
  /** 16-byte header authentication tag */
  headerTag: Buffer
  /** Total byte offset where first chunk begins */
  dataOffset: number
}

/** Parsed chunk from encrypted file */
export interface EncryptedChunk {
  /** 0-based chunk index */
  index: number
  /** 12-byte nonce for this chunk */
  nonce: Buffer
  /** 16-byte authentication tag */
  authTag: Buffer
  /** Ciphertext data (may be smaller than chunkSize for last chunk) */
  ciphertext: Buffer
  /** Byte offset of this chunk's data within the chunk section */
  fileOffset: number
}

/** Range request specification */
export interface ByteRange {
  /** Inclusive start byte offset in plaintext */
  start: number
  /** Exclusive end byte offset in plaintext */
  end: number
}

/** Result of encrypting a buffer */
export interface EncryptResult {
  /** SHA-256 hex hash of the original plaintext */
  sha256: string
  /** Full encrypted buffer (header + all chunks) */
  encryptedData: Buffer
  /** Parsed header */
  header: MvltHeader
  /** Original plaintext size */
  originalSize: number
}

/** Result of streaming encrypt */
export interface StreamingEncryptResult {
  /** SHA-256 hex hash */
  sha256: string
  /** Parsed header */
  header: MvltHeader
  /** Original plaintext size */
  originalSize: number
  /** Readable stream of encrypted data (header already consumed/returned separately) */
  chunkStream: Readable
}

/** Result of buffer-based decrypt */
export interface DecryptResult {
  /** Decrypted plaintext data */
  data: Buffer
  /** MIME type from header */
  mimeType: string
  /** Original file size from header */
  originalSize: number
  /** Key ID from header */
  keyId: string
}

/** Result of streaming decrypt */
export interface StreamingDecryptResult {
  /** Readable stream of decrypted plaintext */
  stream: Readable
  /** MIME type from header */
  mimeType: string
  /** Original file size from header */
  originalSize: number
  /** Key ID from header */
  keyId: string
  /** Total plaintext size (for Content-Length) */
  contentLength: number
}

/** Result of range-based decrypt */
export interface RangeDecryptResult {
  /** Decrypted bytes for the requested range */
  data: Buffer
  /** MIME type from header */
  mimeType: string
  /** Total plaintext size (for Content-Range header) */
  totalSize: number
  /** Key ID from header */
  keyId: string
}

/** Result of SHA-256 hash computation */
export interface HashResult {
  /** SHA-256 hex digest (64 lowercase hex chars) */
  sha256: string
  /** Total byte count */
  size: number
}

/** Result of file-based SHA-256 hash computation */
export interface FileHashResult {
  /** SHA-256 hex digest (64 lowercase hex chars) */
  sha256: string
  /** Raw 32-byte SHA-256 digest */
  rawSha256: Buffer
  /** Total byte count */
  size: number
}

/** Result of storing a file via EncryptedStorageService */
export interface StoreResult {
  /** SHA-256 hex hash (64 lowercase hex chars) */
  sha256: string
  /** Relative path: objects/{prefix}/{sha256}.enc */
  encryptedPath: string
  /** Size of the encrypted file on disk */
  size: number
  /** Original MIME type */
  mimeType: string
  /** Parsed header */
  header: MvltHeader
  /** Whether this was a dedup hit */
  deduplicated: boolean
  /** Number of chunks */
  chunkCount: number
  /** Chunk size used */
  chunkSize: number
}

/** Result of retrieving a file */
export interface RetrieveResult {
  /** Readable stream of decrypted data */
  data: Readable
  /** Original MIME type */
  mimeType: string
  /** Original file size in bytes */
  originalSize: number
  /** Key ID */
  keyId: string
}

/** Options for EncryptedStorageService constructor */
export interface StorageServiceOptions {
  /** Base directory for encrypted file storage */
  dataDirectory: string
}

/** Validated SHA-256 hash (64 lowercase hex chars) */
export type Sha256Hex = string & { __brand: 'Sha256Hex' }

/** Key ring entry */
export interface KeyRingEntry {
  /** Non-secret key identifier (e.g. 'key-v1') */
  keyId: string
  /** 32-byte master key (hex-encoded 64 chars) */
  masterKeyHex: string
}

/** Memory measurement snapshot */
export interface MemorySnapshot {
  /** RSS in bytes */
  rssBytes: number
  /** Heap used in bytes */
  heapUsedBytes: number
  /** External in bytes */
  externalBytes: number
}
