/**
 * lib/fhir/practitioner.ts
 *
 * Typed adapter for FHIR R4 Practitioner.
 * Spec: https://www.hl7.org/fhir/R4/practitioner.html
 *
 * `getPractitioner(id)` takes a raw FHIR id (no leading resource type).
 * The SMART `fhirUser` claim is delivered in the form `"Practitioner/abc"`
 * — callers parse that with `parsePractitionerReference()` and pass the
 * extracted id here.
 */

import { fhirGet, type FhirCallOpts } from './client'
import { PractitionerSchema, type Practitioner } from './types'

export async function getPractitioner(id: string, opts: FhirCallOpts = {}): Promise<Practitioner> {
  return fhirGet<Practitioner>({
    resourceType: 'Practitioner',
    id,
    schema: PractitionerSchema,
    ...opts,
  })
}

/**
 * Parse a FHIR reference like `"Practitioner/eb4eA-AKqkc2HnRMtUMzgaw3"`
 * and return the trailing id. Returns null if the reference isn't a
 * Practitioner reference (e.g. caller accidentally passed a Patient ref).
 */
export function parsePractitionerReference(ref: string): string | null {
  const match = /^Practitioner\/(.+)$/.exec(ref)
  if (!match) return null
  return match[1]
}
