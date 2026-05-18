/**
 * POST /api/cron/policies-refresh
 *
 * Phase 7 — re-reads the canonical S3 policy markdown store and upserts
 * Policy / PolicyCode / PolicyCriterion rows. Runs every ~15 min on Vercel
 * (see vercel.json crons[]). Lookup queries continue to hit Postgres, so a
 * Clinical Informaticist editing a policy file in S3 → next cron tick →
 * Postgres → app reads change without a redeploy.
 *
 * Auth: Bearer-token via `CRON_SECRET` env var (same as /api/cron/sweep).
 * Idempotent: the seed loader upserts; re-running on the same S3 state is
 * a no-op.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { loadUhcPolicies } from '../../../../prisma/seed/uhcPolicies'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()

  // Force S3 source for the cron — the local mirror is dev-only.
  const prevSource = process.env.POLICIES_SOURCE
  process.env.POLICIES_SOURCE = 's3'

  try {
    const counts = await loadUhcPolicies(prisma)
    const durationMs = Date.now() - startedAt
    return NextResponse.json({
      refreshed: counts.policies,
      codes: counts.codes,
      criteria: counts.criteria,
      skipped: counts.skipped,
      source: counts.source,
      durationMs,
    })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { detail: `policies-refresh failed: ${message}`, durationMs },
      { status: 500 }
    )
  } finally {
    if (prevSource === undefined) delete process.env.POLICIES_SOURCE
    else process.env.POLICIES_SOURCE = prevSource
  }
}
