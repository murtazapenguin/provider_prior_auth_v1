/**
 * __tests__/lib/fhir/serviceRequest.test.ts
 *
 * Verifies the CPT 70450 fixture parses out into the expected place
 * (code.coding[0].code), which is the path the next ticket will read.
 */

import { describe, it, expect, vi } from 'vitest'
import { getServiceRequest, searchServiceRequests } from '@/lib/fhir/serviceRequest'
import headCtFixture from '../../fixtures/fhir/serviceRequest/head-ct-order.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('getServiceRequest', () => {
  it('parses the Head CT ServiceRequest', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(headCtFixture))
    const result = await getServiceRequest(headCtFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.status).toBe('active')
    expect(result.intent).toBe('order')
    expect(result.code?.coding?.[0]?.code).toBe('70450')
    expect(result.encounter?.reference).toBe('Encounter/eq081-encounter-1')
  })
})

describe('searchServiceRequests', () => {
  it('renders patient + encounter params correctly', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: headCtFixture }],
      }),
    )
    const result = await searchServiceRequests(
      { patient: 'Patient/eq081-VQEgP8drUUqCWzHfw3', encounter: 'Encounter/eq081-encounter-1', status: 'active' },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      `${TEST_ISS}/ServiceRequest?patient=Patient%2Feq081-VQEgP8drUUqCWzHfw3&encounter=Encounter%2Feq081-encounter-1&status=active`,
    )
    expect(result).toHaveLength(1)
    expect(result[0].code?.coding?.[0]?.code).toBe('70450')
  })
})
