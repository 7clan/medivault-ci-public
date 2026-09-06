/**
 * MediVault — Crypto helpers for API routes
 *
 * Provides a singleton EncryptedStorageService instance
 * and master key management for server-side use.
 */

import { EncryptedStorageService, FORMAT_VERSION, generateMasterKey, isValidMasterKey } from '../../packages/crypto/src'

export { FORMAT_VERSION }
import path from 'node:path'

let _storageService: EncryptedStorageService | null = null

/**
 * Get or create the encrypted storage service singleton.
 * The master key is loaded from MEDIVAULT_MASTER_KEY env var.
 * In development, a random key is generated and logged (once).
 */
export function getStorageService(): EncryptedStorageService {
  if (_storageService) return _storageService

  const dataDir = process.env.MEDIVAULT_DATA_DIR || path.join(process.cwd(), 'data')
  let masterKeyHex = process.env.MEDIVAULT_MASTER_KEY

  if (!masterKeyHex || !isValidMasterKey(masterKeyHex)) {
    if (process.env.NODE_ENV === 'development') {
      masterKeyHex = generateMasterKey()
      console.warn(
        '[MediVault] MEDIVAULT_MASTER_KEY not set or invalid. Generated a temporary key for this session.',
      )
      console.warn('[MediVault] THIS KEY WILL BE LOST ON RESTART. Set MEDIVAULT_MASTER_KEY in .env for persistence.')
    } else {
      throw new Error(
        'MEDIVAULT_MASTER_KEY environment variable is required and must be a 64-character hex string.',
      )
    }
  }

  _storageService = new EncryptedStorageService({ dataDirectory: dataDir, masterKeyHex })
  return _storageService
}

/**
 * Validate a SHA-256 hash string (64 lowercase hex chars).
 */
export function isValidSha256(hash: string | null | undefined): boolean {
  if (!hash) return false
  return /^[0-9a-f]{64}$/.test(hash)
}
