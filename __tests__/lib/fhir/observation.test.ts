/**
 * __tests__/lib/fhir/observation.test.ts
 *
 * Verifies value[x] polymorphism: both valueQuantity and valueCodeableConcept
 * parse cleanly through the same schema; the unused variant is undefined.
 */

import { describe, it, expect, vi } from 'vitest'
import { searchObservations } from '@/lib/fhir/observation'
import bpFixture from '../../fixtures/fhir/observation/value-quantity.json'
import smokerFixture from '../../fixtures/fhir/observation/value-codeable-concept.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('searchObservations — value[x] polymorphism', () => {
  it('parses an Observation with valueQuantity', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resourceType: 'Bundle', type: 'searchset', total: 1, entry: [{ resource: bpFixture }] }),
    )
    const result = await searchObservations(
      { patient: 'Patient/eq081-VQEgP8drUUqCWzHfw3', category: 'vital-signs' },
      { fetchImpl, sessionLoader: loaderFor(makeSession()), refresher: refresherOnce(null) },
    )

    expect(result).toHaveLength(1)
    expect(result[0].valueQuantity?.value).toBe(128)
    expect(result[0].valueQuantity?.unit).toBe('mmHg')
    expect(result[0].valueCodeableConcept).toBeUndefined()

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Observation?patient=Patient%2Feq081-VQEgP8drUUqCWzHfw3&category=vital-signs`)
  })

  it('parses an Observation with valueCodeableConcept', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resourceType: 'Bundle', type: 'searchset', total: 1, entry: [{ resource: smokerFixture }] }),
    )
    const result = await searchObservations(
      { patient: 'Patient/eq081-VQEgP8drUUqCWzHfw3', category: 'social-history' },
      { fetchImpl, sessionLoader: loaderFor(makeSession()), refresher: refresherOnce(null) },
    )

    expect(result).toHaveLength(1)
    expect(result[0].valueCodeableConcept?.text).toBe('Never smoker')
    expect(result[0].valueQuantity).toBeUndefined()
  })
})
