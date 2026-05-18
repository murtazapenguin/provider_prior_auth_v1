/**
 * __tests__/lib/payer/simulator.test.ts
 *
 * Vitest unit tests for the mock payer adapter + adjudication simulator.
 *
 * Strategy:
 *  - vi.mock('@/lib/statusMachine/transitions') with an in-memory transition
 *    table so tests are not blocked by the "not implemented" stub throw.
 *  - vi.mock('@/lib/db/client') to prevent the Prisma singleton from touching
 *    a real database.
 *  - vi.mock('@/lib/audit/log') to silence audit writes (they call the mocked
 *    Prisma singleton from their own import; mocking prevents double-call issues).
 *  - A Prisma fake is built per-test as a plain object with jest spy functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock: status machine ─────────────────────────────────────────────────────
// The real stub throws. We provide a working in-memory table here.
vi.mock('@/lib/statusMachine/transitions', () => {
  type PaStatus = string
  type PaTransitionEvent = { type: string; actor: string }

  const TABLE: Array<{ from: PaStatus[]; eventType: string; to: PaStatus }> = [
    { from: ['pending'], eventType: 'simulator_in_progress', to: 'in_progress' },
    { from: ['in_progress'], eventType: 'simulator_approved', to: 'approved' },
    { from: ['in_progress'], eventType: 'simulator_denied', to: 'denied' },
    { from: ['in_progress'], eventType: 'simulator_rfi', to: 'rfi' },
    { from: ['in_progress'], eventType: 'simulator_partial_approval', to: 'partial_approval' },
    { from: ['in_progress'], eventType: 'simulator_partial_denial', to: 'partial_denial' },
    { from: ['rfi'], eventType: 'rfi_responded', to: 'in_progress' },
    { from: ['rfi'], eventType: 'provider_withdraw', to: 'withdrawn' },
    { from: ['pending'], eventType: 'provider_withdraw', to: 'withdrawn' },
    { from: ['in_progress'], eventType: 'provider_withdraw', to: 'withdrawn' },
  ]

  function transition(
    currentStatus: PaStatus,
    event: PaTransitionEvent,
  ): { ok: true; next: PaStatus } | { ok: false; reason: string } {
    const row = TABLE.find(
      (r) => r.from.includes(currentStatus) && r.eventType === event.type,
    )
    if (!row) {
      return { ok: false, reason: `No transition from ${currentStatus} on ${event.type}` }
    }
    return { ok: true, next: row.to }
  }

  return { transition }
})

// ─── Mock: audit log ─────────────────────────────────────────────────────────
// Silence real DB writes from recordEvent
vi.mock('@/lib/audit/log', () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}))

// ─── Mock: Prisma singleton (used by audit/log.ts) ───────────────────────────
vi.mock('@/lib/db/client', () => ({
  prisma: {
    paEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}))

// ─── Imports (after mocks) ───────────────────────────────────────────────────
import {
  MockPayerAdapter,
  __resetSimulatorState,
  simulatorQueue,
  deriveScenario,
} from '@/lib/payer/submit'
import {
  runSimulatorTick,
  fastForward,
  notifyRfiResponse,
  PENDING_TO_IN_PROGRESS_MS,
  IN_PROGRESS_TO_TERMINAL_MS,
} from '@/lib/payer/simulator'
import type { PrismaClient } from '@/app/generated/prisma/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fake PrismaClient per test. */
function makeFakePrisma(overrides?: {
  paRecords?: Map<string, Record<string, unknown>>
}): PrismaClient {
  // In-memory store: paId → PA record
  const store: Map<string, Record<string, unknown>> =
    overrides?.paRecords ?? new Map()

  const fake = {
    priorAuth: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        const { where } = args ?? {}
        const lte: Date | undefined = (where?.simulatorNextTransitionAt as { lte?: Date })?.lte
        const statusIn: string[] | undefined = (where?.status as { in?: string[] })?.in
        return Array.from(store.values()).filter((pa) => {
          const nextAt = pa.simulatorNextTransitionAt as Date | null | undefined
          const okTime = !lte || (nextAt && nextAt <= lte)
          const okStatus = !statusIn || statusIn.includes(pa.status as string)
          return okTime && okStatus
        })
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const { where, data } = args
        const existing = store.get(where.id) ?? {}
        const updated = { ...existing, ...data }
        store.set(where.id, updated)
        return updated
      }),
      updateMany: vi.fn(async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { where, data } = args ?? {}
        const statusIn: string[] | undefined = (where?.status as { in?: string[] })?.in
        let count = 0
        for (const [id, pa] of store) {
          if (!statusIn || statusIn.includes(pa.status as string)) {
            store.set(id, { ...pa, ...data })
            count++
          }
        }
        return { count }
      }),
    },
    paEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  }

  return fake as unknown as PrismaClient
}

