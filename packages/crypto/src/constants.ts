/**
 * MediVault Crypto — Constants (MVLT Format Version 3)
 */

/** MVLT file magic bytes */
export const MAGIC = Buffer.from('MVLT', 'ascii') // 0x4D564C54

/** Current binary format version */
export const FORMAT_VERSION = 3

/** AES-256-GCM cipher algorithm */
export const ALGORITHM = 'aes-256-gcm'

/** Algorithm byte identifier in file header */
export const ALGORITHM_ID_AES256GCM = 0x01

/** Encryption key size in bytes (256 bits) */
export const KEY_SIZE = 32

/** GCM nonce size in bytes (96 bits) */
export const NONCE_SIZE = 12

/** GCM authentication tag size in bytes (128 bits) */
export const TAG_SIZE = 16

/** Default chunk size for streaming encryption: 1 MiB */
export const DEFAULT_CHUNK_SIZE = 1024 * 1024 // 1048576 bytes

/** Maximum allowed chunk size: 4 MiB */
export const MAX_CHUNK_SIZE = 4 * 1024 * 1024

/** Minimum allowed chunk size: 64 KiB */
export const MIN_CHUNK_SIZE = 64 * 1024

/** Header auth tag size (AES-GCM tag for header authentication) */
export const HEADER_TAG_SIZE = 16

/** Object salt size: 32 random bytes for per-object key derivation */
export const OBJECT_SALT_SIZE = 32

/** Nonce prefix size: 8 random bytes for per-object chunk nonce prefix */
export const NONCE_PREFIX_SIZE = 8

/** Header nonce size: 12 random bytes for per-object header auth nonce */
export const HEADER_NONCE_SIZE = 12

/** Raw SHA-256 digest size: 32 bytes */
export const RAW_SHA256_SIZE = 32

/** HKDF info string for file key derivation */
export const HKDF_FILE_KEY_INFO = Buffer.from('MVLT-FILE-KEY')

/** HKDF info string for header auth key derivation */
export const HKDF_HEADER_KEY_INFO = Buffer.from('MVLT-HEADER-KEY')

/** Current key version identifier (non-secret, stored in file header and DB) */
export const DEFAULT_KEY_ID = 'key-v1'

/** Allowed MIME types for medical document storage */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
])

/** Storage path format: {dataDir}/objects/{sha256[0:2]}/{fullSha256}.enc */
export const STORAGE_PATH_FORMAT = 'objects/{prefix}/{sha256}.enc'

/** Plaintext streaming read chunk size for storage-service two-pass (1 MiB) */
export const PLAINTEXT_READ_CHUNK = 1024 * 1024
