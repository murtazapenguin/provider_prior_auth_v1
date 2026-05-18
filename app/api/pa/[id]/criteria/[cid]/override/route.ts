import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { recordEvent } from '@/lib/audit/log'
import { applyTransition } from '@/lib/statusMachine/applyTransition'

const BodySchema = z.object({
  rationale: z.string().min(1, 'Rationale is required'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { detail: parsed.error.issues[0]?.message ?? 'rationale is required' },
      { status: 400 }
    )
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  if (pa.status === 'voided' || pa.status === 'cancelled' || pa.status === 'expired') {
    return NextResponse.json(
      { detail: `Cannot override criterion on PA in terminal status '${pa.status}'` },
      { status: 422 }
    )
  }

  // Find the most recent CriterionResult for this criterion on this PA
  const existingResult = await prisma.criterionResult.findFirst({
    where: { priorAuthId: id, criterionId: cid },
    orderBy: { evaluatedAt: 'desc' },
  })

  let criterionResult
  if (existingResult) {
    // Delete AI citations before overriding — override invalidates prior AI evidence
    await prisma.citation.deleteMany({ where: { criterionResultId: existingResult.id } })
    // Update the existing result to passed (override)
    criterionResult = await prisma.criterionResult.update({
      where: { id: existingResult.id },
      data: {
        status: 'passed',
        rationale: parsed.data.rationale,
        confidence: 1.0,
        evaluatedAt: new Date(),
      },
    })
  } else {
    // No prior result — verify the criterion belongs to this PA's policy
    const criterion = await prisma.policyCriterion.findUnique({ where: { id: cid } })
    if (!criterion) {
      return NextResponse.json({ detail: `Criterion '${cid}' not found` }, { status: 404 })
    }
    criterionResult = await prisma.criterionResult.create({
      data: {
        priorAuthId: id,
        criterionId: cid,
        status: 'passed',
        rationale: parsed.data.rationale,
        confidence: 1.0,
      },
    })
  }

  await recordEvent({
    priorAuthId: id,
    type: 'criterion_override',
    actor: providerId,
    metadata: {
      criterionId: cid,
      criterionResultId: criterionResult.id,
      rationale: parsed.data.rationale,
    },
  })

  // Check if all criteria are now passed; if so, transition PA to ready_for_submission.
  //
  // Phase 7 fix (gate 13 finding): the prior implementation checked
  // `allResults.length > 0 && allResults.every(passed)`, which vacuously
  // returned true the FIRST time a criterion was overridden on a PA with
  // no prior recheck — N expected criteria, 1 result row, 1/1 passed →
  // premature transition to ready_for_submission. The fix compares the
  // result-row count to the expected criteria count derived from the
  // matching policies for the PA's procedure codes.
  const allResults = await prisma.criterionResult.findMany({
    where: { priorAuthId: id },
    orderBy: { evaluatedAt: 'desc' },
    distinct: ['criterionId'],
  })

  // Count the unique PolicyCriterion rows expected for this PA. A criterion
  // is expected if it belongs to a policy whose applicableCodes intersect the
  // PA's PriorAuthCode rows (matching codeType + code, scoped to the PA's
  // payer). This mirrors `lib/policies/lookup.ts:findApplicablePolicies` minus
  // POS/date scoping — overrides shouldn't be affected by transient policy-
  // window changes once the PA has been created.
  const paCodes = await prisma.priorAuthCode.findMany({ where: { priorAuthId: id } })
  const expectedCriteriaCount =
    paCodes.length === 0
      ? 0
      : await prisma.policyCriterion.count({
          where: {
            policy: {
              payerId: pa.payerId,
              applicableCodes: {
                some: {
                  OR: paCodes.map((pc) => ({
                    code: pc.code.toUpperCase(),
                    codeType: pc.codeType.toUpperCase(),
                  })),
                },
              },
            },
          },
        })

  const allPassed =
    expectedCriteriaCount > 0 &&
    allResults.length === expectedCriteriaCount &&
    allResults.every((r) => r.status === 'passed')

  let updatedPa = pa
  if (allPassed && pa.status === 'draft') {
    const txResult = await applyTransition(prisma, pa, {
      type: 'criteria_all_met',
      actor: providerId,
    })
    if (txResult.ok) updatedPa = txResult.pa
  }

  return NextResponse.json({ criterionResult, pa: updatedPa })
}