/** Seed a PriorAuth record into the fake store. */
function seedPa(
  store: Map<string, Record<string, unknown>>,
  overrides: {
    id: string
    status: string
    encounterId: string
    trackingId: string
    simulatorNextTransitionAt: Date | null
  },
) {
  store.set(overrides.id, {
    ...overrides,
    submittedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MockPayerAdapter', () => {
  beforeEach(() => {
    __resetSimulatorState()
  })

  // (a) submit returns a tracking id
  it('submit() returns a non-empty tracking id and registers the PA in the queue', async () => {
    const adapter = new MockPayerAdapter()
    const ack = await adapter.submit({
      paId: 'pa-001',
      encounterId: 'enc-head-ct',
      providerId: 'prov-1',
      payerId: 'payer-1',
      codes: [{ codeType: 'CPT', code: '70450' }],
    })

    expect(typeof ack.trackingId).toBe('string')
    expect(ack.trackingId.length).toBeGreaterThan(0)
    expect(ack.submittedAt).toBeInstanceOf(Date)

    // PA must be in the simulator queue
    const entry = simulatorQueue.get(ack.trackingId)
    expect(entry).toBeDefined()
    expect(entry?.paId).toBe('pa-001')
    expect(entry?.scenario).toBe('head_ct')
    expect(entry?.step).toBe(0)
    expect(entry?.rfiResponded).toBe(false)
  })

  it('deriveScenario() correctly maps encounter suffixes', () => {
    expect(deriveScenario('enc-head-ct')).toBe('head_ct')
    expect(deriveScenario('enc-knee-mri')).toBe('knee_mri')
    expect(deriveScenario('enc-botox')).toBe('botox')
    expect(deriveScenario('enc-other')).toBe('default')
  })

  it('cancel() removes entry from the simulator queue', async () => {
    const adapter = new MockPayerAdapter()
    const ack = await adapter.submit({
      paId: 'pa-002',
      encounterId: 'enc-botox',
      providerId: 'prov-1',
      payerId: 'payer-1',
      codes: [],
    })
    expect(simulatorQueue.has(ack.trackingId)).toBe(true)
    await adapter.cancel(ack.trackingId)
    expect(simulatorQueue.has(ack.trackingId)).toBe(false)
  })
})

// ─── Tick: pending → in_progress at 30 s ─────────────────────────────────────

describe('runSimulatorTick: pending → in_progress', () => {
  beforeEach(() => {
    __resetSimulatorState()
  })

  // (b) tick advances pending→in_progress at 30s
  it('transitions pending PA to in_progress when simulatorNextTransitionAt <= now', async () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const nextAt = new Date(t0.getTime() + PENDING_TO_IN_PROGRESS_MS) // t0 + 30s

    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-101',
      status: 'pending',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-101',
      simulatorNextTransitionAt: nextAt,
    })

    // Register in simulator queue
    simulatorQueue.set('tid-101', {
      paId: 'pa-101',
      scenario: 'head_ct',
      step: 0,
      rfiResponded: false,
    })

    const prisma = makeFakePrisma({ paRecords: store })
    const now = new Date(nextAt.getTime() + 1) // 1 ms after the transition is due
    const result = await runSimulatorTick(prisma, now)

    expect(result.processed).toBe(1)
    expect(result.transitions).toEqual([{ paId: 'pa-101', from: 'pending', to: 'in_progress' }])

    // PA in store must be in_progress and have a new nextTransitionAt
    const updated = store.get('pa-101')
    expect(updated?.status).toBe('in_progress')
    expect(updated?.simulatorNextTransitionAt).toBeInstanceOf(Date)
    // Should be ~90 s after the tick's `now`
    const diff = (updated?.simulatorNextTransitionAt as Date).getTime() - now.getTime()
    expect(diff).toBe(IN_PROGRESS_TO_TERMINAL_MS)
  })

  it('does NOT transition a PA whose timer has not elapsed', async () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const nextAt = new Date(t0.getTime() + PENDING_TO_IN_PROGRESS_MS + 5_000) // 5 s in the future

    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-102',
      status: 'pending',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-102',
      simulatorNextTransitionAt: nextAt,
    })
    simulatorQueue.set('tid-102', { paId: 'pa-102', scenario: 'head_ct', step: 0, rfiResponded: false })

    const prisma = makeFakePrisma({ paRecords: store })
    const result = await runSimulatorTick(prisma, t0) // now is BEFORE nextAt

    expect(result.processed).toBe(0)
    expect(result.transitions).toEqual([])
    expect(store.get('pa-102')?.status).toBe('pending')
  })
})

