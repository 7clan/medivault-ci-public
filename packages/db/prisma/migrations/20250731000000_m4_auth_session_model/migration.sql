-- M4 Correction 3: AuthSession model + RefreshToken.authSessionId + Crypto pairing columns
-- STRICT migration: no IF NOT EXISTS / DO $$ guards

-- ─────────────────────────────────────────────
-- 1. Create "AuthSession" table
-- ─────────────────────────────────────────────

CREATE TABLE "AuthSession" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "deviceId"         TEXT,
    "familyId"         TEXT NOT NULL DEFAULT '',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "revokedAt"        TIMESTAMP(3),
    "revocationReason" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AuthSession_userId_idx"    ON "AuthSession"("userId");
CREATE INDEX "AuthSession_deviceId_idx"  ON "AuthSession"("deviceId");
CREATE INDEX "AuthSession_familyId_idx"  ON "AuthSession"("familyId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "AuthSession_revokedAt_idx" ON "AuthSession"("revokedAt");

-- ─────────────────────────────────────────────
-- 2. Add "authSessionId" to "RefreshToken"
-- ─────────────────────────────────────────────

ALTER TABLE "RefreshToken" ADD COLUMN "authSessionId" TEXT;

-- ─────────────────────────────────────────────
-- 3. Add "publicKey" to "DeviceRegistration"
-- ─────────────────────────────────────────────

ALTER TABLE "DeviceRegistration" ADD COLUMN "publicKey" TEXT;

-- ─────────────────────────────────────────────
-- 4. Add "challengeNonce" and "signature" to "DevicePairingCode"
-- ─────────────────────────────────────────────

ALTER TABLE "DevicePairingCode" ADD COLUMN "challengeNonce" TEXT;
ALTER TABLE "DevicePairingCode" ADD COLUMN "signature" TEXT;
