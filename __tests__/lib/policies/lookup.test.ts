/**
 * __tests__/lib/policies/lookup.test.ts
 *
 * Unit tests for findApplicablePolicies (Phase 6 / T6 — POLICY_SOURCE flag).
 *
 * Coverage:
 *   1. POLICY_SOURCE=demo (default) — no publishStatus filter; all seeded
 *      hand-curated policies surface.
 *   2. POLICY_SOURCE=production — publishStatus='published' is added to the
 *      WHERE; because migration 0007 backfilled the 6 hand-curated rows to
 *      'published', they still surface (backward-compat regression).
 *   3. Unset / missing env var — behaves like 'demo' (no filter).
 *   4. AI-ingested draft policies are excluded under 'production' but
 *      visible under 'demo'.
 *   5. POS scoping + effective-date filtering still works regardless of
 *      POLICY_SOURCE (we don't want the new branch to regress existing
 *      filter logic).
 *
 * Strategy: inject a mock PrismaClient whose `policy.findMany` records the
 * `where` clause it received, and returns canned policy rows so the
 * TypeScript-side POS filter still runs end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The `@/lib/db/client` mock keeps the Prisma singleton from initializing
// during test imports. We never call into the real singleton anyway.
vi.mock('@/lib/db/client', () => ({
  prisma: {},
}))

import { findApplicablePolicies } from '@/lib/policies/lookup'

// ─── Fixture helpers ────────────────────────────────────────────────────────

interface FakePolicy {
  id: string
  payerId: string
  policyType: string
  externalId: string | null
  title: string
  effectiveFrom: Date
  effectiveTo: Date | null
  sourceUrl: string | null
  sourceText: string | null
  pageImages: unknown
  publishStatus: string
  publishedAt: Date | null
  publishedBy: string | null
  policyVersion: string | null
  applicableCodes: Array<{
    id: string
    policyId: string
    codeType: string
    code: string
    modifier: string | null
    posCodes: string[]
  }>
  criteria: unknown[]
}

const fixedNow = new Date('2026-05-12T12:00:00Z')

function buildPolicy(overrides: Partial<FakePolicy> & { id: string }): FakePolicy {
  return {
    payerId: 'payer-uhc',
    policyType: 'Medical Policy',
    externalId: null,
    title: overrides.id,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    sourceUrl: null,
    sourceText: null,
    pageImages: null,
    publishStatus: 'published',
    publishedAt: null,
    publishedBy: null,
    policyVersion: null,
    applicableCodes: [
      {
        id: `${overrides.id}-pc-1`,
        policyId: overrides.id,
        codeType: 'CPT',
        code: '70450',
        modifier: null,
        posCodes: [],
      },
    ],
    criteria: [],
    ...overrides,
  }
}

const HAND_CURATED_HEAD_CT = buildPolicy({
  id: 'policy-uhc-evicore-head-ct',
  title: 'Head CT (eviCore)',
  publishStatus: 'published',
  publishedAt: new Date('2026-05-12T11:00:00Z'),
  publishedBy: 'seed',
  policyVersion: 'phase-1-curated',
})

const AI_DRAFT_HEAD_CT = buildPolicy({
  id: 'policy-uhc-ai-head-ct-draft',
  title: 'Head CT (AI-ingested draft)',
  publishStatus: 'draft',
  policyVersion: null,
})

// ─── Mock Prisma factory ────────────────────────────────────────────────────

interface MockPrismaCall {
  args: { where?: Record<string, unknown> } & Record<string, unknown>
}

function buildMockPrisma(allPolicies: FakePolicy[]): {
  prisma: unknown
  calls: MockPrismaCall[]
} {
  const calls: MockPrismaCall[] = []
  const findMany = vi
    .fn()
    .mockImplementation(async (args: MockPrismaCall['args']) => {
      calls.push({ args })
      const where = args.where ?? {}
      return allPolicies.filter((p) => {
        if (where.payerId && p.payerId !== where.payerId) return false
        if (typeof where.publishStatus === 'string') {
          if (p.publishStatus !== where.publishStatus) return false
        }
        // We don't simulate the codeType/code/effectiveFrom/effectiveTo
        // server-side filtering exactly — the unit test only needs to
        // confirm the WHERE clause shape AND that the function returned
        // the seeded rows. The TypeScript-side POS filter is exercised
        // by the dedicated POS test below.
        return true
      })
    })
  return {
    prisma: { policy: { findMany } },
    calls,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('findApplicablePolicies — POLICY_SOURCE flag (Phase 6 / T6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('POLICY_SOURCE=demo: no publishStatus filter — surfaces hand-curated policies', async () => {
    vi.stubEnv('POLICY_SOURCE', 'demo')

    const { prisma, calls } = buildMockPrisma([HAND_CURATED_HEAD_CT])

    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(result.map((p) => p.id)).toEqual(['policy-uhc-evicore-head-ct'])
    expect(calls).toHaveLength(1)
    expect(calls[0].args.where).not.toHaveProperty('publishStatus')
  })

  it('POLICY_SOURCE missing: defaults to demo — no publishStatus filter applied', async () => {
    vi.stubEnv('POLICY_SOURCE', '')

    const { prisma, calls } = buildMockPrisma([
      HAND_CURATED_HEAD_CT,
      AI_DRAFT_HEAD_CT,
    ])
    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(result.map((p) => p.id).sort()).toEqual(
      ['policy-uhc-ai-head-ct-draft', 'policy-uhc-evicore-head-ct'].sort(),
    )
    expect(calls[0].args.where).not.toHaveProperty('publishStatus')
  })

  it('POLICY_SOURCE=production: adds publishStatus=published filter', async () => {
    vi.stubEnv('POLICY_SOURCE', 'production')

    const { prisma, calls } = buildMockPrisma([HAND_CURATED_HEAD_CT])

    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    // Hand-curated rows were backfilled to 'published' — backward-compat win.
    expect(result.map((p) => p.id)).toEqual(['policy-uhc-evicore-head-ct'])
    expect(calls[0].args.where?.publishStatus).toBe('published')
  })

  it('POLICY_SOURCE=production excludes draft policies (AI-ingested) but keeps hand-curated published rows', async () => {
    vi.stubEnv('POLICY_SOURCE', 'production')

    const { prisma } = buildMockPrisma([HAND_CURATED_HEAD_CT, AI_DRAFT_HEAD_CT])

    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(result.map((p) => p.id)).toEqual(['policy-uhc-evicore-head-ct'])
    expect(result).toHaveLength(1)
  })

  it('POLICY_SOURCE=demo includes both hand-curated AND AI-ingested drafts', async () => {
    vi.stubEnv('POLICY_SOURCE', 'demo')

    const { prisma } = buildMockPrisma([HAND_CURATED_HEAD_CT, AI_DRAFT_HEAD_CT])

    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(result.map((p) => p.id).sort()).toEqual(
      ['policy-uhc-ai-head-ct-draft', 'policy-uhc-evicore-head-ct'].sort(),
    )
  })

  it('case-insensitive: POLICY_SOURCE=Production also activates the filter', async () => {
    vi.stubEnv('POLICY_SOURCE', 'Production')

    const { prisma, calls } = buildMockPrisma([HAND_CURATED_HEAD_CT])
    await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(calls[0].args.where?.publishStatus).toBe('published')
  })

  it('garbage POLICY_SOURCE value falls back to demo (no filter)', async () => {
    vi.stubEnv('POLICY_SOURCE', 'banana')

    const { prisma, calls } = buildMockPrisma([HAND_CURATED_HEAD_CT])
    await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    expect(calls[0].args.where).not.toHaveProperty('publishStatus')
  })
})

describe('findApplicablePolicies — backward-compat (POS + dates) regression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('POS filter passes through under POLICY_SOURCE=demo', async () => {
    vi.stubEnv('POLICY_SOURCE', 'demo')

    const policyA = buildPolicy({
      id: 'policy-pos-restricted',
      applicableCodes: [
        {
          id: 'pc-pos-1',
          policyId: 'policy-pos-restricted',
          codeType: 'CPT',
          code: '70450',
          modifier: null,
          posCodes: ['11'],
        },
      ],
    })
    const policyB = buildPolicy({
      id: 'policy-any-pos',
      applicableCodes: [
        {
          id: 'pc-any-1',
          policyId: 'policy-any-pos',
          codeType: 'CPT',
          code: '70450',
          modifier: null,
          posCodes: [],
        },
      ],
    })

    const { prisma } = buildMockPrisma([policyA, policyB])
    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
      posCode: '22',
    })

    // policy-pos-restricted has posCodes=['11'] which excludes '22'.
    // policy-any-pos has posCodes=[] (applies anywhere) — should survive.
    expect(result.map((p) => p.id)).toEqual(['policy-any-pos'])
  })

  it('POS filter still works the same way under POLICY_SOURCE=production', async () => {
    vi.stubEnv('POLICY_SOURCE', 'production')

    const policyA = buildPolicy({
      id: 'policy-uhc-pos-restricted-published',
      publishStatus: 'published',
      applicableCodes: [
        {
          id: 'pc-pos-2',
          policyId: 'policy-uhc-pos-restricted-published',
          codeType: 'CPT',
          code: '70450',
          modifier: null,
          posCodes: ['11'],
        },
      ],
    })
    const policyB = buildPolicy({
      id: 'policy-uhc-any-pos-published',
      publishStatus: 'published',
      applicableCodes: [
        {
          id: 'pc-any-2',
          policyId: 'policy-uhc-any-pos-published',
          codeType: 'CPT',
          code: '70450',
          modifier: null,
          posCodes: [],
        },
      ],
    })

    const { prisma } = buildMockPrisma([policyA, policyB])
    const result = await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
      posCode: '22',
    })

    expect(result.map((p) => p.id)).toEqual(['policy-uhc-any-pos-published'])
  })

  it('passes effectiveFrom/effectiveTo to the WHERE clause as before', async () => {
    vi.stubEnv('POLICY_SOURCE', 'production')

    const { prisma, calls } = buildMockPrisma([HAND_CURATED_HEAD_CT])
    await findApplicablePolicies(prisma as never, {
      codeType: 'CPT',
      code: '70450',
      coverage: { payerId: 'payer-uhc' },
    })

    const where = calls[0].args.where!
    expect(where).toHaveProperty('payerId', 'payer-uhc')
    expect(where).toHaveProperty('effectiveFrom')
    // The OR clause for effectiveTo is what the existing code emits — make
    // sure the new branch didn't accidentally drop it.
    expect(where).toHaveProperty('OR')
  })
})

// ─── Phase 4 demo regression: each scenario must resolve under BOTH modes ──
//
// The 6 hand-curated demo policies were backfilled to 'published' by
// migration 0007_policy_publishing, so any of them MUST surface whether the
// flag is set or not. This protects the demo flow (Head CT, Knee MRI,
// Botox, Power Wheelchair, Stelara, IOP behavioral health) from regressing
// when POLICY_SOURCE=production is enabled in production environments.

describe('findApplicablePolicies — Phase 4 demo regression under both modes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const demoSeedRows: FakePolicy[] = [
    buildPolicy({
      id: 'policy-uhc-evicore-head-ct',
      publishStatus: 'published',
      publishedBy: 'seed',
      policyVersion: 'phase-1-curated',
      applicableCodes: [
        {
          id: 'pc-headct',
          policyId: 'policy-uhc-evicore-head-ct',
          codeType: 'CPT',
          code: '70450',
          modifier: null,
          posCodes: [],
        },
      ],
    }),
    buildPolicy({
      id: 'policy-uhc-knee-mri',
      publishStatus: 'published',
      publishedBy: 'seed',
      policyVersion: 'phase-1-curated',
      applicableCodes: [
        {
          id: 'pc-kneemri',
          policyId: 'policy-uhc-knee-mri',
          codeType: 'CPT',
          code: '73721',
          modifier: null,
          posCodes: [],
        },
      ],
    }),
    buildPolicy({
      id: 'policy-uhc-botox',
      publishStatus: 'published',
      publishedBy: 'seed',
      policyVersion: 'phase-1-curated',
      applicableCodes: [
        {
          id: 'pc-botox',
          policyId: 'policy-uhc-botox',
          codeType: 'HCPCS',
          code: 'J0585',
          modifier: null,
          posCodes: [],
        },
      ],
    }),
    buildPolicy({
      id: 'policy-uhc-power-wheelchair',
      publishStatus: 'published',
      publishedBy: 'seed',
      policyVersion: 'phase-1-curated',
      applicableCodes: [
        {
          id: 'pc-pwc',
          policyId: 'policy-uhc-power-wheelchair',
          codeType: 'HCPCS',
          code: 'K0856',
          modifier: null,
          posCodes: [],
        },
      ],
    }),
  ]

  const demoScenarios: Array<{ name: string; codeType: string; code: string; expectedPolicyId: string }> = [
    { name: 'Head CT', codeType: 'CPT', code: '70450', expectedPolicyId: 'policy-uhc-evicore-head-ct' },
    { name: 'Knee MRI', codeType: 'CPT', code: '73721', expectedPolicyId: 'policy-uhc-knee-mri' },
    { name: 'Botox', codeType: 'HCPCS', code: 'J0585', expectedPolicyId: 'policy-uhc-botox' },
    { name: 'Power Wheelchair', codeType: 'HCPCS', code: 'K0856', expectedPolicyId: 'policy-uhc-power-wheelchair' },
  ]

  for (const scenario of demoScenarios) {
    it(`${scenario.name}: resolves under POLICY_SOURCE=demo`, async () => {
      vi.stubEnv('POLICY_SOURCE', 'demo')
      const { prisma } = buildMockPrisma(demoSeedRows)
      const result = await findApplicablePolicies(prisma as never, {
        codeType: scenario.codeType,
        code: scenario.code,
        coverage: { payerId: 'payer-uhc' },
      })
      expect(result.map((p) => p.id)).toContain(scenario.expectedPolicyId)
    })

    it(`${scenario.name}: resolves under POLICY_SOURCE=production (backfill regression)`, async () => {
      vi.stubEnv('POLICY_SOURCE', 'production')
      const { prisma } = buildMockPrisma(demoSeedRows)
      const result = await findApplicablePolicies(prisma as never, {
        codeType: scenario.codeType,
        code: scenario.code,
        coverage: { payerId: 'payer-uhc' },
      })
      expect(result.map((p) => p.id)).toContain(scenario.expectedPolicyId)
    })
  }
})
