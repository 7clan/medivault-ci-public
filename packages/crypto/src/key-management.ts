/**
 * MediVault Crypto — Key Management with Versioning (MVLT v3)
 *
 * ## Design
 *
 * ### Master Key
 * - Loaded from MEDIVAULT_MASTER_KEY environment variable (hex-encoded 256-bit key)
 * - NEVER stored in PostgreSQL or source control
 *
 * ### Per-Object Key Derivation (v3)
 * - Each StoredObject gets random objectSalt (32B), noncePrefix (8B), headerNonce (12B)
 * - fileKey = HKDF-SHA256(masterKey, salt=objectSalt, info="MVLT-FILE-KEY" || keyId, 32)
 * - headerAuthKey = HKDF-SHA256(masterKey, salt=objectSalt, info="MVLT-HEADER-KEY" || keyId, 32)
 * - chunkNonce(i) = noncePrefix || uint32BE(i)  — 12 bytes total
 *
 * ### Nonce Uniqueness (v3)
 * - objectSalt (32B random) makes fileKey unique per object (collision prob 2^-256)
 * - noncePrefix (8B random) makes chunk nonces unique even across different fileKeys
 * - Even if two objects get the same fileKey, nonce prefix collision is 2^-64
 *
 * ### Key Versioning
 * - Each master key has a non-secret keyId (e.g. 'key-v1')
 * - The keyId is stored in header + DB
 * - KeyRing supports multiple keys for rotation
 */

import { hkdfSync, randomBytes } from 'node:crypto'
import {
  KEY_SIZE,
  HKDF_FILE_KEY_INFO,
  HKDF_HEADER_KEY_INFO,
  DEFAULT_KEY_ID,
  OBJECT_SALT_SIZE,
  NONCE_PREFIX_SIZE,
  HEADER_NONCE_SIZE,
} from './constants.js'
import type { KeyRingEntry, ObjectKeys } from './types'

/**
 * Derive a per-object encryption key from the master key, object salt, and keyId.
 *
 * HKDF-SHA256(masterKey, salt=objectSalt, info="MVLT-FILE-KEY" || keyId, length=32)
 *
 * @param masterKey - 32-byte master key Buffer
 * @param objectSalt - 32-byte random per-object salt
 * @param keyId - Non-secret key version identifier
 * @returns 32-byte derived file key
 */
export function deriveFileKey(masterKey: Buffer, objectSalt: Buffer, keyId: string): Buffer {
  const keyIdBuf = Buffer.from(keyId, 'utf-8')
  const info = Buffer.concat([HKDF_FILE_KEY_INFO, keyIdBuf])
  return Buffer.from(hkdfSync('sha256', masterKey, objectSalt, info, KEY_SIZE))
}

/**
 * Derive the header authentication key for a specific object.
 *
 * HKDF-SHA256(masterKey, salt=objectSalt, info="MVLT-HEADER-KEY" || keyId, length=32)
 *
 * @param masterKey - 32-byte master key Buffer
 * @param objectSalt - 32-byte random per-object salt
 * @param keyId - Non-secret key version identifier
 * @returns 32-byte header auth key
 */
export function deriveHeaderAuthKey(masterKey: Buffer, objectSalt: Buffer, keyId: string): Buffer {
  const keyIdBuf = Buffer.from(keyId, 'utf-8')
  const info = Buffer.concat([HKDF_HEADER_KEY_INFO, keyIdBuf])
  return Buffer.from(hkdfSync('sha256', masterKey, objectSalt, info, KEY_SIZE))
}

/**
 * Generate random per-object cryptographic material.
 *
 * @returns ObjectKeys with objectSalt (32B), noncePrefix (8B), headerNonce (12B)
 */
export function generateObjectKeys(): ObjectKeys {
  return {
    objectSalt: randomBytes(OBJECT_SALT_SIZE),
    noncePrefix: randomBytes(NONCE_PREFIX_SIZE),
    headerNonce: randomBytes(HEADER_NONCE_SIZE),
  }
}

