-- Add soft-delete retention fields to StoredObject
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "pendingDeletionAt" TIMESTAMP;
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "retentionDays" INTEGER NOT NULL DEFAULT 30;
