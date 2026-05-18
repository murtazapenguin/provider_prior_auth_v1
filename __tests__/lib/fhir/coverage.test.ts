/**
 * __tests__/lib/fhir/coverage.test.ts
 *
 * Coverage adapter — verifies parsing with/without the optional `status`
 * field (Epic quirk: some tenants omit it for active coverages).
 */

import { describe, it, expect, vi } from 'vitest'
import { getCoverage, searchCoverages } from '@/lib/fhir/coverage'
import uhcFixture from '../../fixtures/fhir/coverage/uhc-commercial.json'
import noStatusFixture from '../../fixtures/fhir/coverage/uhc-no-status.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('getCoverage', () => {
  it('parses UHC commercial coverage with explicit status=active', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(uhcFixture))
    const result = await getCoverage(uhcFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.status).toBe('active')
    expect(result.subscriberId).toBe('UHC987654321')
    expect(result.payor?.[0]?.display).toBe('UnitedHealthcare')
    expect(result.class?.[1]?.name).toBe('Choice Plus PPO')
  })

  it('parses coverage without status (Epic quirk: caller defaults to active)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(noStatusFixture))
    const result = await getCoverage(noStatusFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.status).toBeUndefined()
    expect(result.payor?.[0]?.display).toBe('UnitedHealthcare')
  })
})

describe('searchCoverages', () => {
  it('renders ?patient=Patient%2Fabc&status=active in the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: uhcFixture }],
      }),
    )
    const result = await searchCoverages(
      { patient: 'Patient/abc', status: 'active' },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Coverage?patient=Patient%2Fabc&status=active`)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(uhcFixture.id)
  })
})
