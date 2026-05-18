/**
 * ServiceRequest mapper unit tests.
 */
import { describe, expect, it } from 'vitest'
import {
  extractDiagnosisCodes,
  extractEncounterReference,
  extractPatientReference,
  extractProcedureCode,
} from '@/lib/domain/mappers/serviceRequest'
import type { ServiceRequest as FhirServiceRequest } from '@/lib/fhir/types'

const base: FhirServiceRequest = {
  resourceType: 'ServiceRequest',
  id: 'sr-headct-jordan-1',
  status: 'active',
  intent: 'order',
  code: {
    text: 'CT head/brain without contrast',
    coding: [
      {
        system: 'http://www.ama-assn.org/go/cpt',
        code: '70450',
        display: 'CT head/brain without contrast',
      },
    ],
  },
  subject: { reference: 'Patient/patient-jordan-avery' },
  encounter: { reference: 'Encounter/encounter-head-ct' },
  reasonCode: [
    {
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'R51.9' }],
    },
  ],
}

describe('extractProcedureCode', () => {
  it('extracts a CPT code by system URL', () => {
    expect(extractProcedureCode(base)).toEqual({
      codeType: 'CPT',
      code: '70450',
      description: 'CT head/brain without contrast',
    })
  })

  it('extracts an HCPCS code by alternate system URL', () => {
    const sr: FhirServiceRequest = {
      ...base,
      code: {
        text: 'Power wheelchair',
        coding: [
          {
            system: 'http://hl7.org/fhir/sid/hcpcs',
            code: 'K0856',
            display: 'Power wheelchair group 3',
          },
        ],
      },
    }
    expect(extractProcedureCode(sr)).toMatchObject({ codeType: 'HCPCS', code: 'K0856' })
  })

  it('heuristically classifies a 5-digit code as CPT when system is missing', () => {
    const sr: FhirServiceRequest = {
      ...base,
      code: { coding: [{ code: '73721' }] },
    }
    expect(extractProcedureCode(sr)?.codeType).toBe('CPT')
  })

  it('heuristically classifies a letter+4-digit code as HCPCS', () => {
    const sr: FhirServiceRequest = {
      ...base,
      code: { coding: [{ code: 'K0856' }] },
    }
    expect(extractProcedureCode(sr)?.codeType).toBe('HCPCS')
  })

  it('returns null when no coding entries are present', () => {
    const sr: FhirServiceRequest = { ...base, code: { text: 'free text' } }
    expect(extractProcedureCode(sr)).toBeNull()
  })
})

describe('extractDiagnosisCodes', () => {
  it('returns deduped ICD-10 codes from reasonCode', () => {
    const sr: FhirServiceRequest = {
      ...base,
      reasonCode: [
        { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'R51.9' }] },
        { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'R51.9' }] },
        { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10' }] },
      ],
    }
    expect(extractDiagnosisCodes(sr).sort()).toEqual(['I10', 'R51.9'])
  })

  it('returns empty array when reasonCode is absent', () => {
    expect(extractDiagnosisCodes({ ...base, reasonCode: undefined })).toEqual([])
  })
})

describe('extractPatientReference + extractEncounterReference', () => {
  it('parses both references', () => {
    expect(extractPatientReference(base)).toBe('patient-jordan-avery')
    expect(extractEncounterReference(base)).toBe('encounter-head-ct')
  })
  it('returns null for non-matching prefix', () => {
    const sr: FhirServiceRequest = { ...base, subject: { reference: 'Group/p' } }
    expect(extractPatientReference(sr)).toBeNull()
  })
})
