/**
 * lib/fhir/coverage.ts
 *
 * Typed adapter for FHIR R4 Coverage.
 * Spec: https://www.hl7.org/fhir/R4/coverage.html
 *
 * Epic quirk: `Coverage.status` is optional in some tenant versions; missing
 * means "active". Callers should default `status === undefined` to "active"
 * when constructing domain objects. The schema reflects this by making
 * `.status` optional.
 */

import { fhirGet, fhirSearch, type FhirCallOpts } from './client'
import { CoverageSchema, type Coverage } from './types'

export interface SearchCoveragesParams {
  /** "Patient/{id}" reference. */
  patient: string
  status?: string
}

export async function getCoverage(id: string, opts: FhirCallOpts = {}): Promise<Coverage> {
  return fhirGet<Coverage>({
    resourceType: 'Coverage',
    id,
    schema: CoverageSchema,
    ...opts,
  })
}

export async function searchCoverages(
  params: SearchCoveragesParams,
  opts: FhirCallOpts = {},
): Promise<Coverage[]> {
  return fhirSearch<Coverage>({
    resourceType: 'Coverage',
    searchParams: {
      patient: params.patient,
      status: params.status,
    },
    entrySchema: CoverageSchema,
    ...opts,
  })
}
