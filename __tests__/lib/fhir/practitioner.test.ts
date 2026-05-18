/**
 * __tests__/lib/fhir/practitioner.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { getPractitioner, parsePractitionerReference } from '@/lib/fhir/practitioner'
import practitionerFixture from '../../fixtures/fhir/practitioner/test-practitioner.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('getPractitioner', () => {
  it('parses Practitioner with qualification[]', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(practitionerFixture))
    const result = await getPractitioner(practitionerFixture.id, {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })

    expect(result.id).toBe(practitionerFixture.id)
    expect(result.name?.[0]?.family).toBe('Brand')
    expect(result.qualification?.[0]?.code?.coding?.[0]?.code).toBe('MD')

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Practitioner/${practitionerFixture.id}`)
  })
})

describe('parsePractitionerReference', () => {
  it('returns the trailing id for a well-formed Practitioner ref', () => {
    expect(parsePractitionerReference('Practitioner/eb4eA-AKqkc2HnRMtUMzgaw3')).toBe('eb4eA-AKqkc2HnRMtUMzgaw3')
  })

  it('returns null for non-Practitioner refs', () => {
    expect(parsePractitionerReference('Patient/foo')).toBeNull()
    expect(parsePractitionerReference('not-a-ref')).toBeNull()
    expect(parsePractitionerReference('')).toBeNull()
  })
})
