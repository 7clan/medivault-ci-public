/**
 * MediVault Fastify — Backup & Restore Service
 *
 * Creates cryptographically verified backups of all ACTIVE StoredObjects,
 * generates in-memory manifests with SHA-256 integrity checksums, and
 * supports restore previews with per-entry file existence checks.
 *
 * Backup workflow:
 *   1. Create BackupHistory record (status='in_progress')
 *   2. Iterate all ACTIVE StoredObjects → create BackupObjectEntry records
 *   3. Compute SHA-256 of each .enc file on disk, compare to StoredObject hash
 *   4. Generate manifest JSON, compute its checksum
 *   5. Mark backup completed, stamp verified StoredObjects
 *
 * Restore workflow:
 *   1. restorePreview: non-destructive read of what would be restored
 *   2. executeRestore: validates backup integrity, returns per-entry status
 */

import { db } from '../lib/db.js'
import { getStorageService } from '../lib/crypto-helpers.js'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export interface BackupResult {
  backupId: string
  status: string
  manifest: BackupManifest
  objectCount: number
  verifiedCount: number
  failedCount: number
  totalSize: number
  manifestChecksum: string
  errors: Array<{ storedObjectId: string; sha256: string; error: string }>
}

export interface BackupManifest {
  backupId: string
  createdAt: string
  triggeredBy: string
  backupType: string
  totalObjects: number
  totalEncryptedSize: number
  verifiedCount: number
  failedCount: number
  entries: Array<{
    storedObjectId: string
    sha256Hash: string
    encryptedSize: number
    status: string
    checksumVerified: boolean
    error?: string
  }>
}

export interface RestorePreviewResult {
  backup: {
    id: string
    createdAt: string
    status: string
    checksum: string | null
    objectCount: number
  }
  entries: Array<{
    storedObjectId: string
    sha256Hash: string
    checksumVerified: boolean
    fileExists: boolean
    objectExists: boolean
    storedObjectPurgeState: string | null
  }>
}

export interface RestoreResult {
  backupId: string
  totalEntries: number
  verifiedEntries: number
  missingFiles: number
  integrityFailures: number
  skippedEntries: number
  entries: Array<{
    storedObjectId: string
    sha256Hash: string
    status: 'verified' | 'missing_file' | 'integrity_failure' | 'skipped'
    error?: string
  }>
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file on disk.
 * Returns lowercase hex string or null if file cannot be read.
 */
function computeFileSha256(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(data).digest('hex')
  } catch {
    return null
  }
}

/**
 * Compute SHA-256 of an arbitrary string (used for manifest checksum).
 */
function computeStringSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

// ─────────────────────────────────────────────
// createBackup
// ─────────────────────────────────────────────

/**
 * Create a full backup of all ACTIVE StoredObjects.
 *
 * 1. Creates a BackupHistory record with status='in_progress' and a
 *    label-based filePath (e.g. `backup-{timestamp}`).
 * 2. Iterates every StoredObject where purgeState = 'ACTIVE'.
 * 3. For each, creates a BackupObjectEntry, reads the .enc file from disk,
 *    computes its SHA-256, and compares against StoredObject.sha256Hash.
 * 4. Builds an in-memory manifest JSON containing all entries.
 * 5. Marks the backup as 'completed' with the manifest checksum (SHA-256 of
 *    the JSON string).
 * 6. Updates each verified StoredObject with backupVerifiedAt and
 *    verifiedBackupId.
 */
