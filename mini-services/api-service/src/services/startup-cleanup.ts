/**
 * MediVault Fastify — Startup Cleanup Service
 *
 * Runs at server boot to clean up expired records and abandoned temp files.
 * - Deletes expired DeviceChallenge records
 * - Deletes expired, unused DevicePairingCode records
 * - Deletes abandoned temporary upload files (older than 1 hour)
 */

import type { PrismaClient } from '@medivault/db'
import type { Logger } from 'pino'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Run startup cleanup tasks.
 * Should be called once during server boot.
 *
 * @param db - Prisma client instance
 * @param logger - Pino logger instance
 */
export async function runStartupCleanup(
  db: PrismaClient,
  logger: Logger,
): Promise<void> {
  const now = new Date()

  try {
    // 1. Delete expired DeviceChallenge records
    const deletedChallenges = await db.deviceChallenge.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    })
    if (deletedChallenges.count > 0) {
      logger.info({ count: deletedChallenges.count }, 'Cleaned up expired DeviceChallenge records')
    }

    // 2. Delete expired, unused DevicePairingCode records
    const deletedPairingCodes = await db.devicePairingCode.deleteMany({
      where: {
        expiresAt: { lt: now },
        usedAt: null,
      },
    })
    if (deletedPairingCodes.count > 0) {
      logger.info({ count: deletedPairingCodes.count }, 'Cleaned up expired unused DevicePairingCode records')
    }

    // 3. Delete abandoned temporary upload files (older than 1 hour)
    const tempDir = process.env.MEDIVAULT_UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'medivault-uploads')
    let cleanedFiles = 0

    try {
      if (fs.existsSync(tempDir)) {
        const entries = await fs.promises.readdir(tempDir, { withFileTypes: true })
        const oneHourAgo = Date.now() - 60 * 60 * 1000

        for (const entry of entries) {
          if (!entry.isFile()) continue
          const filePath = path.join(tempDir, entry.name)
          try {
            const stat = await fs.promises.stat(filePath)
            if (stat.mtimeMs < oneHourAgo) {
              await fs.promises.unlink(filePath)
              cleanedFiles++
            }
          } catch {
            // File may have been deleted between stat and unlink
          }
        }
      }
    } catch (error) {
      logger.warn({ tempDir, error: error instanceof Error ? error.message : String(error) }, 'Failed to clean temp upload directory')
    }

    if (cleanedFiles > 0) {
      logger.info({ count: cleanedFiles, tempDir }, 'Cleaned up abandoned temp upload files')
    }

    logger.info('Startup cleanup completed')
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Startup cleanup failed',
    )
    // Don't fail startup — cleanup is best-effort
  }
}
