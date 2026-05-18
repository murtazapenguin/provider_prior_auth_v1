/**
 * app/(admin)/policies/[id]/publish/route.ts
 *
 * POST handler that flips `Policy.publishStatus` from 'draft' to
 * 'published'. The Phase 6 admin UI's only mutation surface.
 *
 *   - 400  body is not a valid object   (zod parse failure)
 *   - 401  no valid SmartSession         (getCurrentSession returned null)
 *   - 404  policy id does not exist
 *   - 409  policy is not currently 'draft' (idempotency guard)
 *   - 200  publish succeeded
 *
 * Response shape follows the Phase 6 canonical:
 *   error  → { error: { code, message, details? } }
 *   success → { ok: true, policy: { id, publishStatus, publishedAt, publishedBy, policyVersion } }
 *
 * TC-IDs covered:
 *   - WF-INF-policy-review (publish is the operator action)
 *   - WF-INF-trigger-rescrape (manual trigger surface; the actual rescrape
 *     mechanism lives in the ai-engineer counterpart's
 *     services/ai/policy_rescrape.py)
 *
 * Note: form-style POSTs from the detail page may send no body at all. The
 * BodySchema accepts an empty / nullish body (everything is optional) so
 * those requests pass validation.
 *
 * TODO(phase-6-compliance): NO RBAC YET — any authenticated provider can
 * publish. Add an admin-role check (e.g. `assertAdmin(session)`) before
 * production. Today the only gate is `getCurrentSession()` returning a
 * non-null SmartSession. The Phase 6 compliance ticket will plug this gap.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getCurrentSession } from '@/lib/smart/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Body is optional. Future fields (e.g. a freeform `note`) can be added
// without breaking existing form POSTs.
const BodySchema = z
  .object({
    note: z.string().max(2000).optional(),
  })
  .optional()

interface RouteContext {
  params: Promise<{ id: string }>
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  )
}

async function parseBody(request: Request): Promise<unknown> {
  // form POSTs from the admin UI are application/x-www-form-urlencoded with
  // an empty body; JSON callers send `application/json`. Either is fine —
  // we only care whether the body parses to an object we can validate.
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (contentType.includes('application/json')) {
    try {
      return await request.json()
    } catch {
      return null
    }
  }
  // For form-encoded or empty bodies, treat as no payload.
  try {
    const text = await request.text()
    if (!text.trim()) return undefined
    const params = new URLSearchParams(text)
    const obj: Record<string, string> = {}
    for (const [k, v] of params) obj[k] = v
    return obj
  } catch {
    return undefined
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  // A browser form POST from the admin detail page should land back on a
  // page, not raw JSON; JSON API callers expect the JSON envelope. Detect
  // which before the body is consumed.
  const isJsonRequest = (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .includes('application/json')

  // 1. Validate input first (hard rule for every route).
  const rawBody = await parseBody(request)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return errorResponse(400, 'bad_request', 'Invalid request body', {
      issues: parsed.error.issues,
    })
  }

  // 2. Authentication. NO RBAC — see TODO(phase-6-compliance) above.
  const session = await getCurrentSession()
  if (!session) {
    return errorResponse(401, 'unauthorized', 'A valid session is required')
  }

  const { id } = await ctx.params
  if (!id) {
    return errorResponse(400, 'bad_request', 'Missing policy id')
  }

  // 3. Look up the policy (we need to verify state before mutating).
  const existing = await prisma.policy.findUnique({
    where: { id },
    select: { id: true, publishStatus: true },
  })
  if (!existing) {
    return errorResponse(404, 'not_found', `Policy '${id}' not found`)
  }

  // 4. Only 'draft' is a valid source state for publishing. Reject anything
  //    else (idempotency / footgun guard — re-publishing already-published
  //    rows would silently rotate `publishedAt` and `publishedBy`).
  if (existing.publishStatus !== 'draft') {
    return errorResponse(
      409,
      'invalid_state',
      `Policy '${id}' is not in 'draft' status (currently '${existing.publishStatus}'). ` +
        `Only draft policies can be published.`,
      { currentStatus: existing.publishStatus },
    )
  }

  // 5. Flip the state. publishedAt/publishedBy are set in one update so the
  //    row is internally consistent. policyVersion is left untouched; the
  //    seeded backfill set it on Phase 1 rows and AI ingestion will set it
  //    on future rows.
  const updated = await prisma.policy.update({
    where: { id },
    data: {
      publishStatus: 'published',
      publishedAt: new Date(),
      // TODO(phase-6-compliance): NO RBAC YET — the publisher is whoever
      // holds the current SmartSession's fhirUser. Add admin-role check
      // before production so non-admins cannot reach this code path.
      publishedBy: session.fhirUser,
    },
    select: {
      id: true,
      publishStatus: true,
      publishedAt: true,
      publishedBy: true,
      policyVersion: true,
    },
  })

  // Form POST from the admin detail page → redirect back to the (now-
  // published) detail page so the browser shows the refreshed view instead
  // of rendering raw JSON. 303 forces the follow-up request to GET. JSON API
  // callers still receive the JSON envelope.
  if (!isJsonRequest) {
    return NextResponse.redirect(new URL(`/policies/${id}`, request.url), 303)
  }

  return NextResponse.json({ ok: true, policy: updated }, { status: 200 })
}