// ─── Tick: in_progress → approved (Head CT) at 120 s from submit ─────────────

describe('runSimulatorTick: in_progress → approved (Head CT)', () => {
  beforeEach(() => {
    __resetSimulatorState()
  })

  // (c) tick advances in_progress→approved at 120s for Head CT
  it('transitions in_progress to approved for head_ct scenario', async () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z')
    // in_progress reached at t0+30s; terminal tick at t0+30s+90s = t0+120s
    const nextAt = new Date(t0.getTime() + IN_PROGRESS_TO_TERMINAL_MS)

    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-201',
      status: 'in_progress',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-201',
      simulatorNextTransitionAt: nextAt,
    })
    simulatorQueue.set('tid-201', { paId: 'pa-201', scenario: 'head_ct', step: 1, rfiResponded: false })

    const prisma = makeFakePrisma({ paRecords: store })
    const now = new Date(nextAt.getTime() + 1)
    const result = await runSimulatorTick(prisma, now)

    expect(result.processed).toBe(1)
    expect(result.transitions).toEqual([{ paId: 'pa-201', from: 'in_progress', to: 'approved' }])

    const updated = store.get('pa-201')
    expect(updated?.status).toBe('approved')
    expect(updated?.simulatorNextTransitionAt).toBeNull()
  })
})

// ─── Tick: Botox → RFI, then rfi_response → approved ────────────────────────

