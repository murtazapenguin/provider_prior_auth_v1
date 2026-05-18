'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button, Spinner } from '@/components/ui'

interface PaCode {
  code: string
  code_type: string
  modifier: string | null
  description: string
  is_primary: boolean
}

interface CitedDocument {
  kind: 'note' | 'attachment'
  label: string
  sublabel: string
}

interface PacketData {
  patient_name: string
  dob: string
  payer_name: string
  provider_name: string
  specialty: string
  generated_at: string
  codes: PaCode[]
  priority: 'standard' | 'expedited' | 'urgent'
  priority_rationale: string | null
  cited_documents: CitedDocument[]
  narrative_paragraph: string | null
}

interface PacketResult {
  attachment_id: string
  generated_at: string
  narrative_paragraph: string | null
  cached: boolean
  pdf_url: string
  packet_data: PacketData
}

type State =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'ready'; result: PacketResult }
  | { phase: 'error'; message: string }

interface SubmissionPacketPreviewProps {
  paId: string
  onPacketReady: (attachmentId: string) => void
  autoGenerate?: boolean
}

export default function SubmissionPacketPreview({
  paId,
  onPacketReady,
  autoGenerate = false,
}: SubmissionPacketPreviewProps) {
  const [state, setState] = useState<State>({ phase: autoGenerate ? 'generating' : 'idle' })

  const generate = useCallback(
    async (regenerate: boolean) => {
      setState({ phase: 'generating' })
      try {
        const res = await fetch(`/api/pa/${paId}/submission-packet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regenerate }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`)
        }
        const result: PacketResult = await res.json()
        setState({ phase: 'ready', result })
        onPacketReady(result.attachment_id)
      } catch (err) {
        setState({ phase: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      }
    },
    [paId, onPacketReady],
  )

  // Always regenerate on mount so the preview reflects latest criteria state (overrides, rechecks)
  useEffect(() => {
    if (autoGenerate) generate(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.phase === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p className="text-sm">No submission packet yet.</p>
        <Button onClick={() => generate(false)}>Generate packet</Button>
      </div>
    )
  }

  if (state.phase === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Spinner size="lg" />
        <p className="text-sm font-medium">Assembling submission packet&hellip;</p>
        <p className="text-xs">This takes ~3–5 seconds including the narrative summary.</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-danger font-medium">Failed to generate packet</p>
        <p className="text-xs text-muted-foreground">{state.message}</p>
        <Button variant="outline" onClick={() => generate(false)}>Retry</Button>
      </div>
    )
  }

  const { result } = state
  const { packet_data: d } = result

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable document area */}
      <div className="flex-1 h-0 overflow-y-auto bg-slate-100 px-6 py-6">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-border">
          {/* Document header */}
          <div className="px-8 py-6 border-b border-border bg-primary/5 rounded-t-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-base font-bold text-surface-foreground uppercase tracking-wide">
                  Prior Authorization Submission
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">{d.payer_name}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <p>{new Date(d.generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
              <div>
                <dt className="text-muted-foreground">Patient</dt>
                <dd className="font-medium text-surface-foreground">{d.patient_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date of birth</dt>
                <dd className="font-medium text-surface-foreground">
                  {new Date(d.dob).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ordering provider</dt>
                <dd className="font-medium text-surface-foreground">{d.provider_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Specialty</dt>
                <dd className="font-medium text-surface-foreground">{d.specialty}</dd>
              </div>
            </dl>
          </div>

          {/* Codes */}
          <div className="px-8 py-5 border-b border-border">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Procedure &amp; Diagnosis Codes
            </h2>
            <div className="space-y-2">
              {d.codes.map((c) => (
                <div key={`${c.code_type}-${c.code}`} className="flex items-start gap-2.5">
                  <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                    {c.code}{c.modifier ? `-${c.modifier}` : ''}
                  </span>
                  <div>
                    <span className="text-xs text-surface-foreground">{c.description}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">
                      {c.code_type}{c.is_primary ? ' · primary' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {d.priority && d.priority !== 'standard' && (
              <p className="mt-3 text-xs font-medium text-primary">
                Priority: {d.priority.charAt(0).toUpperCase() + d.priority.slice(1)}
                {d.priority_rationale ? ` — ${d.priority_rationale}` : ''}
              </p>
            )}
          </div>

          {/* Narrative */}
          {d.narrative_paragraph && (
            <div className="px-8 py-5 border-b border-border">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Clinical Summary
              </h2>
              <p className="text-xs text-surface-foreground leading-relaxed">{d.narrative_paragraph}</p>
            </div>
          )}

          {/* Documents included — replaces the internal criteria checklist.
              Mirrors what's actually attached to the PDF packet. */}
          <div className="px-8 py-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Attached Documents
            </h2>
            <p className="text-xs text-surface-foreground mb-3">The following documents are attached:</p>
            {d.cited_documents.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                None — manual override only.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {d.cited_documents.map((doc, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <svg
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <div className="min-w-0">
                      <span className="font-medium text-surface-foreground">{doc.label}</span>
                      {doc.sublabel && (
                        <span className="text-muted-foreground ml-1.5">· {doc.sublabel}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Bottom action strip */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-border bg-surface">
        <span className="text-xs text-muted-foreground">
          {result.cached ? 'Cached' : 'Generated'} &middot;{' '}
          {new Date(result.generated_at).toLocaleTimeString()}
        </span>
        <div className="flex items-center gap-2">
          <a href={result.pdf_url} download target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">Download PDF</Button>
          </a>
          <Button variant="outline" size="sm" onClick={() => generate(true)}>
            Regenerate
          </Button>
        </div>
      </div>
    </div>
  )
}
