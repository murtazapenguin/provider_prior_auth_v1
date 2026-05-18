-- CreateTable
CREATE TABLE "SmartSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "iss" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "idTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fhirUser" TEXT NOT NULL,
    "patientContext" TEXT,
    "encounterContext" TEXT,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SmartSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmartSession_sessionToken_key" ON "SmartSession"("sessionToken");

-- CreateIndex
CREATE INDEX "SmartSession_fhirUser_revokedAt_idx" ON "SmartSession"("fhirUser", "revokedAt");
