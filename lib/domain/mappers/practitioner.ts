/**
 * lib/domain/mappers/practitioner.ts
 *
 * Pure mapping from a FHIR R4 Practitioner resource to the Prisma `Provider`
 * create/update args. The model is named `Provider` in our schema (Phase 1
 * decision predates Phase 6); the FHIR resource type is `Practitioner`. Both
 * refer to the same clinical actor.
 *
 * Rules:
 *   Provider.id          = FHIR Practitioner.id (reused as our id)
 *   Provider.npi         = identifier[system === 'http://hl7.org/fhir/sid/us-npi'].value
 *                          fallback: first identifier value; further fallback: id
 *                          (only if Provider.npi has @unique constraint we need *something*)
 *   Provider.firstName   = official-use HumanName.given[0]
 *   Provider.lastName    = HumanName.family
 *   Provider.specialty   = qualification[0].code.text || qualification[0].code.coding[0].display
 *                          fallback: "Unspecified"
 *   fhirResourceId       = id (mirror)
 *   fhirVersionId        = meta.versionId
 */
import type { Practitioner as FhirPractitioner } from '@/lib/fhir/types'
import { pickOfficialName } from './patient'

export interface PractitionerMapResult {
  id: string
  npi: string
  firstName: string
  lastName: string
  specialty: string
  fhirResourceId: string
  fhirVersionId: string | null
}

const US_NPI_SYSTEM = 'http://hl7.org/fhir/sid/us-npi'

export function extractNpi(fhir: FhirPractitioner): string | null {
  const npiIdentifier = (fhir.identifier ?? []).find((i) => i.system === US_NPI_SYSTEM)
  if (npiIdentifier?.value) return npiIdentifier.value
  // Fall back to any identifier with a value, in case Epic emits the NPI
  // without the canonical system URL.
  const anyIdentifier = (fhir.identifier ?? []).find((i) => i.value)
  return anyIdentifier?.value ?? null
}

export function extractSpecialty(fhir: FhirPractitioner): string {
  const quals = fhir.qualification ?? []
  for (const q of quals) {
    const text = q.code?.text
    if (text && text.trim().length > 0) return text.trim()
    const display = q.code?.coding?.[0]?.display
    if (display && display.trim().length > 0) return display.trim()
  }
  return 'Unspecified'
}

export function mapPractitionerToPrisma(fhir: FhirPractitioner): PractitionerMapResult {
  const name = pickOfficialName(fhir.name)

  const given = name?.given?.[0]
  const firstName =
    given && given.trim().length > 0
      ? given
      : name?.text?.split(/\s+/)[0] ?? 'Unknown'

  const lastName = name?.family && name.family.trim().length > 0 ? name.family : 'Unknown'

  // npi is @unique on the schema — every Provider row needs a non-empty value.
  // When the FHIR resource omits an NPI we fall back to the FHIR id, prefixed
  // so it doesn't collide with real NPIs (digits-only by convention).
  const npi = extractNpi(fhir) ?? `fhir-${fhir.id}`

  return {
    id: fhir.id,
    npi,
    firstName,
    lastName,
    specialty: extractSpecialty(fhir),
    fhirResourceId: fhir.id,
    fhirVersionId: fhir.meta?.versionId ?? null,
  }
}
