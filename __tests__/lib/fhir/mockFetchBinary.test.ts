/**
 * Phase 6 / Session 7 pre-flight verification (P-7.3).
 *
 * Confirms mock `fetchBinary` resolves Binary URLs to fixture files on disk
 * — replacing the prior 22-byte stub that returned the same fake PDF for any URL.
 */

import { describe, expect, it } from 'vitest'

import { fetchBinary, searchDocumentReferences } from '@/lib/fhir/mock'
import { FhirRequestError } from '@/lib/fhir/client'

describe('mock.ts fetchBinary (Phase 6 / Session 7 pre-flight)', () => {
  it('returns real fixture bytes for a text Binary URL', async () => {
    const buf = await fetchBinary('Binary/mock-jordan-avery-hp')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000) // seeded H&P note is ~5KB
    expect(buf.toString('utf-8')).toContain('Jordan') // patient name appears in the SOAP text
  })

  it('returns real fixture bytes for a PDF Binary URL', async () => {
    const buf = await fetchBinary('Binary/mock-priya-shah-headache-diary')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF') // PDF magic header
  })

  it('resolves URLs with an iss prefix', async () => {
    const buf = await fetchBinary('https://fhir.epic.com/api/FHIR/R4/Binary/mock-sam-rodriguez-ortho-consult')
    expect(buf.toString('utf-8')).toContain('knee') // ortho consult discusses knee
  })

  it('throws FhirRequestError(404) for unknown binary ids', async () => {
    await expect(fetchBinary('Binary/does-not-exist')).rejects.toBeInstanceOf(FhirRequestError)
    await expect(fetchBinary('Binary/does-not-exist')).rejects.toMatchObject({ status: 404 })
  })

  it('throws FhirRequestError(404) for malformed URLs', async () => {
    await expect(fetchBinary('not-a-binary-url')).rejects.toBeInstanceOf(FhirRequestError)
  })
})

describe('mock.ts searchDocumentReferences + fetchBinary end-to-end (pre-flight P-7.3)', () => {
  it('all 4 demo patients have DocumentReference fixtures whose Binary URLs resolve', async () => {
    const patients = [
      'patient-jordan-avery',
      'patient-sam-rodriguez',
      'patient-priya-shah',
      'patient-eleanor-vance',
    ] as const

    for (const patientId of patients) {
      const docrefs = await searchDocumentReferences({ patient: `Patient/${patientId}` })
      expect(docrefs.length).toBe(2)

      for (const docref of docrefs) {
        const url = docref.content[0]?.attachment.url
        expect(url).toBeDefined()
        const buf = await fetchBinary(url!)
        expect(buf.length).toBeGreaterThan(100)
      }
    }
  })
})
