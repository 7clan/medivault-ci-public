#!/usr/bin/env node
/**
 * migrate-legacy-plaintext.ts — Task 7b
 *
 * Migrates legacy plaintext documents to encrypted storage.
 * Finds all Document records where storedObjectId IS NULL AND filePath IS NOT NULL
 * (i.e., legacy documents that were stored as plaintext files).
 *
 * For each:
 *   1. Read the plaintext file from uploads/patients/{patientId}/{filePath}
 *   2. Hash it (computeHashFile / computeHashBuffer)
 *   3. Check if a StoredObject with that hash already exists (dedup)
 *   4. Encrypt it using EncryptedStorageService.storeStream()
 *   5. Create a StoredObject record (or link to existing)
 *   6. Link the Document to the StoredObject
 *   7. Verify by decrypting and comparing hashes
 *   8. Only after verification: delete the plaintext file
 *   9. Record success or failure
 *
 * Usage:
 *   npx tsx scripts/migrate-legacy-plaintext.ts              # Run migration
 *   npx tsx scripts/migrate-legacy-plaintext.ts --dry-run    # Report only
 *
 * Environment:
 *   MEDIVAULT_DATA_DIR    — encrypted storage directory (default: ./data)
 *   MEDIVAULT_MASTER_KEY  — 64-char hex master key (REQUIRED)
 *   DATABASE_URL          — PostgreSQL connection string
 */

import { PrismaClient } from '@prisma/client'
import { EncryptedStorageService, computeHashBuffer, isValidMasterKey } from '../packages/crypto/src'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

// ── Load .env if available (Prisma reads it, but shell env may override) ──
// Force DATABASE_URL from .env if the shell has a stale non-PostgreSQL value
import dotenv from 'dotenv'
dotenv.config()
if (!process.env.DATABASE_URL?.startsWith('postgresql://')) {
  // Try to read .env directly
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^DATABASE_URL=(.*)$/)
      if (match?.[1]?.startsWith('postgresql://')) {
        process.env.DATABASE_URL = match[1].trim()
        break
      }
    }
  }
}

// ── Types ───────────────────────────────────────────────────────

interface MigrationResult {
  docId: string
  fileName: string
  patientId: string
  status: 'migrated' | 'skipped' | 'failed'
  error?: string
  sha256?: string
  deduplicated?: boolean
  plaintextDeleted?: boolean
}

interface MigrationReport {
  totalFound: number
  migrated: number
  skipped: number
  failed: number
  plaintextFilesDeleted: number
  results: MigrationResult[]
  dryRun: boolean
}

// ── Helpers ────────────────────────────────────────────────────

function exit(msg: string, code = 1): never {
  console.error(`[migrate] ERROR: ${msg}`)
  process.exit(code)
}

function parseArgs(): { dryRun: boolean } {
  const args = process.argv.slice(2)
  return {
    dryRun: args.includes('--dry-run'),
  }
}