/**
 * Build the 12-byte nonce for a specific chunk.
 * noncePrefix (8B) || uint32BE(chunkIndex) (4B) = 12 bytes
 *
 * @param noncePrefix - 8-byte per-object random nonce prefix
 * @param chunkIndex - 0-based chunk index
 * @returns 12-byte GCM nonce
 */
export function buildChunkNonce(noncePrefix: Buffer, chunkIndex: number): Buffer {
  const nonce = Buffer.alloc(12)
  noncePrefix.copy(nonce, 0)
  nonce.writeUInt32BE(chunkIndex, 8)
  return nonce
}

/**
 * Parse and validate a master key hex string into a 32-byte Buffer.
 */
export function parseMasterKeyHex(keyHex: string): Buffer {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Invalid master key: must be a 64-character hex string (256 bits)')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Invalid master key: must be valid hexadecimal')
  }
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== KEY_SIZE) {
    throw new Error(`Invalid master key length: expected ${KEY_SIZE} bytes, got ${key.length}`)
  }
  return key
}

/**
 * Generate a random 256-bit master key and return it as a hex string.
 * For development / initial setup only.
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_SIZE).toString('hex')
}

/**
 * Validate that a hex string is a valid 256-bit key.
 */
export function isValidMasterKey(keyHex: string): boolean {
  if (!keyHex || keyHex.length !== 64) return false
  return /^[0-9a-fA-F]{64}$/.test(keyHex)
}

/**
 * Key ring: maps non-secret keyId → master key hex.
 * Supports multiple active keys for key rotation.
 */
export class KeyRing {
  private entries: Map<string, KeyRingEntry> = new Map()

  /**
   * Add a key to the ring.
   */
  add(entry: KeyRingEntry): void {
    if (!isValidMasterKey(entry.masterKeyHex)) {
      throw new Error(`Invalid master key for keyId '${entry.keyId}'`)
    }
    this.entries.set(entry.keyId, entry)
  }

  /**
   * Get a master key hex by keyId.
   * @throws Error if keyId is not found
   */
  get(keyId: string): KeyRingEntry {
    const entry = this.entries.get(keyId)
    if (!entry) {
      throw new Error(`Key not found in key ring: '${keyId}'. Available keys: ${[...this.entries.keys()].join(', ') || '(none)'}`)
    }
    return entry
  }

  /**
   * Get the primary (first added) master key hex.
   * @throws Error if no keys are registered
   */
  getPrimary(): KeyRingEntry {
    const first = this.entries.values().next()
    if (first.done) {
      throw new Error('No keys registered in key ring')
    }
    return first.value
  }

  /**
   * Check if a keyId exists in the ring.
   */
  has(keyId: string): boolean {
    return this.entries.has(keyId)
  }

  /**
   * Get all registered key IDs.
   */
  keyIds(): string[] {
    return [...this.entries.keys()]
  }

  /**
   * Create a KeyRing from the MEDIVAULT_MASTER_KEY environment variable.
   */
  static fromEnv(): KeyRing {
    const ring = new KeyRing()
    const masterKeyHex = process.env.MEDIVAULT_MASTER_KEY
    if (!masterKeyHex) {
      throw new Error(
        'MEDIVAULT_MASTER_KEY environment variable is required. Set it to a 64-character hex string (256-bit key).',
      )
    }
    ring.add({ keyId: DEFAULT_KEY_ID, masterKeyHex })

    // Register additional rotation keys if present
    const rotationKeys = process.env.MEDIVAULT_ROTATION_KEYS
    if (rotationKeys) {
      try {
        const entries: Array<{ keyId: string; masterKeyHex: string }> = JSON.parse(rotationKeys)
        for (const entry of entries) {
          ring.add(entry)
        }
      } catch {
        // If not valid JSON, ignore
      }
    }

    return ring
  }
}
