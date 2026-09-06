/**
 * MediVault Crypto — Typed Error Classes
 *
 * These errors map to specific HTTP status codes. Critical: never expose
 * crypto-internal details (key material, nonces, salt) to API consumers.
 */

// Corrupted encrypted object — never expose crypto details to client
export class StoredObjectIntegrityError extends Error {
  constructor(message = 'Stored object integrity check failed') {
    super(message)
    this.name = 'StoredObjectIntegrityError'
  }
}

// File not found on disk
export class EncryptedFileNotFoundError extends Error {
  public readonly sha256: string
  constructor(sha256: string) {
    super(`Encrypted file not found: ${sha256.substring(0, 16)}...`)
    this.name = 'EncryptedFileNotFoundError'
    this.sha256 = sha256
  }
}

// Unsupported MIME type
export class UnsupportedMimeTypeError extends Error {
  public readonly mimeType: string
  constructor(mimeType: string, allowed: string[]) {
    super(`Unsupported file type: ${mimeType}`)
    this.name = 'UnsupportedMimeTypeError'
    this.mimeType = mimeType
  }
}

// Invalid range request
export class InvalidRangeError extends Error {
  constructor(message = 'Invalid or unsupported range request') {
    super(message)
    this.name = 'InvalidRangeError'
  }
}

// Range not satisfiable (416)
export class RangeNotSatisfiableError extends Error {
  public readonly totalSize: number
  constructor(totalSize: number) {
    super(`Range not satisfiable: total size ${totalSize}`)
    this.name = 'RangeNotSatisfiableError'
    this.totalSize = totalSize
  }
}

/**
 * Map an internal error to an HTTP status response.
 * The `expose` flag controls whether the message is safe to send to clients.
 */
export function mapErrorToHttpStatus(error: unknown): { status: number; message: string; expose: boolean } {
  if (error instanceof UnsupportedMimeTypeError) return { status: 415, message: error.message, expose: true }
  if (error instanceof InvalidRangeError) return { status: 400, message: error.message, expose: true }
  if (error instanceof RangeNotSatisfiableError) return { status: 416, message: error.message, expose: true }
  if (error instanceof EncryptedFileNotFoundError) return { status: 404, message: 'Document data not found', expose: true }
  if (error instanceof StoredObjectIntegrityError) return { status: 500, message: 'Server integrity error', expose: false }
  // Default
  const msg = error instanceof Error ? error.message : 'Internal server error'
  return { status: 500, message: msg, expose: false }
}
