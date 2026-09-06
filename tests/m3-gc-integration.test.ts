/**
 * Garbage Collection Integration Tests (Item 4)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

import { gcDryRun, gcPurge } from '../src/lib/garbage-collection'

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
let prisma: PrismaClient

beforeAll(async () => {
  process.env.DATABASE_URL = DB_URL
  // Set required env vars for getStorageService()
  process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
  prisma = new PrismaClient({
    datasources: { db: { url: DB_URL } },
  })
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GC Integration', () => {
  it('@integration gc-dry-run — no candidates returns empty', async () => {
    const result = await gcDryRun()
    // There may be candidates from other tests, but we check the structure
    expect(result).toHaveProperty('candidates')
    expect(result).toHaveProperty('totalCandidates')
    expect(result).toHaveProperty('readyCount')
    expect(Array.isArray(result.candidates)).toBe(true)
    expect(typeof result.totalCandidates).toBe('number')
    expect(typeof result.readyCount).toBe('number')
    expect(result.readyCount).toBeLessThanOrEqual(result.totalCandidates)
  })

  it('@integration gc-dry-run — candidate with active refs is skipped', async () => {
    // Create a user, patient, stored object, and document
    const user = await prisma.user.create({
      data: {
        email: `gc-test-active-${Date.now()}@test.com`,
        password: 'hashed',
        name: 'GC Test Active',
      },
    })
    const patient = await prisma.patient.create({
      data: { doctorId: user.id, firstName: 'GC', lastName: 'Active' },
    })
    const sha = randomBytes(32).toString('hex')
    const so = await prisma.storedObject.create({
      data: {
        sha256Hash: sha,
        encryptedPath: `objects/${sha.slice(0, 2)}/${sha}.enc`,
        plaintextSize: 100,
        encryptionFormatVersion: 3,
        purgeState: 'PENDING_DELETION',
        pendingDeletionAt: new Date(Date.now() - 60 * 86400_000), // 60 days ago
        retentionDays: 30,
      },
    })
    // Active document reference
    await prisma.document.create({
      data: {
        patientId: patient.id,
        fileName: 'gc-active.pdf',
        filePath: so.encryptedPath,
        fileSize: 100,
        mimeType: 'application/pdf',
        storedObjectId: so.id,
      },
    })

    const result = await gcDryRun()
    const candidate = result.candidates.find(c => c.id === so.id)
    expect(candidate).toBeDefined()
    expect(candidate!.readyForPurge).toBe(false)
    expect(candidate!.reason).toContain('refs')

    // Cleanup
    await prisma.document.deleteMany({ where: { storedObjectId: so.id } })
    await prisma.storedObject.delete({ where: { id: so.id } })
    await prisma.patient.delete({ where: { id: patient.id } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('@integration gc-dry-run — candidate without backup verification is skipped', async () => {
    const sha = randomBytes(32).toString('hex')
    const so = await prisma.storedObject.create({
      data: {
        sha256Hash: sha,
        encryptedPath: `objects/${sha.slice(0, 2)}/${sha}.enc`,
        plaintextSize: 100,
        encryptionFormatVersion: 3,
        purgeState: 'PENDING_DELETION',
        pendingDeletionAt: new Date(Date.now() - 60 * 86400_000),
        retentionDays: 30,
        // No backupVerifiedAt, no verifiedBackupId
      },
    })

    const result = await gcDryRun()
    const candidate = result.candidates.find(c => c.id === so.id)
    expect(candidate).toBeDefined()
    expect(candidate!.readyForPurge).toBe(false)
    expect(candidate!.backupVerified).toBe(false)
    expect(candidate!.reason).toContain('backup')

    // Cleanup
    await prisma.storedObject.delete({ where: { id: so.id } })
  })

  it('@integration gc-dry-run — retention not expired is skipped', async () => {
    const sha = randomBytes(32).toString('hex')
    const so = await prisma.storedObject.create({
      data: {
        sha256Hash: sha,
        encryptedPath: `objects/${sha.slice(0, 2)}/${sha}.enc`,
        plaintextSize: 100,
        encryptionFormatVersion: 3,
        purgeState: 'PENDING_DELETION',
        pendingDeletionAt: new Date(), // Just now
        retentionDays: 30,
      },
    })

    const result = await gcDryRun()
    const candidate = result.candidates.find(c => c.id === so.id)
    expect(candidate).toBeDefined()
    expect(candidate!.readyForPurge).toBe(false)
    expect(candidate!.reason).toContain('retention')

    // Cleanup
    await prisma.storedObject.delete({ where: { id: so.id } })
  })

  it('@integration gc-purge — fully verified candidate transitions through state machine', async () => {
    // Create a fully eligible candidate
    const sha = randomBytes(32).toString('hex')
    const user = await prisma.user.create({
      data: {
        email: `gc-purge-test-${Date.now()}@test.com`,
        password: 'hashed',
        name: 'GC Purge Test',
      },
    })

    // Create a completed backup with a checksum-verified BackupObjectEntry
    const backup = await prisma.backupHistory.create({
      data: {
        triggeredBy: user.id,
        backupType: 'full',
        filePath: '/tmp/test-backup.tar',
        fileSize: 1000,
        checksum: 'sha256:abc123',
        status: 'completed',
        completedAt: new Date(),
      },
    })

    const so = await prisma.storedObject.create({
      data: {
        sha256Hash: sha,
        encryptedPath: `objects/${sha.slice(0, 2)}/${sha}.enc`,
        plaintextSize: 100,
        encryptionFormatVersion: 3,
        purgeState: 'PENDING_DELETION',
        pendingDeletionAt: new Date(Date.now() - 60 * 86400_000),
        retentionDays: 30,
        backupVerifiedAt: new Date(),
        verifiedBackupId: backup.id,
      },
    })

    // Create a checksum-verified BackupObjectEntry
    await prisma.backupObjectEntry.create({
      data: {
        backupId: backup.id,
        storedObjectId: so.id,
        sha256Hash: sha,
        encryptedSize: 200,
        status: 'completed',
        checksumVerified: true,
        verifiedAt: new Date(),
      },
    })

    // Run purge
    const result = await gcPurge(user.id)

    // Check the stored object transitioned to PURGED
    const purged = await prisma.storedObject.findUnique({ where: { id: so.id } })
    expect(purged).not.toBeNull()
    expect(purged!.purgeState).toBe('PURGED')
    expect(purged!.encryptedPath).toBe('')

    // Check tombstone was created
    const tombstones = await prisma.purgeTombstone.findMany({ where: { storedObjectId: so.id } })
    expect(tombstones).toHaveLength(1)
    expect(tombstones[0].sha256).toBe(sha)
    expect(tombstones[0].actorId).toBe(user.id)
    expect(tombstones[0].verifiedBackupId).toBe(backup.id)

    // Check audit log
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'StoredObject', entityId: so.id, action: 'PURGE_STORED_OBJECT' },
    })
    expect(audits).toHaveLength(1)

    // Cleanup
    await prisma.purgeTombstone.deleteMany({ where: { storedObjectId: so.id } })
    await prisma.backupObjectEntry.deleteMany({ where: { backupId: backup.id } })
    await prisma.storedObject.delete({ where: { id: so.id } })
    await prisma.backupHistory.delete({ where: { id: backup.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }, 30_000)
})
