/**
 * lib/fhir/encounter.ts
 *
 * Typed adapter for FHIR R4 Encounter.
 * Spec: https://www.hl7.org/fhir/R4/encounter.html
 *
 * Epic quirk handled in the schema: `period.end` is `null` for active
 * encounters; that's not a data quality issue.
 */

import { fhirGet, fhirSearch, type FhirCallOpts } from './client'
import { EncounterSchema, type Encounter } from './types'

export interface SearchEncountersParams {
  /** "Patient/{id}" reference. */
  patient: string
  /** e.g. "-date" for newest-first. */
  _sort?: string
  _count?: number
  status?: string
  /** Date comparator, e.g. "ge2024-01-01". */
  date?: string
}

export async function getEncounter(id: string, opts: FhirCallOpts = {}): Promise<Encounter> {
  return fhirGet<Encounter>({
    resourceType: 'Encounter',
    id,
    schema: EncounterSchema,
    ...opts,
  })
}

export async function searchEncounters(
  params: SearchEncountersParams,
  opts: FhirCallOpts = {},
): Promise<Encounter[]> {
  return fhirSearch<Encounter>({
    resourceType: 'Encounter',
    searchParams: {
      patient: params.patient,
      _sort: params._sort,
      _count: params._count !== undefined ? String(params._count) : undefined,
      status: params.status,
      date: params.date,
    },
    entrySchema: EncounterSchema,
    ...opts,
  })
}
