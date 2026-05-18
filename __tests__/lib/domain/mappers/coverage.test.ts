/**
 * Coverage mapper unit tests. Pure functions; no DB.
 */
import { describe, expect, it } from 'vitest'
import {
  extractPayorDisplay,
  mapCoverageToPrisma,
  resolvePayerShortCode,
} from '@/lib/domain/mappers/coverage'
import type { Coverage as FhirCoverage } from '@/lib/fhir/types'

const base: FhirCoverage = {
  resourceType: 'Coverage',
  id: 'coverage-jordan-avery-uhc',
  meta: { versionId: '4' },
  status: 'active',
  type: {
    coding: [{ code: 'PPO', display: 'Preferred Provider Organization' }],
  },
  subscriberId: 'UHC9JA00142',
  beneficiary: { reference: 'Patient/patient-jordan-avery' },
  payor: [{ display: 'United Healthcare', reference: 'Organization/uhc-org-1' }],
  class: [
    { type: { coding: [{ code: 'group' }] }, value: 'GRP-00142', name: 'GRP-00142' },
    { type: { coding: [{ code: 'plan' }] }, value: 'CHOICE-PLUS', name: 'Choice Plus' },
  ],
  identifier: [{ system: 'http://benefit.uhc.com/member-id', value: 'UHC9JA00142' }],
  period: { start: '2026-01-01' },
}

describe('resolvePayerShortCode', () => {
  it('case-insensitively matches "UnitedHealthcare"', () => {
    expect(resolvePayerShortCode('UnitedHealthcare')).toBe('UHC')
  })
  it('matches "United Healthcare" with a space', () => {
    expect(resolvePayerShortCode('United Healthcare')).toBe('UHC')
  })
  it('matches "UHC" directly', () => {
    expect(resolvePayerShortCode('UHC')).toBe('UHC')
  })
  it('matches "Medicare (CMS)" verbose form', () => {
    expect(resolvePayerShortCode('Medicare (CMS)')).toBe('CMS')
  })
  it('returns null for an unknown payor display string', () => {
    expect(resolvePayerShortCode('Acme Insurance Co')).toBeNull()
  })
  it('returns null for undefined', () => {
    expect(resolvePayerShortCode(undefined)).toBeNull()
  })
})

describe('extractPayorDisplay', () => {
  it('returns the first payor display', () => {
    expect(extractPayorDisplay(base)).toBe('United Healthcare')
  })
  it('returns undefined when no payor entries', () => {
    expect(extractPayorDisplay({ ...base, payor: undefined })).toBeUndefined()
  })
})

describe('mapCoverageToPrisma', () => {
  it('maps the Jordan Avery UHC PPO coverage', () => {
    const result = mapCoverageToPrisma(base, 'payer-uhc')
    expect(result).toEqual({
      id: 'coverage-jordan-avery-uhc',
      patientId: 'patient-jordan-avery',
      payerId: 'payer-uhc',
      planName: 'Choice Plus',
      memberId: 'UHC9JA00142',
      groupNumber: 'GRP-00142',
      benefitCategory: 'Medical',
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
      isPrimary: true,
      fhirResourceId: 'coverage-jordan-avery-uhc',
      fhirVersionId: '4',
    })
  })

  it('falls back to identifier[0].value when subscriberId is missing', () => {
    const cov: FhirCoverage = { ...base, subscriberId: undefined }
    const result = mapCoverageToPrisma(cov, 'payer-uhc')
    expect(result.memberId).toBe('UHC9JA00142')
  })

  it('handles missing class entirely with sensible defaults', () => {
    const cov: FhirCoverage = { ...base, class: undefined }
    const result = mapCoverageToPrisma(cov, 'payer-uhc')
    expect(result.planName).toBe('Unspecified plan')
    expect(result.groupNumber).toBeNull()
  })

  it('detects Pharmacy benefitCategory from type.coding display', () => {
    const cov: FhirCoverage = {
      ...base,
      type: { coding: [{ code: 'pharmacy', display: 'Pharmacy Benefit' }] },
    }
    expect(mapCoverageToPrisma(cov, 'payer-uhc').benefitCategory).toBe('Pharmacy')
  })

  it('detects DME benefitCategory', () => {
    const cov: FhirCoverage = {
      ...base,
      type: { coding: [{ code: 'dme', display: 'Durable Medical Equipment' }] },
    }
    expect(mapCoverageToPrisma(cov, 'payer-uhc').benefitCategory).toBe('DME')
  })

  it('parses period.end when present', () => {
    const cov: FhirCoverage = { ...base, period: { start: '2026-01-01', end: '2026-12-31' } }
    const result = mapCoverageToPrisma(cov, 'payer-uhc')
    expect(result.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-12-31')
  })

  it('throws when beneficiary.reference is not a Patient reference', () => {
    const cov: FhirCoverage = { ...base, beneficiary: { reference: 'Group/g' } }
    expect(() => mapCoverageToPrisma(cov, 'payer-uhc')).toThrow(
      /beneficiary.reference is missing or not a Patient reference/,
    )
  })
})
