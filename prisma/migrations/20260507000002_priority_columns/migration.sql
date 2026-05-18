-- Migration: priority_columns
--
-- Backfills priority and priorityRationale on PriorAuth. These columns were
-- added directly to the DB in an earlier phase (PA urgency field per
-- WORKFLOW.md priority guidance) without producing a migration file —
-- detected as drift when authoring 0004_smart_session in Phase 6.
--
-- IF NOT EXISTS guards keep this idempotent against DBs that already have
-- the columns. Same pattern as 0003_attachment_kind line 10 (the
-- simulatorNextTransitionAt baseline).

ALTER TABLE "PriorAuth" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "PriorAuth" ADD COLUMN IF NOT EXISTS "priorityRationale" TEXT;
