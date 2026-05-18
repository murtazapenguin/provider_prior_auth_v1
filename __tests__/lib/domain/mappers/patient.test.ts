/**
 * Patient mapper unit tests. Pure-function verification; no DB / no FHIR.
 */
import { describe, expect, it } from 'vitest'
import { mapPatientToPrisma, pickOfficialName } from '@/lib/domain/mappers/patient'
import type { Patient as FhirPatient } from '@/lib/fhir/types'

const base: FhirPatient = {
  resourceType: 'Patient',
  id: 'patient-jordan-avery',
  meta: { versionId: '7' },
  name: [
    { use: 'usual', text: 'Jordan A.', family: 'Avery', given: ['Jordan', 'A.'] },
    { use: 'official', text: 'Jordan Avery', family: 'Avery', given: ['Jordan'] },
  ],
  gender: 'female',
  birthDate: '1968-03-12',
}

describe('pickOfficialName', () => {
  it('returns the official-use HumanName when present', () => {
    const result = pickOfficialName(base.name)
    expect(result?.use).toBe('official')
  })

  it('falls back to the first entry when no official-use is present', () => {
    const names = [{ use: 'nickname', family: 'X' }, { family: 'Y' }]
    const result = pickOfficialName(names)
    expect(result?.use).toBe('nickname')
  })

  it('returns undefined for empty or undefined input', () => {
    expect(pickOfficialName(undefined)).toBeUndefined()
    expect(pickOfficialName([])).toBeUndefined()
  })
})

describe('mapPatientToPrisma', () => {
  it('maps Jordan Avery to Prisma create args using the official HumanName', () => {
    const result = mapPatientToPrisma(base)
    expect(result).toEqual({
      id: 'patient-jordan-avery',
      firstName: 'Jordan',
      lastName: 'Avery',
      dob: new Date('1968-03-12T00:00:00Z'),
      sex: 'female',
      fhirResourceId: 'patient-jordan-avery',
      fhirVersionId: '7',
    })
  })

  it('falls back to first HumanName when no official-use entry', () => {
    const patient: FhirPatient = {
      ...base,
      name: [{ family: 'Doe', given: ['Jane'] }],
    }
    const result = mapPatientToPrisma(patient)
    expect(result.firstName).toBe('Jane')
    expect(result.lastName).toBe('Doe')
  })

  it('defaults sex to "unknown" when gender is missing', () => {
    const patient: FhirPatient = {
      resourceType: 'Patient',
      id: 'p-1',
      name: [{ given: ['Nobody'], family: 'Test' }],
    }
    const result = mapPatientToPrisma(patient)
    expect(result.sex).toBe('unknown')
  })

  it('defaults firstName when given[] is missing or empty', () => {
    const patient: FhirPatient = {
      resourceType: 'Patient',
      id: 'p-2',
      name: [{ text: 'Solomon Grundy', family: 'Grundy' }],
    }
    const result = mapPatientToPrisma(patient)
    expect(result.firstName).toBe('Solomon')
    expect(result.lastName).toBe('Grundy')
  })

  it('parses birthDate as UTC midnight', () => {
    const patient: FhirPatient = { ...base, birthDate: '1985-07-22' }
    const result = mapPatientToPrisma(patient)
    expect(result.dob.toISOString()).toBe('1985-07-22T00:00:00.000Z')
  })

  it('mirrors fhir.id into fhirResourceId; null versionId when meta missing', () => {
    const patient: FhirPatient = { ...base, meta: undefined }
    const result = mapPatientToPrisma(patient)
    expect(result.fhirResourceId).toBe(patient.id)
    expect(result.fhirVersionId).toBeNull()
  })

  it('treats blank given[0] as a fallback trigger', () => {
    const patient: FhirPatient = {
      ...base,
      name: [{ use: 'official', text: 'WhiteSpace Smith', family: 'Smith', given: ['   '] }],
    }
    const result = mapPatientToPrisma(patient)
    expect(result.firstName).toBe('WhiteSpace')
  })
})
