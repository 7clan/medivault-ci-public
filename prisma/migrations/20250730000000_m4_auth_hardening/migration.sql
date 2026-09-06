-- M4 Correction: Auth hardening — session versioning, token families, device pairing, mustChangePassword
-- Idempotent: safe to re-run against a dev DB that may already have some of these.

-- ─────────────────────────────────────────────
-- 1. Add "sessionVersion" to "User" (session invalidation)
-- ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'User'
      AND column_name  = 'sessionVersion'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. Add "mustChangePassword" to "User" (admin reset flow)
-- ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'User'
      AND column_name  = 'mustChangePassword'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 3. Add token-family columns to "RefreshToken"
-- ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'RefreshToken'
      AND column_name  = 'familyId'
  ) THEN
    ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'RefreshToken'
      AND column_name  = 'parentTokenId'
  ) THEN
    ALTER TABLE "RefreshToken" ADD COLUMN "parentTokenId" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'RefreshToken'
      AND column_name  = 'replacedByTokenId'
  ) THEN
    ALTER TABLE "RefreshToken" ADD COLUMN "replacedByTokenId" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'RefreshToken'
      AND column_name  = 'usedAt'
  ) THEN
    ALTER TABLE "RefreshToken" ADD COLUMN "usedAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'RefreshToken'
      AND column_name  = 'revocationReason'
  ) THEN
    ALTER TABLE "RefreshToken" ADD COLUMN "revocationReason" TEXT;
  END IF;
END $$;

-- Index on familyId for fast family revocation
CREATE INDEX IF NOT EXISTS "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- ─────────────────────────────────────────────
-- 4. Create "DevicePairingCode" table
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "DevicePairingCode" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "code"       TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL DEFAULT '',
    "deviceName" TEXT NOT NULL DEFAULT '',
    "deviceType" TEXT NOT NULL DEFAULT '',
    "platform"   TEXT,
    "appVersion" TEXT,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "usedAt"     TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePairingCode_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'DevicePairingCode_userId_fkey'
      AND table_name        = 'DevicePairingCode'
  ) THEN
    ALTER TABLE "DevicePairingCode" ADD CONSTRAINT "DevicePairingCode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'DevicePairingCode_approvedBy_fkey'
      AND table_name        = 'DevicePairingCode'
  ) THEN
    ALTER TABLE "DevicePairingCode" ADD CONSTRAINT "DevicePairingCode_approvedBy_fkey"
      FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "DevicePairingCode_code_idx"      ON "DevicePairingCode"("code");
CREATE INDEX IF NOT EXISTS "DevicePairingCode_userId_idx"    ON "DevicePairingCode"("userId");
CREATE INDEX IF NOT EXISTS "DevicePairingCode_expiresAt_idx" ON "DevicePairingCode"("expiresAt");