export async function createBackup(
  triggeredByUserId: string,
  backupType: string,
): Promise<BackupResult> {
  const storage = getStorageService()
  const errors: BackupResult['errors'] = []
  const manifestEntries: BackupManifest['entries'] = []

  // 1. Create BackupHistory record
  const timestamp = Date.now()
  const filePath = `backup-${timestamp}`

  const backup = await db.backupHistory.create({
    data: {
      triggeredBy: triggeredByUserId,
      backupType,
      filePath,
      status: 'in_progress',
    },
  })

  // 2. Fetch all ACTIVE StoredObjects
  const storedObjects = await db.storedObject.findMany({
    where: { purgeState: 'ACTIVE' },
  })

  let totalSize = 0
  let verifiedCount = 0
  let failedCount = 0

  // 3. Iterate and verify each object
  for (const obj of storedObjects) {
    try {
      // Determine the encrypted file path on disk
      const encPath = storage.objectPath(obj.sha256Hash)
      const exists = storage.exists(obj.sha256Hash)

      let encryptedSize = 0
      let checksumVerified = false
      let entryError: string | undefined

      if (!exists) {
        entryError = 'encrypted file not found on disk'
      } else {
        // Get file size
        try {
          const stat = fs.statSync(encPath)
          encryptedSize = stat.size
        } catch {
          entryError = 'failed to stat encrypted file'
        }

        // Compute SHA-256 of the encrypted file and compare
        if (!entryError) {
          const fileHash = computeFileSha256(encPath)
          if (!fileHash) {
            entryError = 'failed to read encrypted file for checksum'
          } else if (fileHash !== obj.sha256Hash) {
            entryError = `checksum mismatch: expected ${obj.sha256Hash}, got ${fileHash}`
          } else {
            checksumVerified = true
          }
        }
      }

      // Create BackupObjectEntry record
      const entry = await db.backupObjectEntry.create({
        data: {
          backupId: backup.id,
          storedObjectId: obj.id,
          sha256Hash: obj.sha256Hash,
          encryptedSize: encryptedSize > 0 ? encryptedSize : null,
          status: checksumVerified ? 'verified' : 'failed',
          checksumVerified,
          verifiedAt: checksumVerified ? new Date() : null,
          error: entryError,
        },
      })

      totalSize += encryptedSize

      if (checksumVerified) {
        verifiedCount++
      } else {
        failedCount++
        errors.push({
          storedObjectId: obj.id,
          sha256: obj.sha256Hash,
          error: entryError ?? 'unknown error',
        })
      }

      manifestEntries.push({
        storedObjectId: obj.id,
        sha256Hash: obj.sha256Hash,
        encryptedSize,
        status: entry.status,
        checksumVerified,
        error: entryError,
      })
    } catch (err) {
      failedCount++
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push({
        storedObjectId: obj.id,
        sha256: obj.sha256Hash,
        error: errorMsg,
      })

      await db.backupObjectEntry.create({
        data: {
          backupId: backup.id,
          storedObjectId: obj.id,
          sha256Hash: obj.sha256Hash,
          status: 'failed',
          checksumVerified: false,
          error: errorMsg,
        },
      })

      manifestEntries.push({
        storedObjectId: obj.id,
        sha256Hash: obj.sha256Hash,
        encryptedSize: 0,
        status: 'failed',
        checksumVerified: false,
        error: errorMsg,
      })
    }
  }

  // 4. Build the manifest
  const manifest: BackupManifest = {
    backupId: backup.id,
    createdAt: backup.createdAt.toISOString(),
    triggeredBy: triggeredByUserId,
    backupType,
    totalObjects: storedObjects.length,
    totalEncryptedSize: totalSize,
    verifiedCount,
    failedCount,
    entries: manifestEntries,
  }

  const manifestJson = JSON.stringify(manifest)
  const manifestChecksum = computeStringSha256(manifestJson)

  // 5. Mark backup as completed
  await db.backupHistory.update({
    where: { id: backup.id },
    data: {
      status: 'completed',
      fileSize: totalSize > 0 ? totalSize : null,
      checksum: manifestChecksum,
      completedAt: new Date(),
    },
  })

  // 6. Update each verified StoredObject with backup verification stamps
  const verifiedStoredObjectIds = manifestEntries
    .filter(e => e.checksumVerified)
    .map(e => e.storedObjectId)

  if (verifiedStoredObjectIds.length > 0) {
    const completedAt = new Date()
    await db.storedObject.updateMany({
      where: { id: { in: verifiedStoredObjectIds } },
      data: {
        backupVerifiedAt: completedAt,
        verifiedBackupId: backup.id,
      },
    })
  }

  return {
    backupId: backup.id,
    status: 'completed',
    manifest,
    objectCount: storedObjects.length,
    verifiedCount,
    failedCount,
    totalSize,
    manifestChecksum,
    errors,
  }
}

// ─────────────────────────────────────────────
// restorePreview
// ─────────────────────────────────────────────

/**
 * Preview what would be restored from a given backup.
 *
 * Returns:
 * - Backup metadata (id, createdAt, status, checksum, object count)
 * - Per-entry details including whether the StoredObject still exists in the
 *   database, whether the encrypted .enc file is on disk, and the current
 *   purgeState of the StoredObject.
 */
