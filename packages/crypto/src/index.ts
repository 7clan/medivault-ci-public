/**
 * MediVault Crypto — Barrel Exports (MVLT v3)
 */

// Constants
export {
  MAGIC,
  FORMAT_VERSION,
  ALGORITHM,
  ALGORITHM_ID_AES256GCM,
  KEY_SIZE,
  NONCE_SIZE,
  TAG_SIZE,
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  HEADER_TAG_SIZE,
  OBJECT_SALT_SIZE,
  NONCE_PREFIX_SIZE,
  HEADER_NONCE_SIZE,
  RAW_SHA256_SIZE,
  HKDF_FILE_KEY_INFO,
  HKDF_HEADER_KEY_INFO,
  DEFAULT_KEY_ID,
  ALLOWED_MIME_TYPES,
  STORAGE_PATH_FORMAT,
  PLAINTEXT_READ_CHUNK,
} from './constants.js'

// Types
export type {
  ObjectKeys,
  ChunkAadParams,
  MvltHeader,
  EncryptedChunk,
  ByteRange,
  EncryptResult,
  StreamingEncryptResult,
  DecryptResult,
  StreamingDecryptResult,
  RangeDecryptResult,
  HashResult,
  FileHashResult,
  StoreResult,
  RetrieveResult,
  StorageServiceOptions,
  Sha256Hex,
  KeyRingEntry,
  MemorySnapshot,
} from './types'

// Header
export {
  headerByteLength,
  buildAndSerializeHeader,
  parseAndVerifyHeader,
  parseHeaderUnverified,
} from './header.js'

// Hash
export { computeHash, computeHashBuffer, computeHashBufferRaw, computeHashFile } from './hash.js'

// Key Management
export {
  deriveFileKey,
  deriveHeaderAuthKey,
  generateObjectKeys,
  buildChunkNonce,
  parseMasterKeyHex,
  generateMasterKey,
  isValidMasterKey,
  KeyRing,
} from './key-management.js'

// Encrypt
export { encrypt, encryptSingleChunk, buildHeaderOnly, writeChunksToStream, buildChunkAad } from './encrypt.js'

// Decrypt
export {
  decrypt,
  decryptSingleChunk,
  decryptRange,
  decryptToStream,
  decryptFileToStream,
  decryptRangeFromFile,
  parseEncryptedHeader,
} from './decrypt.js'

// Storage Service
export { EncryptedStorageService, takeMemorySnapshot, validateSha256Hex } from './storage-service.js'

// Error Classes
export {
  StoredObjectIntegrityError,
  EncryptedFileNotFoundError,
  UnsupportedMimeTypeError,
  InvalidRangeError,
  RangeNotSatisfiableError,
  mapErrorToHttpStatus,
} from './errors.js'
