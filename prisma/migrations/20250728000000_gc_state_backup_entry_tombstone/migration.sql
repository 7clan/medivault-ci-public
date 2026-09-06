-- Migration: GC state machine, BackupObjectEntry, PurgeTombstone
-- Note: PurgeTombstone and GC fields on StoredObject may already exist from prior db push.
-- All statements are idempotent.

-- Add GC state machine fields to StoredObject
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "purgeState" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "backupVerifiedAt" TIMESTAMP(3);
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "verifiedBackupId" TEXT;
ALTER TABLE "StoredObject" ADD COLUMN IF NOT EXISTS "corruptionStatus" TEXT;

-- Add FK: StoredObject.verifiedBackupId -> BackupHistory.id ON DELETE SET NULL
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoredObject_verifiedBackupId_fkey') THEN
    ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_verifiedBackupId_fkey"
      FOREIGN KEY ("verifiedBackupId") REFERENCES "BackupHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoredObject_verifiedBackupId_idx" ON "StoredObject"("verifiedBackupId");

-- CreateTable: BackupObjectEntry (NEW — normalized backup manifest)
CREATE TABLE IF NOT EXISTS "BackupObjectEntry" (
    "id" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "storedObjectId" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "encryptedSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "checksumVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupObjectEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BackupObjectEntry_backupId_storedObjectId_key" ON "BackupObjectEntry"("backupId", "storedObjectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupObjectEntry_backupId_idx" ON "BackupObjectEntry"("backupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupObjectEntry_storedObjectId_idx" ON "BackupObjectEntry"("storedObjectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupObjectEntry_status_idx" ON "BackupObjectEntry"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupObjectEntry_verifiedAt_idx" ON "BackupObjectEntry"("verifiedAt");

-- Add FK: BackupObjectEntry.backupId -> BackupHistory.id ON DELETE CASCADE
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BackupObjectEntry_backupId_fkey') THEN
    ALTER TABLE "BackupObjectEntry" ADD CONSTRAINT "BackupObjectEntry_backupId_fkey"
      FOREIGN KEY ("backupId") REFERENCES "BackupHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Add FK: BackupObjectEntry.storedObjectId -> StoredObject.id ON DELETE RESTRICT
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BackupObjectEntry_storedObjectId_fkey') THEN
    ALTER TABLE "BackupObjectEntry" ADD CONSTRAINT "BackupObjectEntry_storedObjectId_fkey"
      FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateTable: PurgeTombstone (may already exist from prior db push)
CREATE TABLE IF NOT EXISTS "PurgeTombstone" (
    "id" TEXT NOT NULL,
    "storedObjectId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "verifiedBackupId" TEXT,
    "auditEventId" TEXT,
    "failureInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurgeTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "PurgeTombstone_storedObjectId_idx" ON "PurgeTombstone"("storedObjectId");
CREATE INDEX IF NOT EXISTS "PurgeTombstone_sha256_idx" ON "PurgeTombstone"("sha256");
CREATE INDEX IF NOT EXISTS "PurgeTombstone_purgedAt_idx" ON "PurgeTombstone"("purgedAt");

-- Add FK: PurgeTombstone.storedObjectId -> StoredObject.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurgeTombstone_storedObjectId_fkey') THEN
    ALTER TABLE "PurgeTombstone" ADD CONSTRAINT "PurgeTombstone_storedObjectId_fkey"
      FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Add FK: PurgeTombstone.verifiedBackupId -> BackupHistory.id ON DELETE SET NULL
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurgeTombstone_verifiedBackupId_fkey') THEN
    ALTER TABLE "PurgeTombstone" ADD CONSTRAINT "PurgeTombstone_verifiedBackupId_fkey"
      FOREIGN KEY ("verifiedBackupId") REFERENCES "BackupHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