describe('runSimulatorTick: Botox scenario (RFI path)', () => {
  beforeEach(() => {
    __resetSimulatorState()
  })

  // (d) Botox tick advances in_progress→rfi at 120s, then rfi→in_progress on rfi_response
  it('transitions in_progress → rfi for botox scenario', async () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const nextAt = new Date(t0.getTime() + IN_PROGRESS_TO_TERMINAL_MS)

    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-301',
      status: 'in_progress',
      encounterId: 'enc-botox',
      trackingId: 'tid-301',
      simulatorNextTransitionAt: nextAt,
    })
    simulatorQueue.set('tid-301', { paId: 'pa-301', scenario: 'botox', step: 1, rfiResponded: false })

    const prisma = makeFakePrisma({ paRecords: store })
    const now = new Date(nextAt.getTime() + 1)
    const result = await runSimulatorTick(prisma, now)

    expect(result.processed).toBe(1)
    expect(result.transitions).toEqual([{ paId: 'pa-301', from: 'in_progress', to: 'rfi' }])

    const updated = store.get('pa-301')
    expect(updated?.status).toBe('rfi')
    // RFI is a waiting state — no next timer until provider responds
    expect(updated?.simulatorNextTransitionAt).toBeNull()
  })

  it('notifyRfiResponse() marks entry and arms the timer', async () => {
    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-302',
      status: 'rfi',
      encounterId: 'enc-botox',
      trackingId: 'tid-302',
      simulatorNextTransitionAt: null,
    })
    simulatorQueue.set('tid-302', { paId: 'pa-302', scenario: 'botox', step: 2, rfiResponded: false })

    const prisma = makeFakePrisma({ paRecords: store })
    await notifyRfiResponse(prisma, 'pa-302')

    // In-memory entry should be marked
    expect(simulatorQueue.get('tid-302')?.rfiResponded).toBe(true)

    // DB record should have simulatorNextTransitionAt armed
    const updated = store.get('pa-302')
    expect(updated?.simulatorNextTransitionAt).toBeInstanceOf(Date)
  })

  it('transitions rfi → in_progress after rfi_response, then in_progress → approved on next tick', async () => {
    const t0 = new Date('2024-01-01T00:00:00.000Z')

    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-303',
      status: 'rfi',
      encounterId: 'enc-botox',
      trackingId: 'tid-303',
      simulatorNextTransitionAt: t0,
    })
    // Provider has already responded
    simulatorQueue.set('tid-303', { paId: 'pa-303', scenario: 'botox', step: 2, rfiResponded: true })

    const prisma = makeFakePrisma({ paRecords: store })

    // Tick 1: rfi → in_progress
    const tick1 = await runSimulatorTick(prisma, new Date(t0.getTime() + 1))
    expect(tick1.transitions).toEqual([{ paId: 'pa-303', from: 'rfi', to: 'in_progress' }])
    expect(store.get('pa-303')?.status).toBe('in_progress')

    // Tick 2: in_progress → approved (after 90s)
    const nextAt2 = store.get('pa-303')?.simulatorNextTransitionAt as Date
    const tick2 = await runSimulatorTick(prisma, new Date(nextAt2.getTime() + 1))
    expect(tick2.transitions).toEqual([{ paId: 'pa-303', from: 'in_progress', to: 'approved' }])
    expect(store.get('pa-303')?.status).toBe('approved')
  })
})

// ─── fastForward ─────────────────────────────────────────────────────────────

describe('fastForward', () => {
  beforeEach(() => {
    __resetSimulatorState()
  })

  // (e) fastForward jumps every in-flight PA one step
  it('advances all in-flight PAs one step regardless of timer', async () => {
    const store = new Map<string, Record<string, unknown>>()

    // pending PA — should go to in_progress
    seedPa(store, {
      id: 'pa-ff-1',
      status: 'pending',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-ff-1',
      simulatorNextTransitionAt: new Date(Date.now() + 60_000_000), // far future
    })
    simulatorQueue.set('tid-ff-1', { paId: 'pa-ff-1', scenario: 'head_ct', step: 0, rfiResponded: false })

    // in_progress PA (head_ct) — should go to approved
    seedPa(store, {
      id: 'pa-ff-2',
      status: 'in_progress',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-ff-2',
      simulatorNextTransitionAt: new Date(Date.now() + 60_000_000),
    })
    simulatorQueue.set('tid-ff-2', { paId: 'pa-ff-2', scenario: 'head_ct', step: 1, rfiResponded: false })

    // A terminal PA — must NOT be touched
    seedPa(store, {
      id: 'pa-ff-3',
      status: 'approved',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-ff-3',
      simulatorNextTransitionAt: null,
    })

    const prisma = makeFakePrisma({ paRecords: store })
    const result = await fastForward(prisma)

    expect(result.processed).toBe(2)

    const transitions = result.transitions
    expect(transitions).toContainEqual({ paId: 'pa-ff-1', from: 'pending', to: 'in_progress' })
    expect(transitions).toContainEqual({ paId: 'pa-ff-2', from: 'in_progress', to: 'approved' })

    // Terminal PA unchanged
    expect(store.get('pa-ff-3')?.status).toBe('approved')
  })

  it('fastForward with no in-flight PAs returns empty result', async () => {
    const store = new Map<string, Record<string, unknown>>()
    seedPa(store, {
      id: 'pa-ff-4',
      status: 'approved',
      encounterId: 'enc-head-ct',
      trackingId: 'tid-ff-4',
      simulatorNextTransitionAt: null,
    })

    const prisma = makeFakePrisma({ paRecords: store })
    const result = await fastForward(prisma)

    expect(result.processed).toBe(0)
    expect(result.transitions).toEqual([])
  })
})
