#!/usr/bin/env node
/**
 * gc.ts — Task 5: Garbage Collection for MediVault
 *
 * Purges StoredObjects that have been pending deletion past their retention period.
 * Each candidate is checked for active references (Documents, DocumentVersions) and
 * for backup verification (verifiedAt) before being eligible for purge.
 *
 * Usage:
 *   npx tsx scripts/gc.ts --dry-run                        # Report only (default)
 *   npx tsx scripts/gc.ts --purge --actor-id <uuid>        # Actually purge
 *   npx tsx scripts/gc.ts --dry-run --retention-days 7     # Override retention days
 *   npx tsx scripts/gc.ts --dry-run --data-dir ./alt-data  # Override data directory
 *
 * Environment:
 *   DATABASE_URL          — PostgreSQL connection string
 *   MEDIVAULT_DATA_DIR    — encrypted storage directory (default: ./data)
 */

import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

// ── Types ───────────────────────────────────────────────────────

interface GCOptions {
  dryRun: boolean
  purge: boolean
  actorId: string | null
  retentionDays: number | null
  dataDir: string
}

interface GCSummary {
  totalCandidates: number
  skippedReferences: number
  skippedNotVerified: number
  purged: number
  failed: number
  bytesFreed: number
}

// ── Helpers ─────────────────────────────────────────────────────

function exit(msg: string, code = 1): never {
  console.error(`[gc] ERROR: ${msg}`)
  process.exit(code)
}

function parseArgs(): GCOptions {
  const args = process.argv.slice(2)
  const opts: GCOptions = {
    dryRun: true,
    purge: false,
    actorId: null,
    retentionDays: null,
    dataDir: process.env.MEDIVAULT_DATA_DIR || path.join(process.cwd(), 'data'),
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        opts.dryRun = true
        opts.purge = false
        break
      case '--purge':
        opts.purge = true
        opts.dryRun = false
        break
      case '--actor-id':
        i++
        if (!args[i]) exit('--actor-id requires a UUID value')
        opts.actorId = args[i]
        break
      case '--retention-days':
        i++
        if (!args[i]) exit('--retention-days requires a numeric value')
        const n = parseInt(args[i], 10)
        if (isNaN(n) || n < 0) exit('--retention-days must be a non-negative integer')
        opts.retentionDays = n
        break
      case '--data-dir':
        i++
        if (!args[i]) exit('--data-dir requires a path value')
        opts.dataDir = args[i]
        break
      case '--help':
      case '-h':
        printUsage()
        process.exit(0)
      default:
        exit(`Unknown argument: ${args[i]}`)
    }
  }

  if (!opts.dryRun && !opts.purge) {
    // Default to dry-run
    opts.dryRun = true
  }

  if (opts.purge && !opts.actorId) {
    exit('--purge requires --actor-id <uuid> for audit logging')
  }

  return opts
}

function printUsage(): void {
  console.log(`
MediVault Garbage Collection

Usage:
  npx tsx scripts/gc.ts --dry-run                        # Report only (default)
  npx tsx scripts/gc.ts --purge --actor-id <uuid>        # Actually purge objects

Options:
  --dry-run              Report what would be deleted without making changes (default)
  --purge                Actually delete objects and files
  --actor-id <uuid>      Actor UUID for audit log entries (required with --purge)
  --retention-days <N>   Override per-object retention days for expiry calculation
  --data-dir <path>      Override MEDIVAULT_DATA_DIR for file storage location
  --help, -h             Show this help message

Environment:
  DATABASE_URL           PostgreSQL connection string
  MEDIVAULT_DATA_DIR     Encrypted storage directory (default: ./data)
`)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400_000
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / msPerDay)
}

/**
 * Remove the prefix directory if it is now empty (best-effort).
 */
