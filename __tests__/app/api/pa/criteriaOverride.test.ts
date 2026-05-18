/**
 * __tests__/app/api/pa/criteriaOverride.test.ts
 *
 * POST /api/pa/[id]/criteria/[cid]/override — regression for the gate-13
 * premature-transition bug.
 *
 * Before the fix: a PA with N expected criteria but zero prior recheck rows
 * would jump to `ready_for_submission` after a single override because
 * `allResults.every(passed)` was vacuously true (1 result / 1 result).
 *
 * After the fix: the route counts the expected criteria via the PA's
 * procedure codes → applicable policies → policy criteria. A PA only
 * transitions when allResults.length === expectedCriteriaCount AND every
 * result is passed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const paId = 'pa-test-fixture'
const cid1 = 'criterion-test-1'
const cid2 = 'criterion-test-2'
const cid3 = 'criterion-test-3'

type CriterionResultRow = {
  id: string
  priorAuthId: string
  criterionId: string
  status: string
  rationale: string | null
  confidence: number
  evaluatedAt: Date
}

const state = {
  pa: {
    id: paId,
    encounterId: 'enc-1',
    providerId: 'provider-1',
    payerId: 'payer-uhc',
    status: 'draft',
    statusReason: null,
    priority: 'standard',
  },
  // Default fixture: 3 criteria expected, 1 prior result. The first override
  // will create result row #2; allResults.length(2) !== expectedCount(3) →
  // no transition. Per-test setup mutates this.
  priorAuthCodes: [{ priorAuthId: paId, code: '93016', codeType: 'CPT' }],
  expectedCriteriaCount: 3,
  criterionResults: [] as CriterionResultRow[],
  appliedTransitions: [] as Array<{ type: string; actor: string }>,
}

vi.mock('@/lib/db/client', () => ({
  prisma: {
    priorAuth: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === state.pa.id ? state.pa : null
      ),
    },
    priorAuthCode: {
      findMany: vi.fn(async () => state.priorAuthCodes),
    },
    policyCriterion: {
      count: vi.fn(async () => state.expectedCriteriaCount),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        policyId: 'policy-test',
        ordinal: 1,
        text: 'Stub criterion',
      })),
    },
    criterionResult: {
      findFirst: vi.fn(async ({ where }: { where: { priorAuthId: string; criterionId: string } }) => {
        const matches = state.criterionResults
          .filter((r) => r.priorAuthId === where.priorAuthId && r.criterionId === where.criterionId)
          .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())
        return matches[0] ?? null
      }),
      findMany: vi.fn(async () => {
        // Mimic distinct: ['criterionId'] by keeping latest per criterionId.
        const byCid = new Map<string, CriterionResultRow>()
        for (const r of state.criterionResults.sort(
          (a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime()
        )) {
          if (!byCid.has(r.criterionId)) byCid.set(r.criterionId, r)
        }
        return Array.from(byCid.values())
      }),
      create: vi.fn(async ({ data }: { data: Omit<CriterionResultRow, 'id' | 'evaluatedAt'> }) => {
        const row: CriterionResultRow = {
          id: `cr-${state.criterionResults.length + 1}`,
          evaluatedAt: new Date(),
          ...data,
        } as CriterionResultRow
        state.criterionResults.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<CriterionResultRow> }) => {
        const row = state.criterionResults.find((r) => r.id === where.id)!
        Object.assign(row, data, { evaluatedAt: new Date() })
        return row
      }),
    },
    citation: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))

vi.mock('@/lib/audit/log', () => ({
  recordEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/statusMachine/applyTransition', () => ({
  applyTransition: vi.fn(async (_prisma: unknown, pa: typeof state.pa, event: { type: string; actor: string }) => {
    state.appliedTransitions.push(event)
    return { ok: true, pa: { ...pa, status: 'ready_for_submission' } }
  }),
}))

vi.mock('@/lib/api/auth', () => ({
  getProviderId: vi.fn(() => 'provider-1'),
  DEMO_PROVIDER_ID: 'provider-1',
}))

beforeEach(() => {
  state.pa.status = 'draft'
  state.priorAuthCodes = [{ priorAuthId: paId, code: '93016', codeType: 'CPT' }]
  state.expectedCriteriaCount = 3
  state.criterionResults = []
  state.appliedTransitions = []
})

function makeRequest(rationale: string): Request {
  return new Request(`http://localhost:3000/api/pa/${paId}/criteria/${cid1}/override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rationale }),
  })
}

describe('POST /api/pa/[id]/criteria/[cid]/override — premature-transition regression', () => {
  it('does NOT transition to ready_for_submission when only 1 of N criteria is overridden', async () => {
    const { POST } = await import('@/app/api/pa/[id]/criteria/[cid]/override/route')
    state.expectedCriteriaCount = 3
    // No prior CriterionResult rows.

    const res = await POST(makeRequest('Provider attests to chest pain from prior visit'), {
      params: Promise.resolve({ id: paId, cid: cid1 }),
    })

    expect(res.status).toBe(200)
    expect(state.criterionResults).toHaveLength(1)
    expect(state.criterionResults[0]!.status).toBe('passed')
    // PA stays draft — only 1/3 criteria has a result.
    expect(state.appliedTransitions).toHaveLength(0)
    const body = await res.json()
    expect(body.pa.status).toBe('draft')
  })

  it('transitions to ready_for_submission only when ALL N criteria have passed results', async () => {
    const { POST } = await import('@/app/api/pa/[id]/criteria/[cid]/override/route')
    state.expectedCriteriaCount = 3
    // Seed 2 prior PASSED results; this override is the 3rd.
    state.criterionResults = [
      {
        id: 'cr-pre-1',
        priorAuthId: paId,
        criterionId: cid2,
        status: 'passed',
        rationale: null,
        confidence: 0.95,
        evaluatedAt: new Date(Date.now() - 60_000),
      },
      {
        id: 'cr-pre-2',
        priorAuthId: paId,
        criterionId: cid3,
        status: 'passed',
        rationale: null,
        confidence: 0.92,
        evaluatedAt: new Date(Date.now() - 30_000),
      },
    ]

    const res = await POST(makeRequest('Provider attests; final criterion'), {
      params: Promise.resolve({ id: paId, cid: cid1 }),
    })

    expect(res.status).toBe(200)
    expect(state.criterionResults).toHaveLength(3)
    expect(state.appliedTransitions).toHaveLength(1)
    expect(state.appliedTransitions[0]!.type).toBe('criteria_all_met')
    const body = await res.json()
    expect(body.pa.status).toBe('ready_for_submission')
  })

  it('does NOT transition when override completes the result set but one prior result is still needs_info', async () => {
    const { POST } = await import('@/app/api/pa/[id]/criteria/[cid]/override/route'  )
    state.expectedCriteriaCount = 3
    state.criterionResults = [
      {
        id: 'cr-pre-1',
        priorAuthId: paId,
        criterionId: cid2,
        status: 'passed',
        rationale: null,
        confidence: 0.95,
        evaluatedAt: new Date(Date.now() - 60_000),
      },
      {
        id: 'cr-pre-2',
        priorAuthId: paId,
        criterionId: cid3,
        status: 'needs_info', // <-- not passed
        rationale: null,
        confidence: 0.55,
        evaluatedAt: new Date(Date.now() - 30_000),
      },
    ]

    const res = await POST(makeRequest('Override criterion 1 only'), {
      params: Promise.resolve({ id: paId, cid: cid1 }),
    })

    expect(res.status).toBe(200)
    expect(state.criterionResults).toHaveLength(3)
    expect(state.appliedTransitions).toHaveLength(0) // one row is still needs_info
  })
})