async function computeHashFile(filePath: string): Promise<Buffer> {
  const { createHash } = await import('node:crypto')
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (data: Buffer) => hash.update(data))
    stream.on('end', () => resolve(hash.digest()))
    stream.on('error', reject)
  })
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const { dryRun } = parseArgs()

  console.log('='.repeat(60))
  console.log('MediVault — Legacy Plaintext Migration')
  if (dryRun) {
    console.log('⚠  DRY RUN — no changes will be made')
  }
  console.log('='.repeat(60))

  // Validate MEDIVAULT_MASTER_KEY
  const masterKeyHex = process.env.MEDIVAULT_MASTER_KEY
  if (!masterKeyHex || !isValidMasterKey(masterKeyHex)) {
    exit('MEDIVAULT_MASTER_KEY environment variable is required and must be a 64-character hex string.')
  }

  // Setup paths
  const dataDir = process.env.MEDIVAULT_DATA_DIR || path.join(process.cwd(), 'data')
  const uploadsDir = path.join(process.cwd(), 'uploads', 'patients')

  // Initialize Prisma
  const db = new PrismaClient()

  // Initialize storage service
  const storage = new EncryptedStorageService({
    dataDirectory: dataDir,
    masterKeyHex,
  })

  const report: MigrationReport = {
    totalFound: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    plaintextFilesDeleted: 0,
    results: [],
    dryRun,
  }

  try {
    // Find all legacy plaintext documents
    // Legacy = storedObjectId IS NULL (not yet encrypted)
    // filePath is always non-null in the schema
    const legacyDocs = await db.document.findMany({
      where: {
        storedObjectId: null,
      },
      include: {
        patient: true,
      },
    })

    report.totalFound = legacyDocs.length

    if (legacyDocs.length === 0) {
      console.log('\nNo legacy plaintext documents found.\n')
      console.log('Migration report:')
      console.log(`  Total found:        ${report.totalFound}`)
      console.log(`  Migrated:           ${report.migrated}`)
      console.log(`  Skipped:             ${report.skipped}`)
      console.log(`  Failed:              ${report.failed}`)
      console.log(`  Plaintext deleted:   ${report.plaintextFilesDeleted}`)
      console.log('')
      await db.$disconnect()
      process.exit(0)
    }

    console.log(`\nFound ${legacyDocs.length} legacy plaintext document(s).\n`)

    for (const doc of legacyDocs) {
      const result: MigrationResult = {
        docId: doc.id,
        fileName: doc.fileName,
        patientId: doc.patientId,
        status: 'failed',
      }

      try {
        // Build plaintext file path
        const plainPath = path.join(uploadsDir, doc.patientId, doc.filePath)

        if (!fs.existsSync(plainPath)) {
          result.status = 'failed'
          result.error = `Plaintext file not found: ${plainPath}`
          report.results.push(result)
          report.failed++
          console.log(`  ✗ [${doc.id.substring(0, 8)}] ${doc.fileName} — ${result.error}`)
          continue
        }

        // Read and hash the plaintext file
        const plainBuffer = await fsp.readFile(plainPath)
        const { sha256 } = computeHashBuffer(plainBuffer)

        if (dryRun) {
          result.status = 'migrated'
          result.sha256 = sha256
          report.results.push(result)
          report.migrated++
          console.log(`  ○ [DRY] [${doc.id.substring(0, 8)}] ${doc.fileName} — sha256=${sha256.substring(0, 12)}...`)
          continue
        }

        // Check for existing StoredObject with same hash (dedup)
        let storedObject = await db.storedObject.findUnique({
          where: { sha256Hash: sha256 },
        })

        let deduplicated = false

        if (storedObject) {
          // File already encrypted — just link to existing StoredObject
          deduplicated = true
          console.log(`  ◇ [${doc.id.substring(0, 8)}] ${doc.fileName} — dedup (hash already exists)`)
        } else {
          // Encrypt the file
          const inputStream = Readable.from([plainBuffer])
          const storeResult = await storage.storeStream(
            inputStream,
            doc.fileName,
            doc.mimeType || 'application/octet-stream',
          )

          // Validate hash matches
          if (storeResult.sha256 !== sha256) {
            throw new Error(
              `Hash mismatch: computed=${sha256}, storage=${storeResult.sha256}`,
            )
          }

          // Create new StoredObject
          storedObject = await db.storedObject.create({
            data: {
              sha256Hash: storeResult.sha256,
              encryptedPath: storeResult.encryptedPath,
              plaintextSize: plainBuffer.length,
              encryptionFormatVersion: 3,
              keyId: storeResult.header.keyId,
              chunkSize: storeResult.chunkSize,
              chunkCount: storeResult.chunkCount,
              verifiedAt: new Date(),
            },
          })

          console.log(`  ◇ [${doc.id.substring(0, 8)}] ${doc.fileName} — encrypted, sha256=${sha256.substring(0, 12)}...`)
        }

        // Link Document to StoredObject
        await db.document.update({
          where: { id: doc.id },
          data: {
            storedObjectId: storedObject.id,
            sha256Hash: sha256,
          },
        })

        // Verify by decrypting
        const retrieveResult = await storage.retrieve(sha256)
        const chunks: Buffer[] = []
        for await (const chunk of retrieveResult.data) {
          chunks.push(Buffer.from(chunk))
        }
        const decrypted = Buffer.concat(chunks)

        if (Buffer.compare(decrypted, plainBuffer) !== 0) {
          throw new Error(
            'Verification failed: decrypted content does not match original',
          )
        }

        // Delete plaintext file only after successful verification
        try {
          await fsp.unlink(plainPath)
          result.plaintextDeleted = true
          report.plaintextFilesDeleted++
        } catch (unlinkErr) {
          // Non-fatal — document is migrated, plaintext deletion is best-effort
          console.log(`    ⚠ Could not delete plaintext file: ${(unlinkErr as Error).message}`)
        }

        result.status = 'migrated'
        result.sha256 = sha256
        result.deduplicated = deduplicated
        report.migrated++

      } catch (err) {
        result.status = 'failed'
        result.error = (err as Error).message
        report.failed++
        console.log(`  ✗ [${doc.id.substring(0, 8)}] ${doc.fileName} — ${result.error}`)
      }

      report.results.push(result)
    }

    // Print final report
    console.log('\n' + '─'.repeat(40))
    console.log('Migration report:')
    console.log(`  Total found:        ${report.totalFound}`)
    console.log(`  Migrated:           ${report.migrated}`)
    console.log(`  Skipped:             ${report.skipped}`)
    console.log(`  Failed:              ${report.failed}`)
    console.log(`  Plaintext deleted:   ${report.plaintextFilesDeleted}`)
    console.log('')

    // List failures
    const failures = report.results.filter(r => r.status === 'failed')
    if (failures.length > 0) {
      console.log('Failed documents:')
      for (const f of failures) {
        console.log(`  - ${f.fileName} (${f.docId.substring(0, 8)}): ${f.error}`)
      }
      console.log('')
    }

    // Exit with error if any failures
    if (report.failed > 0 && !dryRun) {
      await db.$disconnect()
      process.exit(1)
    }

  } catch (err) {
    exit(`Migration failed: ${(err as Error).message}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  exit(`Unexpected error: ${err.message}`)
})
