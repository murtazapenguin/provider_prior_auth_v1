/**
 * __tests__/lib/fhir/encounter.test.ts
 *
 * Encounter adapter — verifies the period.end: null quirk parses cleanly
 * and the `_sort=-date` / `_count` params render correctly in the URL.
 */

import { describe, it, expect, vi } from 'vitest'
import { getEncounter, searchEncounters } from '@/lib/fhir/encounter'
import outpatientFixture from '../../fixtures/fhir/encounter/outpatient-camila.json'
import closedFixture from '../../fixtures/fhir/encounter/closed-encounter.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('getEncounter', () => {
  it('parses an active encounter with period.end: null (Epic quirk)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(outpatientFixture))
    const result = await getEncounter(outpatientFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.status).toBe('in-progress')
    expect(result.period?.start).toBe(outpatientFixture.period.start)
    expect(result.period?.end).toBeNull()
  })

  it('parses a finished encounter with period.end set', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(closedFixture))
    const result = await getEncounter(closedFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.status).toBe('finished')
    expect(result.period?.end).toBe(closedFixture.period.end)
  })
})

describe('searchEncounters', () => {
  it('renders ?patient=Patient%2Fabc&_sort=-date&_count=5 in the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: outpatientFixture }],
      }),
    )
    const result = await searchEncounters(
      { patient: 'Patient/abc', _sort: '-date', _count: 5 },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Encounter?patient=Patient%2Fabc&_sort=-date&_count=5`)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(outpatientFixture.id)
  })
})
