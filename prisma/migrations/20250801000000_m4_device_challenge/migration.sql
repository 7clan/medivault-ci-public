-- M4: DeviceChallenge table — short-lived, single-use proof nonce for device-key login

CREATE TABLE "DeviceChallenge" (
    "id"        TEXT NOT NULL,
    "deviceId"  TEXT NOT NULL,
    "nonce"     TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceChallenge_nonce_key" ON "DeviceChallenge"("nonce");
CREATE INDEX "DeviceChallenge_deviceId_idx" ON "DeviceChallenge"("deviceId");
CREATE INDEX "DeviceChallenge_nonce_usedAt_idx" ON "DeviceChallenge"("nonce", "usedAt");
