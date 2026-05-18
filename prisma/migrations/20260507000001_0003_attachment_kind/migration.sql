-- Migration 0003_attachment_kind
--
-- Covers two changes:
-- 1. Attachment.kind discriminator (new) — "upload" | "submission_packet" | "rfi_response"
-- 2. PriorAuth.simulatorNextTransitionAt (baseline) — was added directly to the DB
--    in Phase 2 without a migration file. The IF NOT EXISTS guard ensures this is
--    idempotent when run against a DB that already has the column.

-- PriorAuth simulator field (baseline — already in DB from Phase 2)
ALTER TABLE "PriorAuth" ADD COLUMN IF NOT EXISTS "simulatorNextTransitionAt" TIMESTAMP(3);

-- Attachment kind discriminator (new)
ALTER TABLE "Attachment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'upload';

-- Compound index for fetching latest submission_packet per PA
CREATE INDEX "Attachment_priorAuthId_kind_uploadedAt_idx"
    ON "Attachment"("priorAuthId", "kind", "uploadedAt");
