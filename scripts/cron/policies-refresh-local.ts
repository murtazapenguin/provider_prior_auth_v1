/**
 * scripts/cron/policies-refresh-local.ts
 *
 * Local-dev equivalent of the Vercel cron tick. Invokes the same loader
 * the production cron uses, so a developer can edit a policy in S3 (or
 * locally + push) and immediately see Postgres pick it up — no Vercel
 * involvement required.
 *
 * Usage:
 *   pnpm tsx scripts/cron/policies-refresh-local.ts
 *
 * Reads:
 *   - DATABASE_URL                 (Postgres connection)
 *   - POLICIES_SOURCE              (s3 | local | both; default: s3 here)
 *   - S3_POLICIES_BUCKET           (fallback: S3_OCR_STAGING_BUCKET)
 *   - S3_POLICIES_KEY_PREFIX       (default: policies/uhc/)
 *   - AWS_REGION / AWS_*           (boto/aws-sdk client config)
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), 'services/ai/.env') })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../app/generated/prisma/client'
import { loadUhcPolicies } from '../../prisma/seed/uhcPolicies'

async function main() {
  // Force S3 for local runs (the cron's real job).
  process.env.POLICIES_SOURCE = process.env.POLICIES_SOURCE ?? 's3'

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  const started = Date.now()
  try {
    const counts = await loadUhcPolicies(prisma)
    const ms = Date.now() - started
    console.log(
      `✓ policies-refresh: ${counts.policies} policies, ${counts.codes} codes, ` +
        `${counts.criteria} criteria, ${counts.skipped} skipped ` +
        `(source=${counts.source}, ${ms}ms)`
    )
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ policies-refresh failed:', err)
  process.exit(1)
})
