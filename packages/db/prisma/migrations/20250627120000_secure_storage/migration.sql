-- CreateTable: StoredObject
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "encryptedPath" TEXT NOT NULL,
    "plaintextSize" INTEGER NOT NULL,
    "encryptionFormatVersion" INTEGER NOT NULL DEFAULT 2,
    "keyId" TEXT,
    "chunkSize" INTEGER,
    "chunkCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_sha256Hash_key" ON "StoredObject"("sha256Hash");

-- CreateIndex
CREATE INDEX "StoredObject_createdAt_idx" ON "StoredObject"("createdAt");

-- AlterTable: Document
-- Make sha256Hash nullable (drop NOT NULL constraint and default)
ALTER TABLE "Document" ALTER COLUMN "sha256Hash" DROP NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "sha256Hash" DROP DEFAULT;

-- Add storedObjectId column to Document
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "storedObjectId" TEXT;

-- Drop encryptedFileName from Document
ALTER TABLE "Document" DROP COLUMN IF EXISTS "encryptedFileName";

-- Drop encryptionMetadata from Document
ALTER TABLE "Document" DROP COLUMN IF EXISTS "encryptionMetadata";

-- Add FK: Document.storedObjectId -> StoredObject.id ON DELETE SET NULL
ALTER TABLE "Document" ADD CONSTRAINT "Document_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Document_storedObjectId_idx" ON "Document"("storedObjectId");

-- AlterTable: DocumentVersion
-- Make sha256Hash nullable
ALTER TABLE "DocumentVersion" ALTER COLUMN "sha256Hash" DROP NOT NULL;
ALTER TABLE "DocumentVersion" ALTER COLUMN "sha256Hash" DROP DEFAULT;

-- Add storedObjectId column to DocumentVersion
ALTER TABLE "DocumentVersion" ADD COLUMN IF NOT EXISTS "storedObjectId" TEXT;

-- Drop encryptedFileName from DocumentVersion
ALTER TABLE "DocumentVersion" DROP COLUMN IF EXISTS "encryptedFileName";

-- Add FK: DocumentVersion.storedObjectId -> StoredObject.id ON DELETE SET NULL
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DocumentVersion_storedObjectId_idx" ON "DocumentVersion"("storedObjectId");

-- Backfill: convert empty string sha256Hash to NULL for legacy compatibility
UPDATE "Document" SET "sha256Hash" = NULL WHERE "sha256Hash" = '';
UPDATE "DocumentVersion" SET "sha256Hash" = NULL WHERE "sha256Hash" = '';