function cleanUpPrefixDir(prefixDir: string): void {
  try {
    const remaining = fs.readdirSync(prefixDir)
    if (remaining.length === 0) {
      fs.rmdirSync(prefixDir)
      console.log(`    Cleaned up empty prefix directory: ${prefixDir}`)
    }
  } catch {
    // Non-fatal: directory might not exist or might not be empty
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()

  console.log('='.repeat(60))
  console.log('MediVault — Garbage Collection')
  if (opts.dryRun) {
    console.log('DRY RUN — no changes will be made')
  } else {
    console.log('PURGE MODE — objects WILL be deleted')
  }
  console.log(`Data directory: ${opts.dataDir}`)
  if (opts.retentionDays !== null) {
    console.log(`Retention override: ${opts.retentionDays} days`)
  }
  console.log('='.repeat(60))

  // ── Validate DATABASE_URL ──
  if (!process.env.DATABASE_URL) {
    // Fallback to known URL
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
  }
  if (!process.env.DATABASE_URL.startsWith('postgresql://')) {
    exit('DATABASE_URL must be a PostgreSQL connection string.')
  }

  // ── Initialize Prisma ──
  const db = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  })

  const summary: GCSummary = {
    totalCandidates: 0,
    skippedReferences: 0,
    skippedNotVerified: 0,
    purged: 0,
    failed: 0,
    bytesFreed: 0,
  }

  try {
    const now = new Date()

    // ── Step 1: Find candidates ──
    // Fetch all StoredObjects with pendingDeletionAt set, then filter by retention expiry
    const candidates = await db.storedObject.findMany({
      where: {
        pendingDeletionAt: { not: null },
      },
    })

    // Filter by retention expiry in application code
    // Object is eligible if: pendingDeletionAt + retentionDays days < NOW()
    const eligible = candidates.filter((so) => {
      const retentionDays = opts.retentionDays ?? so.retentionDays
      const expiryDate = new Date(so.pendingDeletionAt!.getTime())
      expiryDate.setDate(expiryDate.getDate() + retentionDays)
      return expiryDate < now
    })

    summary.totalCandidates = eligible.length

    if (eligible.length === 0) {
      console.log('\nNo StoredObjects eligible for garbage collection.\n')
      printSummary(summary, opts.dryRun)
      await db.$disconnect()
      process.exit(0)
    }

    console.log(`\nFound ${eligible.length} StoredObject(s) past retention window.\n`)

    // ── Step 2: Process each candidate ──
    for (const so of eligible) {
      const label = `[${so.sha256Hash.substring(0, 12)}]`

      try {
        // 2a. Check for active Document references
        const activeDocCount = await db.document.count({
          where: {
            storedObjectId: so.id,
            deletedAt: null,
          },
        })

        // 2b. Check for DocumentVersion references
        const versionCount = await db.documentVersion.count({
          where: {
            storedObjectId: so.id,
          },
        })

        if (activeDocCount > 0 || versionCount > 0) {
          const refs: string[] = []
          if (activeDocCount > 0) refs.push(`${activeDocCount} active Document(s)`)
          if (versionCount > 0) refs.push(`${versionCount} DocumentVersion(s)`)
          console.warn(
            `  SKIP ${label} — has active references: ${refs.join(', ')}`,
          )
          summary.skippedReferences++
          continue
        }

        // Step 3: Verify backup requirement (verifiedAt must be set)
        if (!so.verifiedAt) {
          console.warn(
            `  SKIP ${label} — not verified (verifiedAt is NULL). Backup verification required before purge.`,
          )
          summary.skippedNotVerified++
          continue
        }

        // Compute age info
        const ageDays = daysBetween(so.pendingDeletionAt!, now)
        const retentionUsed = opts.retentionDays ?? so.retentionDays

        // Build the physical file path
        const prefix = so.sha256Hash.substring(0, 2)
        const filePath = path.join(opts.dataDir, 'objects', prefix, `${so.sha256Hash}.enc`)
        const prefixDir = path.join(opts.dataDir, 'objects', prefix)

        if (opts.dryRun) {
          console.log(
            `  WOULD PURGE ${label} — path=${filePath}, ` +
              `plaintextSize=${formatBytes(so.plaintextSize)}, ` +
              `pendingDeletionAt=${so.pendingDeletionAt!.toISOString()}, ` +
              `retentionDays=${retentionUsed}, ` +
              `age=${ageDays}d past deletion request`,
          )
          summary.purged++
          summary.bytesFreed += so.plaintextSize
          continue
        }

        // ── Purge mode ──

        // 4a. Delete the physical encrypted file
        try {
          fs.unlinkSync(filePath)
          console.log(`  DELETED file: ${filePath}`)
        } catch (fileErr) {
          // File might already be gone — log warning but continue
          const errMsg = (fileErr as Error).message
          if ((fileErr as NodeJS.ErrnoException).code === 'ENOENT') {
            console.warn(`    File not found (already removed): ${filePath}`)
          } else {
            throw new Error(`Failed to delete file ${filePath}: ${errMsg}`)
          }
        }

        // Clean up empty prefix directory
        cleanUpPrefixDir(prefixDir)

        // 4b. Delete the StoredObject DB record
        await db.storedObject.delete({
          where: { id: so.id },
        })

        // 4c. Create AuditLog entry
        await db.auditLog.create({
          data: {
            actorId: opts.actorId!,
            action: 'STORED_OBJECT_PURGED',
            entityType: 'StoredObject',
            entityId: so.id,
            details: {
              sha256: so.sha256Hash,
              encryptedPath: so.encryptedPath,
              plaintextSize: so.plaintextSize,
              reason: 'gc-purge',
            },
          },
        })

        console.log(
          `  PURGED ${label} — plaintextSize=${formatBytes(so.plaintextSize)}, ` +
            `age=${ageDays}d`,
        )
        summary.purged++
        summary.bytesFreed += so.plaintextSize

      } catch (err) {
        console.error(
          `  FAIL ${label} — ${(err as Error).message}`,
        )
        summary.failed++
      }
    }

    // ── Final report ──
    console.log('')
    printSummary(summary, opts.dryRun)

    // Exit with error code if any failures occurred in purge mode
    if (summary.failed > 0 && opts.purge) {
      await db.$disconnect()
      process.exit(1)
    }

  } catch (err) {
    exit(`GC failed: ${(err as Error).message}`)
  } finally {
    await db.$disconnect()
  }
}

function printSummary(summary: GCSummary, dryRun: boolean): void {
  console.log('─'.repeat(40))
  console.log('GC Summary:')
  console.log(`  Total candidates:              ${summary.totalCandidates}`)
  console.log(`  Skipped (active references):   ${summary.skippedReferences}`)
  console.log(`  Skipped (not verified):        ${summary.skippedNotVerified}`)
  console.log(`  ${dryRun ? 'Would purge' : 'Purged'}:                        ${summary.purged}`)
  console.log(`  Failed:                         ${summary.failed}`)
  console.log(`  ${dryRun ? 'Would free' : 'Bytes freed'}:                    ${formatBytes(summary.bytesFreed)}`)
  console.log('')
}

main().catch((err) => {
  exit(`Unexpected error: ${err.message}`)
})
