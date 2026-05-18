/**
 * __tests__/lib/fhir/patient.test.ts
 *
 * Fixture-based verification per orchestrator override #2: `getPatient`
 * against a mocked fetch returning Epic's published sandbox Patient JSON
 * returns a zod-validated typed `Patient` matching the expected shape.
 *
 * This is the deliverable that replaces the live `/api/_debug/fhir` route
 * for the registration-deferred session.
 */

import { describe, it, expect, vi } from 'vitest'
import { getPatient, searchPatients } from '@/lib/fhir/patient'
import camilaLopezFixture from '../../fixtures/fhir/patient/camila-lopez.json'
import page1Bundle from '../../fixtures/fhir/bundle/patient-search-page1.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse } from './_testEnv'

describe('getPatient (fixture verification)', () => {
  it("returns a zod-validated typed Patient for Camila Lopez (override #2's gate)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(camilaLopezFixture))
    const result = await getPatient('eq081-VQEgP8drUUqCWzHfw3', {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })

    expect(result.resourceType).toBe('Patient')
    expect(result.id).toBe('eq081-VQEgP8drUUqCWzHfw3')
    expect(result.gender).toBe('female')
    expect(result.birthDate).toBe('1987-09-12')
    expect(result.name?.[0]?.family).toBe('Lopez')
    expect(result.name?.[0]?.given?.[0]).toBe('Camila')

    // URL composition + auth attachment sanity.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Patient/eq081-VQEgP8drUUqCWzHfw3`)
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/fhir+json')
  })

  it('throws fhir_validation_failed when the response is missing required id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ resourceType: 'Patient' }))
    await expect(
      getPatient('any-id', {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      }),
    ).rejects.toMatchObject({ code: 'fhir_validation_failed' })
  })
})

describe('searchPatients', () => {
  it('builds the URL with URLSearchParams encoding (mrn|Z6129 → mrn%7CZ6129)', async () => {
    // Single-page bundle (no next link) so we can isolate the URL-build assertion.
    const singlePage = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [],
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'one',
            name: [{ family: 'OnlyOne' }],
            gender: 'female',
          },
        },
      ],
    }
    const fetchImpl = vi.fn(async () => jsonResponse(singlePage))

    await searchPatients(
      { identifier: 'mrn|Z6129', _count: 2 },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Patient?identifier=mrn%7CZ6129&_count=2`)
  })

  it('returns typed entries from a paginated bundle', async () => {
    // page1Bundle has a `next` link; terminate with an empty-link bundle.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1Bundle))
      .mockResolvedValueOnce(
        jsonResponse({
          resourceType: 'Bundle',
          type: 'searchset',
          total: 0,
          link: [],
        }),
      )

    const result = await searchPatients(
      { identifier: 'mrn|Z6129' },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].resourceType).toBe('Patient')
    expect(result[0].name?.[0]?.family).toBe('AlphaA')
  })
})
