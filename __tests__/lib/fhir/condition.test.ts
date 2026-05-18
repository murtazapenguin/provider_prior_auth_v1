/**
 * __tests__/lib/fhir/condition.test.ts
 *
 * Verifies the dashed `clinical-status` FHIR param renders verbatim in URLs.
 */

import { describe, it, expect, vi } from 'vitest'
import { searchConditions } from '@/lib/fhir/condition'
import migraineFixture from '../../fixtures/fhir/condition/migraine.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('searchConditions', () => {
  it('renders ?patient=Patient%2Fabc&clinical-status=active in the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: migraineFixture }],
      }),
    )
    const result = await searchConditions(
      { patient: 'Patient/eq081-VQEgP8drUUqCWzHfw3', 'clinical-status': 'active' },
      { fetchImpl, sessionLoader: loaderFor(makeSession()), refresher: refresherOnce(null) },
    )

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Condition?patient=Patient%2Feq081-VQEgP8drUUqCWzHfw3&clinical-status=active`)

    expect(result).toHaveLength(1)
    expect(result[0].clinicalStatus?.coding?.[0]?.code).toBe('active')
    expect(result[0].code?.coding?.[0]?.code).toBe('G43.909')
  })
})
