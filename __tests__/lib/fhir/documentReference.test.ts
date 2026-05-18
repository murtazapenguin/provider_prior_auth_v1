/**
 * __tests__/lib/fhir/documentReference.test.ts
 *
 * Verifies default `_count=100` (Epic-friendly default), and that the
 * separate `fetchBinary` helper returns raw Buffer with the correct Accept
 * header.
 */

import { describe, it, expect, vi } from 'vitest'
import { searchDocumentReferences, fetchBinary } from '@/lib/fhir/documentReference'
import progressNoteFixture from '../../fixtures/fhir/documentReference/progress-note.json'
import { TEST_ISS, makeSession, loaderFor, refresherOnce, jsonResponse, binaryResponse } from './_testEnv'

describe('searchDocumentReferences', () => {
  it('defaults _count to 100 when not provided', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: progressNoteFixture }],
      }),
    )
    await searchDocumentReferences(
      { patient: 'Patient/eq081-VQEgP8drUUqCWzHfw3', encounter: 'Encounter/eq081-encounter-1' },
      {
        fetchImpl,
        sessionLoader: loaderFor(makeSession()),
        refresher: refresherOnce(null),
      },
    )
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      `${TEST_ISS}/DocumentReference?patient=Patient%2Feq081-VQEgP8drUUqCWzHfw3&encounter=Encounter%2Feq081-encounter-1&_count=100`,
    )
  })

  it('caps _count at 1000 per Epic max', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resourceType: 'Bundle', type: 'searchset', total: 0, link: [], entry: [] }),
    )
    await searchDocumentReferences(
      { patient: 'Patient/abc', _count: 5000 },
      { fetchImpl, sessionLoader: loaderFor(makeSession()), refresher: refresherOnce(null) },
    )
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('_count=1000')
    expect(url).not.toContain('_count=5000')
  })

  it('returns typed DocumentReferences with attachment metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [{ resource: progressNoteFixture }],
      }),
    )
    const result = await searchDocumentReferences(
      { patient: 'Patient/abc' },
      { fetchImpl, sessionLoader: loaderFor(makeSession()), refresher: refresherOnce(null) },
    )
    expect(result).toHaveLength(1)
    expect(result[0].content[0].attachment.contentType).toBe('application/pdf')
    expect(result[0].content[0].attachment.url).toContain('/Binary/binary-progress-1')
  })
})

describe('fetchBinary', () => {
  it('returns Buffer with Accept: application/octet-stream', async () => {
    const raw = Buffer.from([0x25, 0x50, 0x44, 0x46]) // "%PDF"
    const fetchImpl = vi.fn(async () => binaryResponse(raw))

    const buf = await fetchBinary('https://fhir.epic.com/Binary/binary-progress-1', {
      fetchImpl,
      sessionLoader: loaderFor(makeSession()),
      refresher: refresherOnce(null),
    })

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.equals(raw)).toBe(true)

    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['Accept']).toBe('application/octet-stream')
  })
})
