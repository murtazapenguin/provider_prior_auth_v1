/**
 * @vitest-environment jsdom
 *
 * Component tests for `components/pa/SubmissionPacketPreview.tsx`.
 *
 * Phase 6 / Session 7 (T7 ui-engineer half) — the submission packet's
 * page-3+ supporting documents now come from real CachedDocumentReference
 * PDFs (assembled on the ai-engineer side in services/ai/submission_packet.py).
 *
 * The API response shape is UNCHANGED: the preview reads `packet_data` with
 * cited_documents as a structured list of label/sublabel pairs. The component
 * is generic — it iterates `cited_documents` as a heterogeneous list of
 * note + attachment rows regardless of how many real PDFs the backend appended.
 *
 * Test buckets (per ticket):
 *   1. 1-page packet (cover letter only)        → minimal cover + zero docs
 *   2. Multi-page packet with mixed content     → cover + codes + narrative + mixed-source docs
 *   3. Real-PDF appended pages (T7 backend)     → docs reference multiple source PDFs
 *   4. Empty packet (no supporting docs)        → cover + checklist only
 *
 * Plus core states: idle / generating / error, plus regenerate flow,
 * priority strip, and PDF download link.
 *
 * Maps to TC-ID: `WF-PROV-submission-packet-review` (extended).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import SubmissionPacketPreview from '@/components/pa/SubmissionPacketPreview'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface DeferredFetch<T = unknown> {
  promise: Promise<Response>
  resolve: (body: T) => void
  reject: (err: unknown) => void
}

/**
 * Build a fetch-result deferred so tests can control when the packet POST
 * resolves (lets us assert the "generating" spinner state before resolving).
 */
