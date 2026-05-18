-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "publishStatus" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedBy" TEXT;

-- Backfill: mark all hand-curated Phase 1 demo policies as published so they
-- surface under both POLICY_SOURCE=demo AND POLICY_SOURCE=production.
-- All hand-curated seeds share the id prefix "policy-uhc-" (see prisma/seed/demoPolicies.ts).
-- AI-ingested policies (Phase 6 T6 onward) use a different id pattern and stay at default 'draft'.
UPDATE "Policy"
   SET "publishStatus" = 'published',
       "publishedAt"   = CURRENT_TIMESTAMP,
       "publishedBy"   = 'seed',
       "policyVersion" = 'phase-1-curated'
 WHERE id LIKE 'policy-uhc-%';
