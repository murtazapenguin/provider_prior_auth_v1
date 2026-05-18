/**
 * lib/domain/mappers/encounter.ts
 *
 * Pure mapping from a FHIR R4 Encounter resource to the Prisma `Encounter`
 * create/update args. No I/O.
 *
 * Rules:
 *   Encounter.id            = FHIR Encounter.id
 *   Encounter.patientId     = parsed from subject.reference ("Patient/<id>")
 *   Encounter.providerId    = parsed from participant[].individual.reference
 *                             of "Practitioner/<id>" (the attending). Falls
 *                             back to the first practitioner participant.
 *   Encounter.encounterDate = period.start
 *   Encounter.placeOfService = derived via `mapPlaceOfService` from class.code
 *                              (Epic exposes `AMB`/`IMP`/`EMER`/`HH` etc.) or
 *                              from serviceType when class is absent.
 *   fhirResourceId          = mirrors id
 *   fhirVersionId           = meta.versionId
 */
import type { Encounter as FhirEncounter } from '@/lib/fhir/types'

export interface EncounterMapResult {
  id: string
  patientId: string
  providerId: string | null
  encounterDate: Date
  placeOfService: string
  fhirResourceId: string
  fhirVersionId: string | null
}

/**
 * Translate the HL7 V3 ActCode class.code into a CMS Place of Service code
 * (the two-character string we persist).
 *
 * Lookup table is hand-curated for the codes Epic emits in practice. Anything
 * we don't recognize falls back to "11" (office) so the field is never empty;
 * the placeholder is observable in audit if it matters later.
 *
 * Sources:
 *   HL7 V3 ActCode: https://terminology.hl7.org/CodeSystem-v3-ActCode.html
 *   CMS POS Codes:  https://www.cms.gov/medicare/coding-billing/place-of-service-codes
 */
const ENCOUNTER_CLASS_TO_POS: Record<string, string> = {
  AMB: '11', // Ambulatory → Office
  IMP: '21', // Inpatient → Hospital
  EMER: '23', // Emergency → ED
  VR: '02', // Virtual → Telehealth (provided in patient's home)
  HH: '12', // Home Health
  SS: '11', // Short-stay → Office (closest CMS equivalent)
  OBSENC: '22', // Observation → Outpatient hospital
}

export function mapPlaceOfService(fhir: FhirEncounter): string {
  const classCode = fhir.class?.code
  if (classCode && ENCOUNTER_CLASS_TO_POS[classCode]) {
    return ENCOUNTER_CLASS_TO_POS[classCode]
  }

  // Some Epic tenants encode the POS directly in serviceType.coding[0].code
  // as a CMS POS string. Try that next.
  const serviceTypeCode = fhir.serviceType?.coding?.[0]?.code
  if (serviceTypeCode && /^\d{2}$/.test(serviceTypeCode)) {
    return serviceTypeCode
  }

  return '11'
}

function extractIdFromReference(ref: string | undefined, expectedType: string): string | null {
  if (!ref) return null
  const prefix = `${expectedType}/`
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null
}

/**
 * Find the attending/primary practitioner reference on an Encounter.
 * Preference order:
 *   1. participant with type.coding[].code === 'ATND' (attender)
 *   2. participant with type.coding[].code === 'PPRF' (primary performer)
 *   3. first participant.individual that resolves to a Practitioner reference
 */
export function pickAttendingPractitionerRef(fhir: FhirEncounter): string | null {
  const participants = fhir.participant ?? []
  if (participants.length === 0) return null

  const priorityCodes = ['ATND', 'PPRF']

  for (const priorityCode of priorityCodes) {
    for (const p of participants) {
      const codes = (p.type ?? []).flatMap((t) => t.coding ?? [])
      if (codes.some((c) => c.code === priorityCode)) {
        const ref = p.individual?.reference
        if (ref && ref.startsWith('Practitioner/')) return ref
      }
    }
  }

  // Fall back to the first Practitioner-typed participant.
  for (const p of participants) {
    const ref = p.individual?.reference
    if (ref && ref.startsWith('Practitioner/')) return ref
  }

  return null
}

export function mapEncounterToPrisma(fhir: FhirEncounter): EncounterMapResult {
  const patientId = extractIdFromReference(fhir.subject?.reference, 'Patient')
  if (!patientId) {
    throw new Error(
      `mapEncounterToPrisma: Encounter ${fhir.id} subject.reference is missing or not a Patient reference`,
    )
  }

  const attendingRef = pickAttendingPractitionerRef(fhir)
  const providerId = attendingRef ? extractIdFromReference(attendingRef, 'Practitioner') : null

  const startIso = fhir.period?.start
  const encounterDate = startIso ? new Date(startIso) : new Date(0)

  return {
    id: fhir.id,
    patientId,
    providerId,
    encounterDate,
    placeOfService: mapPlaceOfService(fhir),
    fhirResourceId: fhir.id,
    fhirVersionId: fhir.meta?.versionId ?? null,
  }
}
