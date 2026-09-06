// @medivault/db — single entry-point for PrismaClient
// Re-exports the generated PrismaClient from @prisma/client.
// The Prisma client is generated from packages/db/prisma/schema.prisma.
// To regenerate: cd packages/db && DATABASE_URL=... npx prisma generate

export { PrismaClient } from '@prisma/client'
export * from '@prisma/client'
