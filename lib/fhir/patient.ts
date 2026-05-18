/**
 * lib/fhir/patient.ts
 *
 * Typed adapter for FHIR R4 Patient.
 * Spec: https://www.hl7.org/fhir/R4/patient.html
 */

import { fhirGet, fhirSearch, type FhirCallOpts } from './client'
import { PatientSchema, type Patient } from './types'

export interface SearchPatientsParams {
  identifier?: string
  family?: string
  given?: string
  /** YYYY-MM-DD or a FHIR-prefixed comparator like `ge2000-01-01`. */
  birthdate?: string
  /** Page size; Epic accepts up to 1000 but we default to caller's choice. */
  _count?: number
}

export async function getPatient(id: string, opts: FhirCallOpts = {}): Promise<Patient> {
  return fhirGet<Patient>({
    resourceType: 'Patient',
    id,
    schema: PatientSchema,
    ...opts,
  })
}

export async function searchPatients(
  params: SearchPatientsParams,
  opts: FhirCallOpts = {},
): Promise<Patient[]> {
  return fhirSearch<Patient>({
    resourceType: 'Patient',
    searchParams: normalizeParams(params),
    entrySchema: PatientSchema,
    ...opts,
  })
}

function normalizeParams(p: SearchPatientsParams): Record<string, string | undefined> {
  return {
    identifier: p.identifier,
    family: p.family,
    given: p.given,
    birthdate: p.birthdate,
    _count: p._count !== undefined ? String(p._count) : undefined,
  }
}
