/**
 * lib/fhir/observation.ts
 *
 * Typed adapter for FHIR R4 Observation.
 * Spec: https://www.hl7.org/fhir/R4/observation.html
 *
 * value[x] polymorphism: we model `valueQuantity`, `valueCodeableConcept`,
 * `valueString`, and `valueBoolean`. Other variants are discarded. Callers
 * that need typed access should check which variant is present.
 */

import { fhirSearch, type FhirCallOpts } from './client'
import { ObservationSchema, type Observation } from './types'

export interface SearchObservationsParams {
  /** "Patient/{id}" reference. */
  patient: string
  /** Token like "vital-signs", "laboratory", "survey", "exam". */
  category?: string
  /** LOINC / SNOMED token, e.g. "http://loinc.org|55284-4". */
  code?: string
  date?: string
}

export async function searchObservations(
  params: SearchObservationsParams,
  opts: FhirCallOpts = {},
): Promise<Observation[]> {
  return fhirSearch<Observation>({
    resourceType: 'Observation',
    searchParams: {
      patient: params.patient,
      category: params.category,
      code: params.code,
      date: params.date,
    },
    entrySchema: ObservationSchema,
    ...opts,
  })
}
