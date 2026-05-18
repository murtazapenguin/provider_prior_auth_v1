import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AiInvalidResponseError, AiUnreachableError } from '@/lib/ai/penguinClient'

vi.mock('@/lib/ai/penguinClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/penguinClient')>()
  return { ...real, aiFetch: vi.fn() }
})

import { aiFetch } from '@/lib/ai/penguinClient'
import { generateSubmissionPacket } from '@/lib/ai/submissionPacket'

const AI_RESPONSE = {
  pdf_url: '/submission-packets/pa-test.pdf',
  attachment_id: 'att-1',
  generated_at: '2026-05-07T00:00:00Z',
  narrative_paragraph: 'Jordan A. presents with thunderclap headache.',
  prompt_version: 'cover_letter_v1',
  model: 'claude-haiku-4-5',
  trace_id: null,
  cached: false,
}

describe('generateSubmissionPacket', () => {
  beforeEach(() => { vi.mocked(aiFetch).mockReset() })

  it('returns validated response on success', async () => {
    vi.mocked(aiFetch).mockResolvedValueOnce(AI_RESPONSE)
    const result = await generateSubmissionPacket('pa-test')
    expect(result.pdf_url).toBe('/submission-packets/pa-test.pdf')
    expect(result.narrative_paragraph.length).toBeGreaterThan(0)
  })

  it('falls back to canned response on AiUnreachableError when encounterId provided', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    const result = await generateSubmissionPacket('pa-test', { encounterId: 'encounter-head-ct' })
    expect(result.model).toBe('canned')
    expect(result.pdf_url).toContain('.pdf')
  })

  it('propagates AiUnreachableError when no encounterId provided', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiUnreachableError('down'))
    await expect(generateSubmissionPacket('pa-test')).rejects.toBeInstanceOf(AiUnreachableError)
  })

  it('propagates AiInvalidResponseError without fallback', async () => {
    vi.mocked(aiFetch).mockRejectedValueOnce(new AiInvalidResponseError('bad', 200, {}))
    await expect(
      generateSubmissionPacket('pa-test', { encounterId: 'encounter-head-ct' })
    ).rejects.toBeInstanceOf(AiInvalidResponseError)
  })

  it('passes regenerate flag through to request', async () => {
    vi.mocked(aiFetch).mockResolvedValueOnce(AI_RESPONSE)
    await generateSubmissionPacket('pa-regen', { regenerate: true })
    expect(vi.mocked(aiFetch)).toHaveBeenCalledWith(
      '/generate-submission-packet',
      expect.objectContaining({ regenerate: true, pa_id: 'pa-regen' })
    )
  })
})
