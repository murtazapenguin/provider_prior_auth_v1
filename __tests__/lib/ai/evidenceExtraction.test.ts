import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AiInvalidResponseError, AiUnreachableError } from '@/lib/ai/penguinClient'

vi.mock('@/lib/ai/penguinClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/penguinClient')>()
  return { ...real, aiFetch: vi.fn() }
})

import { aiFetch } from '@/lib/ai/penguinClient'
import { extractEvidence } from '@/lib/ai/evidenceExtraction'

const SOURCES = [
  { sourceType: 'clinical_note' as const, sourceId: 'note-head-ct-hp', text: 'thunderclap headache...' },
]

const AI_RESPONSE = {
  criterion_id: 'criterion-head-ct-1',
  status: 'passed',
  rationale: 'thunderclap documented',
  reasoning: 'thunderclap documented',
  confidence: 0.97,
  citations: [
    {
      source_type: 'clinical_note',
      source_id: 'note-head-ct-hp',
      supporting_texts: ['thunderclap headache...'],
      reasoning: 'noted',
      confidence: 0.97,
      bboxes: [],
      line_numbers: [],
    },
  ],
  model: 'claude-sonnet-4-5',
  prompt_version: 'evidence_extraction_v1',
  cached: false,
  trace_id: null,
  citation_validation: 'all_valid',
}

describe('extractEvidence', () => {
  beforeEach(() => { vi.mocked(aiFetch).mockReset() })

  it('returns validated response on success', async () => {
    vi.mocked(aiFetch).mockResolvedValueOnce(AI_RESPONSE)
    const result = await extractEvidence(
      'pa-1',
      'criterion-head-ct-1',
      'New headache pattern',
      SOURCES,
      'encounter-head-ct'
    )
    expect(result.status).toBe('passed')
    expect(result.citations).toHaveLength(1)
  })

  it('falls back to canned response on AiUnreachableError when encounterId provided', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    const result = await extractEvidence(
      'pa-1',
      'criterion-head-ct-1',
      'New headache pattern',
      SOURCES,
      'encounter-head-ct'
    )
    expect(result.status).toBe('passed')
    expect(result.model).toBe('canned')
    expect(result.cached).toBe(true)
  })

  it('propagates AiUnreachableError when no encounterId provided', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    await expect(
      extractEvidence('pa-1', 'criterion-head-ct-1', 'text', SOURCES)
    ).rejects.toBeInstanceOf(AiUnreachableError)
  })

  it('propagates AiInvalidResponseError without fallback', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiInvalidResponseError('bad', 200, {}))
    await expect(
      extractEvidence('pa-1', 'criterion-head-ct-1', 'text', SOURCES, 'encounter-head-ct')
    ).rejects.toBeInstanceOf(AiInvalidResponseError)
  })

  it('canned fallback returns needs_info for Botox amitriptyline criterion', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    const result = await extractEvidence(
      'pa-2',
      'criterion-botox-2',
      'amitriptyline ≥8 weeks',
      SOURCES,
      'encounter-botox'
    )
    expect(result.status).toBe('needs_info')
  })
})
