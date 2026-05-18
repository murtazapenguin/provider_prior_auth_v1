import { describe, expect, it } from 'vitest'
import {
  getCannedDerivation,
  getCannedEvidence,
  getCannedSubmissionPacket,
} from '@/lib/ai/cannedResponses'

describe('getCannedEvidence', () => {
  it('returns passed result for Head CT criterion 1', () => {
    const result = getCannedEvidence('encounter-head-ct', 'criterion-head-ct-1')
    expect(result.criterion_id).toBe('criterion-head-ct-1')
    expect(result.status).toBe('passed')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].supporting_texts).toHaveLength(1)
    expect(result.model).toBe('canned')
    expect(result.cached).toBe(true)
  })

  it('returns needs_info for Knee MRI conservative therapy criterion', () => {
    const result = getCannedEvidence('encounter-knee-mri', 'criterion-knee-mri-1')
    expect(result.status).toBe('needs_info')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('returns needs_info for Botox amitriptyline criterion', () => {
    const result = getCannedEvidence('encounter-botox', 'criterion-botox-2')
    expect(result.status).toBe('needs_info')
  })

  it('returns passed for all three Botox dosing criterion', () => {
    const result = getCannedEvidence('encounter-botox', 'criterion-botox-3')
    expect(result.status).toBe('passed')
    expect(result.confidence).toBeGreaterThan(0.95)
  })

  it('throws for unknown encounter/criterion pair', () => {
    expect(() => getCannedEvidence('encounter-unknown', 'criterion-x')).toThrow(
      /no canned response/
    )
  })

  it('supporting_texts are non-empty strings on every entry', () => {
    const pairs = [
      ['encounter-head-ct', 'criterion-head-ct-1'],
      ['encounter-head-ct', 'criterion-head-ct-2'],
      ['encounter-head-ct', 'criterion-head-ct-3'],
      ['encounter-knee-mri', 'criterion-knee-mri-1'],
      ['encounter-knee-mri', 'criterion-knee-mri-2'],
      ['encounter-knee-mri', 'criterion-knee-mri-3'],
      ['encounter-botox', 'criterion-botox-1'],
      ['encounter-botox', 'criterion-botox-2'],
      ['encounter-botox', 'criterion-botox-3'],
    ] as const
    for (const [enc, crit] of pairs) {
      const result = getCannedEvidence(enc, crit)
      expect(result.citations[0].supporting_texts[0].length).toBeGreaterThan(10)
    }
  })
})

describe('getCannedDerivation', () => {
  it('returns CPT 70450 for Head CT', () => {
    const result = getCannedDerivation('encounter-head-ct')
    expect(result.procedures.some((p) => p.code === '70450')).toBe(true)
    expect(result.diagnoses.some((d) => d.is_primary)).toBe(true)
  })

  it('returns CPT 73721 for Knee MRI', () => {
    const result = getCannedDerivation('encounter-knee-mri')
    expect(result.procedures.some((p) => p.code === '73721')).toBe(true)
  })

  it('returns HCPCS J0585 for Botox', () => {
    const result = getCannedDerivation('encounter-botox')
    expect(result.procedures.some((p) => p.code === 'J0585')).toBe(true)
    expect(result.diagnoses.some((d) => d.code.startsWith('G43.7'))).toBe(true)
  })

  it('throws for unknown encounter', () => {
    expect(() => getCannedDerivation('encounter-unknown')).toThrow(/no canned response/)
  })
})

describe('getCannedSubmissionPacket', () => {
  it('returns a valid packet for Head CT', () => {
    const result = getCannedSubmissionPacket('encounter-head-ct')
    expect(result.pdf_url).toContain('.pdf')
    expect(result.narrative_paragraph.length).toBeGreaterThan(20)
    expect(result.model).toBe('canned')
  })

  it('returns a valid packet for Knee MRI', () => {
    const result = getCannedSubmissionPacket('encounter-knee-mri')
    expect(result.pdf_url).toContain('.pdf')
  })

  it('returns a valid packet for Botox', () => {
    const result = getCannedSubmissionPacket('encounter-botox')
    expect(result.pdf_url).toContain('.pdf')
  })

  it('throws for unknown encounter', () => {
    expect(() => getCannedSubmissionPacket('encounter-unknown')).toThrow(/no canned response/)
  })
})
