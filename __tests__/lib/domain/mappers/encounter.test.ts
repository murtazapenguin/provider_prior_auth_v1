/**
 * Encounter mapper unit tests. Pure-function verification.
 */
import { describe, expect, it } from 'vitest'
import {
  mapEncounterToPrisma,
  mapPlaceOfService,
  pickAttendingPractitionerRef,
} from '@/lib/domain/mappers/encounter'
import type { Encounter as FhirEncounter } from '@/lib/fhir/types'

function makeEncounter(overrides: Partial<FhirEncounter> = {}): FhirEncounter {
  return {
    resourceType: 'Encounter',
    id: 'encounter-head-ct',
    meta: { versionId: '3' },
    status: 'in-progress',
    class: { code: 'AMB' },
    subject: { reference: 'Patient/patient-jordan-avery' },
    period: { start: '2026-05-05T09:00:00Z' },
    participant: [
      {
        type: [{ coding: [{ code: 'ATND' }] }],
        individual: { reference: 'Practitioner/provider-pcp-sarah-chen' },
      },
    ],
    ...overrides,
  }
}

describe('mapPlaceOfService', () => {
  it('maps AMB → 11 (office)', () => {
    expect(mapPlaceOfService(makeEncounter({ class: { code: 'AMB' } }))).toBe('11')
  })
  it('maps IMP → 21 (inpatient)', () => {
    expect(mapPlaceOfService(makeEncounter({ class: { code: 'IMP' } }))).toBe('21')
  })
  it('maps EMER → 23 (ED)', () => {
    expect(mapPlaceOfService(makeEncounter({ class: { code: 'EMER' } }))).toBe('23')
  })
  it('maps VR → 02 (telehealth)', () => {
    expect(mapPlaceOfService(makeEncounter({ class: { code: 'VR' } }))).toBe('02')
  })
  it('falls back to "11" when class.code is unknown', () => {
    expect(mapPlaceOfService(makeEncounter({ class: { code: 'XYZ' } }))).toBe('11')
  })
  it('reads a numeric POS from serviceType.coding[0].code when class is absent', () => {
    const enc = makeEncounter({
      class: undefined,
      serviceType: { coding: [{ code: '21' }] },
    })
    expect(mapPlaceOfService(enc)).toBe('21')
  })
})

describe('pickAttendingPractitionerRef', () => {
  it('prefers the ATND-typed participant', () => {
    const enc = makeEncounter({
      participant: [
        { type: [{ coding: [{ code: 'CON' }] }], individual: { reference: 'Practitioner/consultant' } },
        { type: [{ coding: [{ code: 'ATND' }] }], individual: { reference: 'Practitioner/attender' } },
      ],
    })
    expect(pickAttendingPractitionerRef(enc)).toBe('Practitioner/attender')
  })
  it('falls back to the first Practitioner participant when no ATND/PPRF', () => {
    const enc = makeEncounter({
      participant: [
        { individual: { reference: 'Practitioner/x' } },
        { individual: { reference: 'Practitioner/y' } },
      ],
    })
    expect(pickAttendingPractitionerRef(enc)).toBe('Practitioner/x')
  })
  it('returns null when there are no Practitioner participants', () => {
    const enc = makeEncounter({
      participant: [{ individual: { reference: 'RelatedPerson/p' } }],
    })
    expect(pickAttendingPractitionerRef(enc)).toBeNull()
  })
})

describe('mapEncounterToPrisma', () => {
  it('maps the head-ct encounter end-to-end', () => {
    const result = mapEncounterToPrisma(makeEncounter())
    expect(result).toEqual({
      id: 'encounter-head-ct',
      patientId: 'patient-jordan-avery',
      providerId: 'provider-pcp-sarah-chen',
      encounterDate: new Date('2026-05-05T09:00:00Z'),
      placeOfService: '11',
      fhirResourceId: 'encounter-head-ct',
      fhirVersionId: '3',
    })
  })

  it('throws when subject.reference is not a Patient reference', () => {
    expect(() =>
      mapEncounterToPrisma(makeEncounter({ subject: { reference: 'Group/g' } })),
    ).toThrow(/subject.reference is missing or not a Patient reference/)
  })

  it('returns null providerId when no Practitioner participant is present', () => {
    const enc = makeEncounter({ participant: [] })
    const result = mapEncounterToPrisma(enc)
    expect(result.providerId).toBeNull()
  })

  it('uses epoch when period.start is missing', () => {
    const enc = makeEncounter({ period: undefined })
    const result = mapEncounterToPrisma(enc)
    expect(result.encounterDate.getTime()).toBe(0)
  })
})