export async function restorePreview(backupId: string): Promise<RestorePreviewResult> {
  const storage = getStorageService()

  // Fetch the backup record
  const backup = await db.backupHistory.findUnique({
    where: { id: backupId },
  })

  if (!backup) {
    throw new Error(`Backup not found: ${backupId}`)
  }

  // Fetch all entries for this backup
  const entries = await db.backupObjectEntry.findMany({
    where: { backupId },
    include: {
      storedObject: {
        select: {
          id: true,
          purgeState: true,
        },
      },
    },
  })

  const previewEntries: RestorePreviewResult['entries'] = entries.map(entry => {
    const obj = entry.storedObject
    const objectExists = obj !== null
    const fileExists = objectExists ? storage.exists(entry.sha256Hash) : false

    return {
      storedObjectId: entry.storedObjectId,
      sha256Hash: entry.sha256Hash,
      checksumVerified: entry.checksumVerified,
      fileExists,
      objectExists,
      storedObjectPurgeState: objectExists ? obj.purgeState : null,
    }
  })

  return {
    backup: {
      id: backup.id,
      createdAt: backup.createdAt.toISOString(),
      status: backup.status,
      checksum: backup.checksum,
      objectCount: entries.length,
    },
    entries: previewEntries,
  }
}

// ─────────────────────────────────────────────
// executeRestore
// ─────────────────────────────────────────────

/**
 * Execute a restore verification for a given backup.
 *
 * Validates that the backup is completed and has a checksum, then iterates
 * all entries to verify each one. Does NOT modify any data — this is a
 * read-only integrity verification.
 *
 * Per-entry status:
 * - 'verified': checksum verified, file exists and matches
 * - 'missing_file': encrypted file not found on disk
 * - 'integrity_failure': file exists but checksum does not match
 * - 'skipped': entry was not checksum-verified in original backup
 */
export async function executeRestore(
  backupId: string,
  actorId: string,
): Promise<RestoreResult> {
  const storage = getStorageService()

  // Fetch and validate the backup
  const backup = await db.backupHistory.findUnique({
    where: { id: backupId },
  })

  if (!backup) {
    throw new Error(`Backup not found: ${backupId}`)
  }

  if (backup.status !== 'completed') {
    throw new Error(`Backup is not completed (status: ${backup.status})`)
  }

  if (!backup.checksum) {
    throw new Error(`Backup has no checksum — cannot verify integrity`)
  }

  // Fetch all entries
  const entries = await db.backupObjectEntry.findMany({
    where: { backupId },
  })

  const resultEntries: RestoreResult['entries'] = []
  let verifiedEntries = 0
  let missingFiles = 0
  let integrityFailures = 0
  let skippedEntries = 0

  for (const entry of entries) {
    // Check if the encrypted file exists
    const fileExists = storage.exists(entry.sha256Hash)

    if (!fileExists) {
      resultEntries.push({
        storedObjectId: entry.storedObjectId,
        sha256Hash: entry.sha256Hash,
        status: 'missing_file',
        error: 'encrypted file not found on disk',
      })
      missingFiles++
      continue
    }

    // If the entry was not originally checksum-verified, skip it
    if (!entry.checksumVerified) {
      resultEntries.push({
        storedObjectId: entry.storedObjectId,
        sha256Hash: entry.sha256Hash,
        status: 'skipped',
        error: 'entry was not checksum-verified in original backup',
      })
      skippedEntries++
      continue
    }

    // Verify the file checksum against the stored hash
    const encPath = storage.objectPath(entry.sha256Hash)
    const fileHash = computeFileSha256(encPath)

    if (!fileHash) {
      resultEntries.push({
        storedObjectId: entry.storedObjectId,
        sha256Hash: entry.sha256Hash,
        status: 'missing_file',
        error: 'failed to read encrypted file for checksum',
      })
      missingFiles++
      continue
    }

    if (fileHash !== entry.sha256Hash) {
      resultEntries.push({
        storedObjectId: entry.storedObjectId,
        sha256Hash: entry.sha256Hash,
        status: 'integrity_failure',
        error: `checksum mismatch: expected ${entry.sha256Hash}, got ${fileHash}`,
      })
      integrityFailures++
      continue
    }

    resultEntries.push({
      storedObjectId: entry.storedObjectId,
      sha256Hash: entry.sha256Hash,
      status: 'verified',
    })
    verifiedEntries++
  }

  return {
    backupId,
    totalEntries: entries.length,
    verifiedEntries,
    missingFiles,
    integrityFailures,
    skippedEntries,
    entries: resultEntries,
  }
}
