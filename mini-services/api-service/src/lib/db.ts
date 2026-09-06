/**
 * MediVault Fastify — Database Client
 *
 * Creates a singleton PrismaClient instance for use across the Fastify service.
 * In development mode, caches on globalThis to survive HMR.
 */

import { PrismaClient } from '@medivault/db'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

/**
 * Gracefully disconnect the Prisma client.
 * Call during server shutdown.
 */
export async function disconnectDb(): Promise<void> {
  try {
    await db.$disconnect()
  } catch (error) {
    console.error('[MediVault] Error disconnecting from database:', error)
  }
}
