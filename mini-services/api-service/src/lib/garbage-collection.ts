/**
 * MediVault Fastify — Garbage Collection Service
 *
 * State machine: ACTIVE -> PENDING_DELETION -> PURGE_APPROVED -> PURGING -> PURGED
 * On error: PURGING -> PURGE_FAILED (retryable)
 *
 * GC may purge only when a completed, checksum-verified, available backup contains that exact StoredObject.
 *
 * Two-step purge:
 *   1. gcDryRun() — returns candidates with readiness assessment
 *   2. gcPurgeApproved(actorId, approvedIds) — only purges the explicitly approved IDs
 */
import { db } from '../lib/db.js'
import { getStorageService } from './crypto-helpers.js'

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
      const backup = await db.backupHistory.findUnique({ where: { id: obj.verifiedBackupId! } })
      if (!backup || backup.status !== 'completed' || !backup.checksum) {
        reasons.push('backup missing/incomplete')
        readyForPurge = false
      } else {
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

/**
 * Purge only the explicitly approved StoredObject IDs.
 * The caller MUST have run gcDryRun() first and presented the
 * candidates to the operator for explicit approval.
 *
 * Each approved ID is validated: it must exist, be PENDING_DELETION,
 * and be readyForPurge (same checks as dry-run, to prevent TOCTOU).
 */
export async function gcPurgeApproved(
  actorId: string,
  approvedIds: string[],
): Promise<GcPurgeResult> {
  const result: GcPurgeResult = { processed: 0, purged: 0, skipped: 0, failed: 0, errors: [] }
  const now = new Date()

  for (const id of approvedIds) {
    result.processed++

    try {
      const obj = await db.storedObject.findUnique({ where: { id } })
      if (!obj) {
        result.skipped++
        continue
      }

      // Re-validate readiness (same checks as dry-run to prevent TOCTOU race)
      if (obj.purgeState !== 'PENDING_DELETION') {
        result.skipped++
        continue
      }

      // Check retention
      const retentionMs = (obj.retentionDays || 30) * 86400_000
      const pendingSince = obj.pendingDeletionAt || obj.createdAt
      if (now.getTime() - pendingSince.getTime() < retentionMs) {
        result.skipped++
        continue
      }

      // Check active references
      const [activeDocRefs, activeVerRefs] = await Promise.all([
        db.document.count({ where: { storedObjectId: obj.id, deletedAt: null } }),
        db.documentVersion.count({ where: { storedObjectId: obj.id } }),
      ])
      if (activeDocRefs > 0 || activeVerRefs > 0) {
        result.skipped++
        continue
      }

      // Check backup verification
      const hasBackup = obj.backupVerifiedAt !== null && obj.verifiedBackupId !== null
      if (!hasBackup) {
        result.skipped++
        continue
      }
      const backup = await db.backupHistory.findUnique({ where: { id: obj.verifiedBackupId! } })
      if (!backup || backup.status !== 'completed' || !backup.checksum) {
        result.skipped++
        continue
      }
      const entry = await db.backupObjectEntry.findUnique({
        where: { backupId_storedObjectId: { backupId: backup.id, storedObjectId: obj.id } },
      })
      if (!entry || !entry.checksumVerified || entry.sha256Hash !== obj.sha256Hash) {
        result.skipped++
        continue
      }

      // All checks passed — proceed with purge
      await db.storedObject.update({
        where: { id },
        data: { purgeState: 'PURGE_APPROVED' },
      })

      await db.storedObject.update({
        where: { id },
        data: { purgeState: 'PURGING' },
      })

      const storage = getStorageService()
      await storage.deletePhysical(obj.sha256Hash)

      const tombstone = await db.purgeTombstone.create({
        data: {
          storedObjectId: obj.id,
          sha256: obj.sha256Hash,
          actorId,
          verifiedBackupId: obj.verifiedBackupId,
        },
      })

      await db.auditLog.create({
        data: {
          actorId,
          action: 'PURGE_STORED_OBJECT',
          entityType: 'StoredObject',
          entityId: obj.id,
          details: { sha256: obj.sha256Hash, tombstoneId: tombstone.id },
        },
      })

      await db.storedObject.update({
        where: { id },
        data: {
          purgeState: 'PURGED',
          encryptedPath: '',
          plaintextSize: 0,
        },
      })

      result.purged++
    } catch (err) {
      try {
        await db.storedObject.update({
          where: { id },
          data: { purgeState: 'PURGE_FAILED' },
        })
      } catch { /* DB may be down */ }
      result.failed++
      result.errors.push({
        sha256: id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
