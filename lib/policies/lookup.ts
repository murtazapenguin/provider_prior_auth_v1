/**
 * findApplicablePolicies
 *
 * Resolves which Policy rows govern a given procedure/drug code under a
 * coverage tuple (payer + plan + POS).
 *
 * Algorithm (per POLICIES.md "The matching engine" step 1):
 *   1. Find all PolicyCode rows that match the code + codeType.
 *   2. Filter to policies belonging to the correct payer.
 *   3. Apply POS scoping — a code with posCodes=[] applies to all POS values;
 *      a code with a populated posCodes list only applies when posCode matches.
 *   4. Exclude policies whose effectiveTo has passed.
 *   5. Filter by Policy.publishStatus when POLICY_SOURCE=production (Phase 6
 *      policy-publishing feature flag — see Phase 6 T6 in ARCHITECTURE.md
 *      "Payer + policies"). When unset / 'demo', publishStatus is ignored so
 *      the demo path still surfaces every seeded policy. The 6 hand-curated
 *      `policy-uhc-*` rows were backfilled to publishStatus='published' by
 *      migration `0007_policy_publishing`, so they surface under BOTH modes
 *      (backward-compat for the demo regression). AI-ingested policies land
 *      at 'draft' by default and only escape into production-mode results
 *      after an admin publish in `app/(admin)/policies/[id]/publish/`.
 *   6. Return all matching Policy rows (with criteria and codes included).
 *      "Most-specific match wins" is enforced by the caller when it needs a
 *      single policy; returning all lets the match engine evaluate every
 *      applicable policy and merge via "most restrictive wins."
 */

import type { Prisma, PrismaClient } from '@/app/generated/prisma/client'

export interface CoverageLookup {
  payerId: string
  /** planName is accepted for future plan-level scoping but not yet used in
   *  the query — all demo policies are plan-agnostic within UHC.  Wire it
   *  when a plan-specific policy variant is needed. */
  planName?: string
}

export interface PolicyLookupArgs {
  codeType: string
  code: string
  coverage: CoverageLookup
  posCode?: string
}

export type PolicyWithDetails = Awaited<ReturnType<typeof findApplicablePolicies>>[number]

/**
 * Resolve the POLICY_SOURCE env flag.
 *
 * - 'production' → filter Policy by publishStatus='published'.
 * - anything else (default 'demo' / missing) → no publishStatus filter.
 *
 * The flag is read at call-time (not import-time) so tests can vary the
 * env between cases without re-importing the module.
 */
function resolvePolicySource(): 'production' | 'demo' {
  const raw = process.env.POLICY_SOURCE?.trim().toLowerCase()
  return raw === 'production' ? 'production' : 'demo'
}

export async function findApplicablePolicies(
  prisma: PrismaClient,
  args: PolicyLookupArgs
) {
  const { codeType, code, coverage, posCode } = args
  const now = new Date()
  const policySource = resolvePolicySource()

  // Load all policies for this payer that list the requested code.
  // We do the POS and date filtering in TypeScript after the query since
  // POS codes are stored as a string array and PostgreSQL array containment
  // would add query complexity without a real performance win on demo data.
  const where: Prisma.PolicyWhereInput = {
    payerId: coverage.payerId,
    applicableCodes: {
      some: {
        code: code.toUpperCase(),
        codeType: codeType.toUpperCase(),
      },
    },
    // effectiveTo = null means "no end date" (still in effect)
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    effectiveFrom: { lte: now },
  }

  // Phase 6 (T6): production-mode restricts to published policies only.
  // Demo mode keeps the prior behavior so the seeded hand-curated set is
  // visible end-to-end. The hand-curated rows were backfilled to
  // 'published' so they ALSO satisfy this filter — that is intentional
  // (see migration 0007_policy_publishing).
  if (policySource === 'production') {
    where.publishStatus = 'published'
  }

  const policies = await prisma.policy.findMany({
    where,
    include: {
      applicableCodes: true,
      criteria: {
        orderBy: { ordinal: 'asc' },
      },
    },
  })

  // Apply POS scoping: keep the policy if any of its codes for this
  // procedure either have no POS restriction, or include the requested POS.
  return policies.filter((policy) => {
    const matchingCode = policy.applicableCodes.find(
      (pc) =>
        pc.code.toUpperCase() === code.toUpperCase() &&
        pc.codeType.toUpperCase() === codeType.toUpperCase()
    )
    if (!matchingCode) return false

    // posCodes=[] means the code applies to all places of service.
    if (matchingCode.posCodes.length === 0) return true

    // If a specific POS was requested, it must be in the allowed list.
    if (posCode && matchingCode.posCodes.includes(posCode)) return true

    // No POS was requested — include the policy (conservative: pass it through).
    if (!posCode) return true

    return false
  })
}
