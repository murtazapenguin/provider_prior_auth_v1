import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AiInvalidResponseError, AiUnreachableError } from '@/lib/ai/penguinClient'

// Mock aiFetch so we never hit real network in tests
vi.mock('@/lib/ai/penguinClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/penguinClient')>()
  return {
    ...real,
    aiFetch: vi.fn(),
  }
})

import { aiFetch } from '@/lib/ai/penguinClient'
import { deriveCodesFromNotes } from '@/lib/ai/codeDerivation'

const HEAD_CT_REQUEST = {
  encounter_id: 'encounter-head-ct',
  notes: [{ id: 'n1', note_type: 'H&P', author_role: 'PCP', text: 'CT head ordered.' }],
}

const HEAD_CT_RESPONSE = {
  procedures: [{ code_type: 'CPT', code: '70450', modifier: null, description: 'CT head', confidence: 0.97, rationale: 'ordered' }],
  diagnoses: [{ code_type: 'ICD10', code: 'R51.9', description: 'Headache', confidence: 0.92, rationale: 'dx', is_primary: true }],
  prompt_version: 'code_derivation_v1',
  trace_id: null,
  cached: false,
}

describe('deriveCodesFromNotes', () => {
  beforeEach(() => {
    vi.mocked(aiFetch).mockReset()
  })

  it('returns validated response on success', async () => {
    vi.mocked(aiFetch).mockResolvedValueOnce(HEAD_CT_RESPONSE)
    const result = await deriveCodesFromNotes(HEAD_CT_REQUEST)
    expect(result.procedures[0].code).toBe('70450')
    expect(result.diagnoses[0].is_primary).toBe(true)
  })

  it('falls back to canned response on AiUnreachableError', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    const result = await deriveCodesFromNotes(HEAD_CT_REQUEST)
    expect(result.procedures.some((p) => p.code === '70450')).toBe(true)
    expect(result.cached).toBe(true)
  })

  it('propagates AiInvalidResponseError without fallback', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiInvalidResponseError('bad shape', 200, {}))
    await expect(deriveCodesFromNotes(HEAD_CT_REQUEST)).rejects.toBeInstanceOf(AiInvalidResponseError)
  })

  it('canned fallback throws for unknown encounter', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    await expect(
      deriveCodesFromNotes({ ...HEAD_CT_REQUEST, encounter_id: 'encounter-unknown' })
    ).rejects.toThrow(/no canned response/)
  })

  it('throws AiInvalidResponseError if response shape is wrong', async () => {
    vi.mocked(aiFetch).mockResolvedValueOnce({ unexpected: 'shape' })
    await expect(deriveCodesFromNotes(HEAD_CT_REQUEST)).rejects.toBeInstanceOf(AiInvalidResponseError)
  })
})
