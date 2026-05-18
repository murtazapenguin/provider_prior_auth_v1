/**
 * lib/domain/mappers/patient.ts
 *
 * Pure mapping function from a FHIR R4 Patient resource to the Prisma
 * `Patient` create/update args. No I/O — `syncFromFhir` is the only place
 * that knows about both FHIR and Prisma at the same time.
 *
 * Rules (per phase-6-foundation.md mapping table):
 *   Patient.id (Prisma) = FHIR Patient.id (deliberately reused, not a cuid)
 *   Patient.firstName   = official-use HumanName.given[0], fallback to first
 *   Patient.lastName    = HumanName.family
 *   Patient.dob         = birthDate (parsed as UTC YYYY-MM-DD)
 *   Patient.sex         = gender (R4 enum)
 *   fhirResourceId      = mirrors id (explicit marker that this row was FHIR-synced)
 *   fhirVersionId       = meta.versionId, or null if absent
 */
import type { Patient as FhirPatient, HumanName } from '@/lib/fhir/types'

export interface PatientMapResult {
  id: string
  firstName: string
  lastName: string
  dob: Date
  sex: string
  fhirResourceId: string
  fhirVersionId: string | null
}

/**
 * Pick the best HumanName for display: prefer `use === "official"`, fall back
 * to the first entry. Per Epic's FHIR docs, every Patient has at least one
 * `name[]` entry; an empty `name[]` is treated as a validation error upstream
 * (zod allows undefined here so callers can decide).
 */
export function pickOfficialName(names: HumanName[] | undefined): HumanName | undefined {
  if (!names || names.length === 0) return undefined
  const official = names.find((n) => n.use === 'official')
  return official ?? names[0]
}

export function mapPatientToPrisma(fhir: FhirPatient): PatientMapResult {
  const name = pickOfficialName(fhir.name)

  const given = name?.given?.[0]
  const firstName =
    given && given.trim().length > 0
      ? given
      : name?.text?.split(/\s+/)[0] ?? 'Unknown'

  const lastName = name?.family && name.family.trim().length > 0 ? name.family : 'Unknown'

  // birthDate is YYYY-MM-DD per R4. We parse as UTC midnight to avoid TZ drift.
  // Patients with missing birthDate are rare in practice but we tolerate it
  // (epoch placeholder) so the mapper itself never throws.
  const dob = fhir.birthDate ? new Date(`${fhir.birthDate}T00:00:00Z`) : new Date(0)

  // Map gender → sex. We persist the same string ('male'|'female'|'other'|'unknown')
  // verbatim — Phase 1 used capitalized 'M'|'F'. Mapper output matches FHIR;
  // the domain doesn't care about case for now.
  const sex = fhir.gender ?? 'unknown'

  return {
    id: fhir.id,
    firstName,
    lastName,
    dob,
    sex,
    fhirResourceId: fhir.id,
    fhirVersionId: fhir.meta?.versionId ?? null,
  }
}