function makeDeferredFetch<T = unknown>(): DeferredFetch<T> {
  let resolve!: (body: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<Response>((res, rej) => {
    resolve = (body: T) => {
      res({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response)
    }
    reject = (err: unknown) => rej(err)
  })
  return { promise, resolve, reject }
}

function buildPacketResponse(
  overrides: Partial<{
    attachment_id: string
    pdf_url: string
    cached: boolean
    cited_documents: Array<{ kind: 'note' | 'attachment'; label: string; sublabel: string }>
    codes: Array<{
      code: string
      code_type: string
      modifier: string | null
      description: string
      is_primary: boolean
    }>
    priority: 'standard' | 'expedited' | 'urgent'
    priority_rationale: string | null
    narrative_paragraph: string | null
  }> = {},
) {
  return {
    attachment_id: overrides.attachment_id ?? 'att-test-packet',
    generated_at: '2026-05-08T10:00:00Z',
    narrative_paragraph: overrides.narrative_paragraph ?? null,
    cached: overrides.cached ?? false,
    pdf_url: overrides.pdf_url ?? '/submission-packets/pa-test.pdf',
    packet_data: {
      patient_name: 'Jordan Avery',
      dob: '1990-06-15T00:00:00Z',
      payer_name: 'UnitedHealthcare',
      provider_name: 'Dr. Alice Wong',
      specialty: 'Internal Medicine',
      generated_at: '2026-05-08T10:00:00Z',
      codes: overrides.codes ?? [
        {
          code: '70450',
          code_type: 'CPT',
          modifier: null,
          description: 'CT head/brain without contrast',
          is_primary: true,
        },
      ],
      priority: overrides.priority ?? 'standard',
      priority_rationale: overrides.priority_rationale ?? null,
      cited_documents: overrides.cited_documents ?? [],
      narrative_paragraph: overrides.narrative_paragraph ?? null,
    },
  }
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  // jsdom doesn't ship fetch by default; attach a vi mock.
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

// ─── Idle / generating / error ────────────────────────────────────────────────

describe('SubmissionPacketPreview — non-ready states', () => {
  it('renders idle state with a Generate button when autoGenerate=false', () => {
    render(
      <SubmissionPacketPreview paId="pa-idle" onPacketReady={() => {}} autoGenerate={false} />,
    )
    expect(screen.getByText('No submission packet yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /generate packet/i })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders generating state with a spinner while the fetch is pending', async () => {
    const deferred = makeDeferredFetch()
    fetchMock.mockReturnValue(deferred.promise)

    render(
      <SubmissionPacketPreview paId="pa-gen" onPacketReady={() => {}} autoGenerate />,
    )
    // The autoGenerate path schedules the fetch immediately on mount.
    expect(screen.getByText(/assembling submission packet/i)).toBeTruthy()
    expect(screen.getByLabelText('Loading')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pa/pa-gen/submission-packet',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders an error state with a Retry button when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'AI service down' }),
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-err" onPacketReady={() => {}} autoGenerate />,
    )
    await waitFor(() => {
      expect(screen.getByText(/failed to generate packet/i)).toBeTruthy()
    })
    expect(screen.getByText(/AI service down/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})

// ─── Ready states (the four ticket buckets) ───────────────────────────────────

describe('SubmissionPacketPreview — ready state (canonical packet shapes)', () => {
  it('Bucket 1 — renders a 1-page packet with cover letter only (no docs, no narrative)', async () => {
    const onReady = vi.fn()
    const response = buildPacketResponse({
      attachment_id: 'att-cover-only',
      cited_documents: [],
      narrative_paragraph: null,
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(<SubmissionPacketPreview paId="pa-cover" onPacketReady={onReady} autoGenerate />)

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    // Header fields rendered
    expect(screen.getByText('UnitedHealthcare')).toBeTruthy()
    expect(screen.getByText('Jordan Avery')).toBeTruthy()
    expect(screen.getByText('Dr. Alice Wong')).toBeTruthy()
    expect(screen.getByText('Internal Medicine')).toBeTruthy()

    // Single procedure code present
    expect(screen.getByText('70450')).toBeTruthy()
    expect(screen.getByText('CT head/brain without contrast')).toBeTruthy()

    // No narrative section
    expect(screen.queryByText('Clinical Summary')).toBeNull()

    // Empty cited_documents → manual override message
    expect(screen.getByText(/None — manual override only/i)).toBeTruthy()

    // onPacketReady fired with the attachment id
    expect(onReady).toHaveBeenCalledWith('att-cover-only')
  })

  it('Bucket 2 — renders a multi-page packet with mixed content: cover + codes + narrative + mixed-source docs', async () => {
    const response = buildPacketResponse({
      attachment_id: 'att-mixed',
      codes: [
        {
          code: '73721',
          code_type: 'CPT',
          modifier: 'RT',
          description: 'MRI lower extremity joint w/o contrast',
          is_primary: true,
        },
        {
          code: 'M23.205',
          code_type: 'ICD-10',
          modifier: null,
          description: 'Derangement of meniscus, right knee',
          is_primary: false,
        },
      ],
      narrative_paragraph:
        'Sam R. presents with a 4-month history of right knee pain consistent with internal derangement.',
      cited_documents: [
        // page-2 criteria checklist evidence (clinical note)
        { kind: 'note', label: 'Office Note', sublabel: '2026-04-15 · MD' },
        // page-3+ supporting docs (real PDFs appended by the ai-engineer counterpart)
        {
          kind: 'attachment',
          label: 'pt_records_2026-03.pdf',
          sublabel: 'application/pdf',
        },
        {
          kind: 'attachment',
          label: 'mri_request_form.pdf',
          sublabel: 'application/pdf',
        },
      ],
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-mixed" onPacketReady={() => {}} autoGenerate />,
    )

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    // Codes block — both CPT and ICD-10 rendered; modifier suffix joined with dash
    expect(screen.getByText('73721-RT')).toBeTruthy()
    expect(screen.getByText('M23.205')).toBeTruthy()
    expect(screen.getByText('MRI lower extremity joint w/o contrast')).toBeTruthy()
    expect(screen.getByText('Derangement of meniscus, right knee')).toBeTruthy()

    // Narrative section is present
    expect(screen.getByText('Clinical Summary')).toBeTruthy()
    expect(screen.getByText(/Sam R\. presents with a 4-month history/)).toBeTruthy()

    // Three cited documents — one note + two attachments
    expect(screen.getByText('Office Note')).toBeTruthy()
    expect(screen.getByText('pt_records_2026-03.pdf')).toBeTruthy()
    expect(screen.getByText('mri_request_form.pdf')).toBeTruthy()

    // Manual-override empty hint is NOT shown when docs exist
    expect(screen.queryByText(/None — manual override only/i)).toBeNull()
  })

  it('Bucket 3 — renders packet with real-PDF appended pages from multiple source PDFs (T7 backend assembly)', async () => {
    // Mirrors the ai-engineer counterpart's branch: page-3+ now appends the
    // actual CachedDocumentReference PDFs. The preview reads the same JSON;
    // each appended PDF surfaces as a cited_documents entry of kind=attachment.
    const response = buildPacketResponse({
      attachment_id: 'att-real-pdfs',
      narrative_paragraph:
        'Priya S. meets full criteria for chronic migraine without aura.',
      cited_documents: [
        { kind: 'note', label: 'H&P', sublabel: '2026-04-22 · MD' },
        { kind: 'note', label: 'Office Note', sublabel: '2026-03-10 · MD' },
        {
          kind: 'attachment',
          label: 'headache_diary_2026Q1.pdf',
          sublabel: 'application/pdf',
        },
        {
          kind: 'attachment',
          label: 'propranolol_trial_log.pdf',
          sublabel: 'application/pdf',
        },
        {
          kind: 'attachment',
          label: 'topiramate_trial_log.pdf',
          sublabel: 'application/pdf',
        },
      ],
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-real" onPacketReady={() => {}} autoGenerate />,
    )

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    // All five documents render — multiple real PDFs from different sources
    expect(screen.getByText('H&P')).toBeTruthy()
    expect(screen.getByText('Office Note')).toBeTruthy()
    expect(screen.getByText('headache_diary_2026Q1.pdf')).toBeTruthy()
    expect(screen.getByText('propranolol_trial_log.pdf')).toBeTruthy()
    expect(screen.getByText('topiramate_trial_log.pdf')).toBeTruthy()

    // Notes use their type as a label (TitleCased); attachments use their filename.
    // Both surface their sublabel in the same row.
    expect(screen.getByText('· 2026-04-22 · MD')).toBeTruthy()
    expect(screen.getAllByText('· application/pdf').length).toBe(3)
  })

  it('Bucket 4 — renders an empty packet (no supporting docs) with cover + codes only', async () => {
    const onReady = vi.fn()
    const response = buildPacketResponse({
      attachment_id: 'att-empty',
      narrative_paragraph: null,
      cited_documents: [],
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-empty" onPacketReady={onReady} autoGenerate />,
    )

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    // Cover header + codes block visible
    expect(screen.getByText('Jordan Avery')).toBeTruthy()
    expect(screen.getByText('Procedure & Diagnosis Codes')).toBeTruthy()

    // No narrative
    expect(screen.queryByText('Clinical Summary')).toBeNull()

    // Attached Documents section header present, with manual-override empty state
    expect(screen.getByText('Attached Documents')).toBeTruthy()
    expect(screen.getByText(/None — manual override only/i)).toBeTruthy()

    expect(onReady).toHaveBeenCalledWith('att-empty')
  })
})

// ─── Auxiliary behavior ───────────────────────────────────────────────────────

describe('SubmissionPacketPreview — auxiliary behavior', () => {
  it('renders the priority strip with rationale for non-standard priority', async () => {
    const response = buildPacketResponse({
      priority: 'urgent',
      priority_rationale: 'Suspected SAH — emergent imaging required',
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-prio" onPacketReady={() => {}} autoGenerate />,
    )

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    expect(
      screen.getByText(/Priority:\s*Urgent\s*—\s*Suspected SAH/i),
    ).toBeTruthy()
  })

  it('omits the priority strip for standard priority', async () => {
    const response = buildPacketResponse({ priority: 'standard', priority_rationale: null })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-std" onPacketReady={() => {}} autoGenerate />,
    )

    await waitFor(() =>
      expect(screen.getByText('Prior Authorization Submission')).toBeTruthy(),
    )

    expect(screen.queryByText(/Priority:/i)).toBeNull()
  })

  it('renders the Download PDF link pointing at the response pdf_url', async () => {
    const response = buildPacketResponse({ pdf_url: '/submission-packets/pa-dl-test.pdf' })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    render(
      <SubmissionPacketPreview paId="pa-dl" onPacketReady={() => {}} autoGenerate />,
    )

    const dlBtn = await screen.findByRole('button', { name: /download pdf/i })
    const anchor = dlBtn.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('/submission-packets/pa-dl-test.pdf')
    expect(anchor!.getAttribute('download')).not.toBeNull()
  })

  it('clicking Regenerate refires the fetch with regenerate: true', async () => {
    const first = buildPacketResponse({ attachment_id: 'att-first' })
    const second = buildPacketResponse({ attachment_id: 'att-regen' })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => first,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => second,
      } as Response)

    const onReady = vi.fn()
    render(
      <SubmissionPacketPreview paId="pa-regen" onPacketReady={onReady} autoGenerate />,
    )

    // Initial mount → autoGenerate fires fetch with regenerate: true.
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('att-first'))

    // First call body
    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall[0]).toBe('/api/pa/pa-regen/submission-packet')
    expect(JSON.parse(firstCall[1].body)).toEqual({ regenerate: true })

    // Click Regenerate — sends regenerate: true (consistent with autoGenerate semantics).
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() => expect(onReady).toHaveBeenCalledWith('att-regen'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = fetchMock.mock.calls[1]
    expect(JSON.parse(secondCall[1].body)).toEqual({ regenerate: true })
  })

  it('clicking Generate from idle dispatches a non-regenerate fetch', async () => {
    const response = buildPacketResponse({ attachment_id: 'att-from-idle' })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as Response)

    const onReady = vi.fn()
    render(
      <SubmissionPacketPreview
        paId="pa-idle-then-gen"
        onPacketReady={onReady}
        autoGenerate={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /generate packet/i }))

    await waitFor(() => expect(onReady).toHaveBeenCalledWith('att-from-idle'))
    const call = fetchMock.mock.calls[0]
    expect(JSON.parse(call[1].body)).toEqual({ regenerate: false })
  })
})
