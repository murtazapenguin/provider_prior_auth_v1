/**
 * __tests__/lib/fhir/client.test.ts
 *
 * Auth attachment, 401-with-refresh, 429/503 backoff, pagination, binary
 * fetch, error redaction, validation. Uses `fetchImpl` injection per the
 * pattern in lib/smart/tokenExchange.ts — no `vi.stubGlobal('fetch')`,
 * no real network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  fhirGet,
  fhirSearch,
  fhirFetchBinary,
  redactToken,
  SmartSessionExpiredError,
  FhirRequestError,
  _internals,
} from '@/lib/fhir/client'
import { PatientSchema } from '@/lib/fhir/types'
import camilaLopezFixture from '../../fixtures/fhir/patient/camila-lopez.json'
import page1Bundle from '../../fixtures/fhir/bundle/patient-search-page1.json'
import page2Bundle from '../../fixtures/fhir/bundle/patient-search-page2.json'
import page3Bundle from '../../fixtures/fhir/bundle/patient-search-page3.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse, errorResponse, binaryResponse } from './_testEnv'

describe('fhirGet — auth + url + parse', () => {
  it('attaches Bearer token and Accept: application/fhir+json', async () => {
    const session = makeSession({ accessToken: 'tok-abc' })
    const fetchImpl = vi.fn(async () => jsonResponse(camilaLopezFixture))
    await fhirGet({
      resourceType: 'Patient',
      id: 'eq081-VQEgP8drUUqCWzHfw3',
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(session),
      refresher: refresherOnce(null),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${TEST_ISS}/Patient/eq081-VQEgP8drUUqCWzHfw3`)
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok-abc')
    expect(headers['Accept']).toBe('application/fhir+json')
  })

  it('returns a zod-validated typed object', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(camilaLopezFixture))
    const result = await fhirGet({
      resourceType: 'Patient',
      id: camilaLopezFixture.id,
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(result.resourceType).toBe('Patient')
    expect(result.id).toBe(camilaLopezFixture.id)
    expect(result.birthDate).toBe(camilaLopezFixture.birthDate)
    expect(result.gender).toBe(camilaLopezFixture.gender)
  })

  it('throws fhir_validation_failed when response shape is wrong', async () => {
    // Missing required `id`.
    const fetchImpl = vi.fn(async () => jsonResponse({ resourceType: 'Patient' }))
    await expect(
      fhirGet({
        resourceType: 'Patient',
        id: 'doesnt-matter',
        schema: PatientSchema,
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      }),
    ).rejects.toMatchObject({ code: 'fhir_validation_failed' })
  })

  it('throws fhir_no_session when no session is loaded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(camilaLopezFixture))
    await expect(
      fhirGet({
        resourceType: 'Patient',
        id: 'x',
        schema: PatientSchema,
        fetchImpl,
        sessionLoader: loaderFor(null),
        refresher: refresherOnce(null),
      }),
    ).rejects.toBeInstanceOf(FhirRequestError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws FhirRequestError on non-rate-limit 5xx with status in payload', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500, { error: 'oops' }))
    await expect(
      fhirGet({
        resourceType: 'Patient',
        id: 'x',
        schema: PatientSchema,
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      }),
    ).rejects.toMatchObject({ code: 'fhir_request_failed', status: 500 })
  })
})

describe('fhirGet — 401 + silent refresh', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    const initial = makeSession({ accessToken: 'old-token' })
    const refreshed = makeSession({ accessToken: 'new-token' })

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(camilaLopezFixture))

    const refresher = refresherOnce(refreshed)
    const result = await fhirGet({
      resourceType: 'Patient',
      id: 'eq081-VQEgP8drUUqCWzHfw3',
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(initial),
      refresher,
    })

    expect(result.id).toBe(camilaLopezFixture.id)
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // Second call used the new token.
    const secondCallHeaders = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(secondCallHeaders['Authorization']).toBe('Bearer new-token')
  })

  it('throws SmartSessionExpiredError when second call also returns 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(errorResponse(401, { error: 'still unauthorized' }))

    const refresher = refresherOnce(makeSession({ accessToken: 'new-token' }))

    await expect(
      fhirGet({
        resourceType: 'Patient',
        id: 'x',
        schema: PatientSchema,
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher,
      }),
    ).rejects.toBeInstanceOf(SmartSessionExpiredError)
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws SmartSessionExpiredError immediately when refresher returns null', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(errorResponse(401, { error: 'unauthorized' }))
    const refresher = refresherOnce(null)

    await expect(
      fhirGet({
        resourceType: 'Patient',
        id: 'x',
        schema: PatientSchema,
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher,
      }),
    ).rejects.toBeInstanceOf(SmartSessionExpiredError)
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('fhirGet — 429/503 backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries 429 with exponential backoff, caps at 3 attempts then throws fhir_rate_limited', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(429))
    // Use deterministic backoff for assertion clarity.
    const backoff = vi.fn((attempt: number) => 100 * attempt)

    const promise = fhirGet({
      resourceType: 'Patient',
      id: 'x',
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
      backoffMs: backoff,
    })

    // Catch the eventual rejection to satisfy unhandled-rejection guards.
    const settled = promise.catch((err) => err)

    // First attempt fires synchronously inside the promise; subsequent
    // attempts gate on `setTimeout`. We unblock the gates in order.
    await vi.advanceTimersByTimeAsync(100) // unblock 1 → 2
    await vi.advanceTimersByTimeAsync(200) // unblock 2 → 3

    const result = await settled
    expect(result).toBeInstanceOf(FhirRequestError)
    expect((result as FhirRequestError).code).toBe('fhir_rate_limited')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(backoff).toHaveBeenCalledTimes(2) // backoff between attempts 1→2 and 2→3 only
  })

  it('retries 503 the same way as 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(jsonResponse(camilaLopezFixture))

    const promise = fhirGet({
      resourceType: 'Patient',
      id: camilaLopezFixture.id,
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
      backoffMs: () => 50,
    })

    await vi.advanceTimersByTimeAsync(50)
    const result = await promise
    expect(result.id).toBe(camilaLopezFixture.id)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('honors numeric Retry-After header over the default backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { x: 1 }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse(camilaLopezFixture))

    const backoff = vi.fn(() => 10_000) // would be very long; should be ignored

    const promise = fhirGet({
      resourceType: 'Patient',
      id: camilaLopezFixture.id,
      schema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
      backoffMs: backoff,
    })

    await vi.advanceTimersByTimeAsync(2000)
    const result = await promise
    expect(result.id).toBe(camilaLopezFixture.id)
    expect(backoff).not.toHaveBeenCalled()
  })

  it('default backoff schedule grows exponentially: 250, 500, 1000', () => {
    expect(_internals.defaultBackoffMs(1)).toBe(250)
    expect(_internals.defaultBackoffMs(2)).toBe(500)
    expect(_internals.defaultBackoffMs(3)).toBe(1000)
  })

  it('parseRetryAfterMs accepts integer seconds and rejects HTTP-date', () => {
    expect(_internals.parseRetryAfterMs('5')).toBe(5000)
    expect(_internals.parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT')).toBeUndefined()
    expect(_internals.parseRetryAfterMs(null)).toBeUndefined()
    expect(_internals.parseRetryAfterMs(' 3 ')).toBe(3000)
  })
})

describe('fhirSearch — pagination', () => {
  it('follows Bundle.link[relation=next] across pages and concatenates entries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1Bundle))
      .mockResolvedValueOnce(jsonResponse(page2Bundle))
      .mockResolvedValueOnce(jsonResponse(page3Bundle))

    const results = await fhirSearch({
      resourceType: 'Patient',
      searchParams: { identifier: 'mrn|Z6129', _count: '2' },
      entrySchema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(results.map((p) => p.id)).toEqual([
      'page1-pat-a',
      'page1-pat-b',
      'page2-pat-c',
      'page2-pat-d',
      'page3-pat-e',
    ])

    // First-page URL is composed from iss + params with URLSearchParams encoding.
    const firstUrl = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0]
    expect(firstUrl).toBe(`${TEST_ISS}/Patient?identifier=mrn%7CZ6129&_count=2`)

    // Subsequent pages use the absolute `link.next.url` directly.
    const secondUrl = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[0]
    expect(secondUrl).toBe(page1Bundle.link[1].url)
    const thirdUrl = (fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[0]
    expect(thirdUrl).toBe(page2Bundle.link[1].url)
  })

  it('refreshes auth mid-pagination if a continuation page returns 401', async () => {
    const initial = makeSession({ accessToken: 'page1-token' })
    const refreshed = makeSession({ accessToken: 'page2-token' })

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1Bundle)) // page 1 OK
      .mockResolvedValueOnce(errorResponse(401)) // page 2 → 401
      .mockResolvedValueOnce(jsonResponse(page2Bundle)) // page 2 retry OK
      .mockResolvedValueOnce(jsonResponse(page3Bundle)) // page 3 OK

    const refresher = refresherOnce(refreshed)

    const results = await fhirSearch({
      resourceType: 'Patient',
      searchParams: { identifier: 'mrn|Z6129' },
      entrySchema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(initial),
      refresher,
    })

    expect(results).toHaveLength(5)
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    const retryHeaders = (fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(retryHeaders['Authorization']).toBe('Bearer page2-token')
  })

  it('returns an empty array when the bundle has no entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        link: [],
      }),
    )
    const results = await fhirSearch({
      resourceType: 'Patient',
      searchParams: { identifier: 'no-match' },
      entrySchema: PatientSchema,
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })
    expect(results).toEqual([])
  })
})

describe('fhirFetchBinary', () => {
  it('sets Accept: application/octet-stream and returns Buffer (not base64 string)', async () => {
    const raw = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
    const fetchImpl = vi.fn(async () => binaryResponse(raw))

    const result = await fhirFetchBinary({
      url: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Binary/binary-progress-1',
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })

    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.equals(raw)).toBe(true)

    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['Accept']).toBe('application/octet-stream')
    expect(headers['Authorization']).toMatch(/^Bearer /)
  })

  it('also refreshes auth on 401', async () => {
    const raw = Buffer.from([0x00])
    const refreshed = makeSession({ accessToken: 'rotated' })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(binaryResponse(raw))

    const refresher = refresherOnce(refreshed)
    const buf = await fhirFetchBinary({
      url: 'https://example/Binary/x',
      fetchImpl,
      sessionLoader: loaderFor(makeSession({ accessToken: 'stale' })),
      refresher,
    })

    expect(buf.equals(raw)).toBe(true)
    expect(refresher).toHaveBeenCalledTimes(1)
  })
})

describe('redactToken', () => {
  it('replaces any `Bearer <token>` substring with `Bearer [REDACTED]`', () => {
    const noisy = 'request failed Authorization: Bearer abc.def-123_XYZ to https://example'
    expect(redactToken(noisy)).toBe('request failed Authorization: Bearer [REDACTED] to https://example')
  })

  it('handles multiple occurrences', () => {
    const noisy = 'try1 Bearer aaa; try2 Bearer bbb'
    expect(redactToken(noisy)).toBe('try1 Bearer [REDACTED]; try2 Bearer [REDACTED]')
  })

  it('is a no-op when no bearer is present', () => {
    expect(redactToken('plain message')).toBe('plain message')
  })
})

describe('url composition internals', () => {
  it('buildResourceUrl strips trailing slashes on iss', () => {
    expect(_internals.buildResourceUrl(`${TEST_ISS}/`, 'Patient', 'abc')).toBe(`${TEST_ISS}/Patient/abc`)
    expect(_internals.buildResourceUrl(`${TEST_ISS}///`, 'Patient', 'abc')).toBe(`${TEST_ISS}/Patient/abc`)
  })

  it('buildSearchUrl handles array params and skips undefined', () => {
    const url = _internals.buildSearchUrl(TEST_ISS, 'Encounter', {
      patient: 'Patient/abc',
      _sort: '-date',
      _count: '5',
      status: undefined,
    })
    expect(url).toBe(`${TEST_ISS}/Encounter?patient=Patient%2Fabc&_sort=-date&_count=5`)
  })

  it('buildSearchUrl preserves hyphenated FHIR param names', () => {
    const url = _internals.buildSearchUrl(TEST_ISS, 'Condition', {
      patient: 'Patient/abc',
      'clinical-status': 'active',
    })
    expect(url).toContain('clinical-status=active')
  })

  // Tiny schema for the error-redaction assertion below.
  const TinySchema = z.object({ resourceType: z.literal('Patient'), id: z.string() })

  it('error message does not leak the bearer token even if echoed in body', async () => {
    const noisyBody = 'invalid_token: Bearer leaky-token-do-not-log'
    const fetchImpl = vi.fn(async () => new Response(noisyBody, { status: 500, headers: { 'Content-Type': 'text/plain' } }))

    let caught: FhirRequestError | undefined
    try {
      await fhirGet({
        resourceType: 'Patient',
        id: 'x',
        schema: TinySchema,
        fetchImpl,
        sessionLoader: loaderFor(makeSession({ accessToken: 'leaky-token-do-not-log' })),
        refresher: refresherOnce(null),
      })
    } catch (err) {
      caught = err as FhirRequestError
    }
    expect(caught).toBeDefined()
    const serialized = JSON.stringify(caught?.details ?? {})
    expect(serialized).not.toContain('leaky-token-do-not-log')
    expect(serialized).toContain('[REDACTED]')
  })
})
