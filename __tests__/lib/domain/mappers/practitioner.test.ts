/**
 * Practitioner mapper unit tests.
 */
import { describe, expect, it } from 'vitest'
import {
  extractNpi,
  extractSpecialty,
  mapPractitionerToPrisma,
} from '@/lib/domain/mappers/practitioner'
import type { Practitioner as FhirPractitioner } from '@/lib/fhir/types'

const base: FhirPractitioner = {
  resourceType: 'Practitioner',
  id: 'provider-pcp-sarah-chen',
  meta: { versionId: '1' },
  identifier: [{ system: 'http://hl7.org/fhir/sid/us-npi', value: '1234567890' }],
  active: true,
  name: [
    {
      use: 'official',
      text: 'Sarah Chen, MD',
      family: 'Chen',
      given: ['Sarah'],
      suffix: ['MD'],
    },
  ],
  qualification: [
    {
      code: {
        text: 'Internal Medicine',
        coding: [{ code: '207R00000X', display: 'Internal Medicine' }],
      },
    },
  ],
}

describe('extractNpi', () => {
  it('picks the us-npi identifier value', () => {
    expect(extractNpi(base)).toBe('1234567890')
  })
  it('falls back to first identifier when us-npi system is not present', () => {
    const p: FhirPractitioner = {
      ...base,
      identifier: [{ system: 'http://hl7.org/fhir/sid/other', value: 'XYZ' }],
    }
    expect(extractNpi(p)).toBe('XYZ')
  })
  it('returns null when there are no identifiers with a value', () => {
    const p: FhirPractitioner = { ...base, identifier: [] }
    expect(extractNpi(p)).toBeNull()
  })
})

describe('extractSpecialty', () => {
  it('returns qualification[0].code.text when present', () => {
    expect(extractSpecialty(base)).toBe('Internal Medicine')
  })
  it('falls back to qualification[0].code.coding[0].display when text is empty', () => {
    const p: FhirPractitioner = {
      ...base,
      qualification: [{ code: { coding: [{ display: 'Cardiology' }] } }],
    }
    expect(extractSpecialty(p)).toBe('Cardiology')
  })
  it('returns "Unspecified" when no qualification entries exist', () => {
    const p: FhirPractitioner = { ...base, qualification: undefined }
    expect(extractSpecialty(p)).toBe('Unspecified')
  })
})

describe('mapPractitionerToPrisma', () => {
  it('maps Dr. Sarah Chen end-to-end', () => {
    const result = mapPractitionerToPrisma(base)
    expect(result).toEqual({
      id: 'provider-pcp-sarah-chen',
      npi: '1234567890',
      firstName: 'Sarah',
      lastName: 'Chen',
      specialty: 'Internal Medicine',
      fhirResourceId: 'provider-pcp-sarah-chen',
      fhirVersionId: '1',
    })
  })

  it('uses a fhir-prefixed npi when the Practitioner has no NPI identifier', () => {
    const p: FhirPractitioner = { ...base, identifier: [] }
    const result = mapPractitionerToPrisma(p)
    expect(result.npi).toBe(`fhir-${p.id}`)
  })

  it('uses fallback name parts when given/family are missing', () => {
    const p: FhirPractitioner = {
      ...base,
      name: [{ text: 'Mononymous Doctor', family: undefined, given: undefined }],
    }
    const result = mapPractitionerToPrisma(p)
    expect(result.firstName).toBe('Mononymous')
    expect(result.lastName).toBe('Unknown')
  })
})
