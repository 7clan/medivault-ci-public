-- M4: Auth Session & Device — add failed login tracking, account lockout, RefreshToken table
-- Idempotent: safe to re-run against a dev DB that may already have some of these.

-- ─────────────────────────────────────────────
-- 1. Add columns to "User"
-- ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'User'
      AND column_name  = 'failedLoginAttempts'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'User'
      AND column_name  = 'lockedUntil'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. Create "RefreshToken" table
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id"        TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "deviceId"  TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (idempotent with DO $$ blocks)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'RefreshToken_userId_fkey'
      AND table_name        = 'RefreshToken'
  ) THEN
    ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'RefreshToken_deviceId_fkey'
      AND table_name        = 'RefreshToken'
  ) THEN
    ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "DeviceRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes (idempotent with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx"    ON "RefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "RefreshToken_deviceId_idx"  ON "RefreshToken"("deviceId");
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
