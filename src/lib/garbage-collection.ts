/**
 * MediVault Garbage Collection Service
 *
 * State machine: ACTIVE -> PENDING_DELETION -> PURGE_APPROVED -> PURGING -> PURGED
 * On error: PURGING -> PURGE_FAILED (retryable)
 *
 * GC may purge only when a completed, checksum-verified, available backup contains that exact StoredObject.
 * Not scheduled automatically — must be invoked manually.
 */
import { db } from '@/lib/db'
import { getStorageService } from './crypto-helpers'
import fs from 'node:fs'
import path from 'node:path'

export interface GcDryRunResult {
  candidates: Array<{
    id: string
    sha256: string
    retentionDays: number
    pendingSince: Date
    activeRefs: number
    backupVerified: boolean
    readyForPurge: boolean
    reason: string
  }>
  totalCandidates: number
  readyCount: number
}

export interface GcPurgeResult {
  processed: number
  purged: number
  skipped: number
  failed: number
  errors: Array<{ sha256: string; error: string }>
}

export async function gcDryRun(): Promise<GcDryRunResult> {
  // 1. Find all StoredObjects in PENDING_DELETION state
  // 2. For each, check:
  //    a. Retention period has passed (pendingDeletionAt + retentionDays < now)
  //    b. No active Document or DocumentVersion references (deletedAt is null)
  //    c. A completed backup contains a checksum-verified BackupObjectEntry for this StoredObject
  //    d. StoredObject.backupVerifiedAt is not null
  // 3. Return report of candidates with reasons
  const now = new Date()
  const pendingObjects = await db.storedObject.findMany({
    where: { purgeState: 'PENDING_DELETION' },
  })

  const candidates: GcDryRunResult['candidates'] = []
  for (const obj of pendingObjects) {
    const reasons: string[] = []
    let readyForPurge = true

    // Check retention
    const retentionMs = (obj.retentionDays || 30) * 86400_000
    const pendingSince = obj.pendingDeletionAt || obj.createdAt
    if (now.getTime() - pendingSince.getTime() < retentionMs) {
      reasons.push('retention period not expired')
      readyForPurge = false
    }

    // Check active references
    const activeDocRefs = await db.document.count({
      where: { storedObjectId: obj.id, deletedAt: null },
    })
    const activeVerRefs = await db.documentVersion.count({
      where: { storedObjectId: obj.id },
    })
    if (activeDocRefs > 0 || activeVerRefs > 0) {
      reasons.push(`has ${activeDocRefs} doc + ${activeVerRefs} version refs`)
      readyForPurge = false
    }

    // Check backup verification
    const hasBackup = obj.backupVerifiedAt !== null && obj.verifiedBackupId !== null
    if (!hasBackup) {
      reasons.push('no verified backup')
      readyForPurge = false
    } else {
      // Verify the backup still exists and is completed
      const backup = await db.backupHistory.findUnique({ where: { id: obj.verifiedBackupId! } })
      if (!backup || backup.status !== 'completed' || !backup.checksum) {
        reasons.push('backup missing/incomplete')
        readyForPurge = false
      } else {
        // Verify a checksum-verified BackupObjectEntry exists for this StoredObject
        const entry = await db.backupObjectEntry.findUnique({
          where: { backupId_storedObjectId: { backupId: backup.id, storedObjectId: obj.id } },
        })
        if (!entry || !entry.checksumVerified || entry.sha256Hash !== obj.sha256Hash) {
          reasons.push('no checksum-verified backup entry')
          readyForPurge = false
        }
      }
    }

    candidates.push({
      id: obj.id,
      sha256: obj.sha256Hash,
      retentionDays: obj.retentionDays,
      pendingSince,
      activeRefs: activeDocRefs + activeVerRefs,
      backupVerified: hasBackup,
      readyForPurge,
      reason: reasons.join(', ') || 'Ready',
    })
  }

  return {
    candidates,
    totalCandidates: candidates.length,
    readyCount: candidates.filter(c => c.readyForPurge).length,
  }
}

export async function gcPurge(actorId?: string): Promise<GcPurgeResult> {
  // 1. Run dry-run to get ready candidates
  const dryRun = await gcDryRun()
  const result: GcPurgeResult = { processed: 0, purged: 0, skipped: 0, failed: 0, errors: [] }

  for (const candidate of dryRun.candidates.filter(c => c.readyForPurge)) {
    result.processed++
    try {
      // 2. Transition to PURGE_APPROVED
      await db.storedObject.update({
        where: { id: candidate.id },
        data: { purgeState: 'PURGE_APPROVED' },
      })

      // 3. Transition to PURGING
      await db.storedObject.update({
        where: { id: candidate.id },
        data: { purgeState: 'PURGING' },
      })

      // 4. Delete physical file
      const storage = getStorageService()
      await storage.deletePhysical(candidate.sha256)

      // 5. Create tombstone BEFORE deleting DB record
      const tombstone = await db.purgeTombstone.create({
        data: {
          storedObjectId: candidate.id,
          sha256: candidate.sha256,
          actorId,
          verifiedBackupId: (await db.storedObject.findUnique({ where: { id: candidate.id } }))?.verifiedBackupId,
        },
      })

      // 6. Log audit event
      await db.auditLog.create({
        data: {
          actorId: actorId || 'system',
          action: 'PURGE_STORED_OBJECT',
          entityType: 'StoredObject',
          entityId: candidate.id,
          details: { sha256: candidate.sha256, tombstoneId: tombstone.id },
        },
      })

      // 7. Transition to PURGED (keep record, null out encrypted path)
      await db.storedObject.update({
        where: { id: candidate.id },
        data: {
          purgeState: 'PURGED',
          encryptedPath: '',
          plaintextSize: 0,
        },
      })

      result.purged++
    } catch (err) {
      // Mark as FAILED (retryable)
      try {
        await db.storedObject.update({
          where: { id: candidate.id },
          data: { purgeState: 'PURGE_FAILED' },
        })
      } catch { /* DB may be down */ }
      result.failed++
      result.errors.push({ sha256: candidate.sha256, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Skipped = candidates that are not ready
  result.skipped = dryRun.candidates.filter(c => !c.readyForPurge).length

  return result
}
