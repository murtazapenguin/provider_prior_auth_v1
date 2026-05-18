/**
 * __tests__/lib/smart/postLaunchRouting.test.ts
 *
 * Unit tests for the post-launch routing decision tree. Covers the four
 * branches called out in the WF-X-encounter-context-switch + WF-PROV-launch-*
 * workflows.
 */

import { describe, it, expect, vi } from 'vitest'
import { computePostLaunchDestination, type PostLaunchPrismaLike } from '@/lib/smart/postLaunchRouting'

function makePrismaMock(opts: { existingPaIdForEncounter?: string | null } = {}): PostLaunchPrismaLike {
  return {
    priorAuth: {
      findFirst: vi.fn(async ({ where }: { where: { encounterId: string } }) => {
        if (opts.existingPaIdForEncounter && where.encounterId === 'encounter-with-pa') {
          return { id: opts.existingPaIdForEncounter }
        }
        return null
      }),
    },
  }
}

describe('computePostLaunchDestination', () => {
  it('routes to /pa/{id} when encounter has an existing PriorAuth', async () => {
    const prisma = makePrismaMock({ existingPaIdForEncounter: 'pa-abc-123' })
    const dest = await computePostLaunchDestination(
      { patientContext: 'patient-priya-shah', encounterContext: 'encounter-with-pa' },
      prisma,
    )
    expect(dest).toBe('/pa/pa-abc-123')
  })

  it('routes to /queue?encounter={id} when encounter exists but no PriorAuth', async () => {
    const prisma = makePrismaMock()
    const dest = await computePostLaunchDestination(
      { patientContext: 'patient-priya-shah', encounterContext: 'encounter-botox' },
      prisma,
    )
    expect(dest).toBe('/queue?encounter=encounter-botox')
  })

  it('routes to /queue?patient={id} when patient context is set but no encounter', async () => {
    const prisma = makePrismaMock()
    const dest = await computePostLaunchDestination(
      { patientContext: 'patient-jordan-avery', encounterContext: null },
      prisma,
    )
    expect(dest).toBe('/queue?patient=patient-jordan-avery')
  })

  it('routes to /queue when neither patient nor encounter context is set', async () => {
    const prisma = makePrismaMock()
    const dest = await computePostLaunchDestination(
      { patientContext: null, encounterContext: null },
      prisma,
    )
    expect(dest).toBe('/queue')
  })

  it('URL-encodes the encounter id so weird characters do not break the redirect', async () => {
    const prisma = makePrismaMock()
    const dest = await computePostLaunchDestination(
      { patientContext: null, encounterContext: 'encounter/with space' },
      prisma,
    )
    expect(dest).toBe('/queue?encounter=encounter%2Fwith%20space')
  })
})
