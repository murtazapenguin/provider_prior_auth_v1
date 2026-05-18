'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, Spinner, StatusPill } from '@/components/ui'
import SubmissionPacketPreview from '@/components/pa/SubmissionPacketPreview'
import SubmitConfirmation from '@/components/pa/SubmitConfirmation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaCode {
  codeType: string
  code: string
  description: string
  modifier: string | null
  isPrimary: boolean
}

interface Citation {
  id: string
  sourceType: string
  sourceId: string
  supportingTexts: string[]
  reasoning: string | null
  confidence: number
}

interface CriterionResult {
  id: string
  status: string
  rationale: string | null
  confidence: number | null
  citations: Citation[]
  criterion: {
    id: string
    ordinal: number
    text: string
  }
}

interface PaData {
  id: string
  status: string
  payer: { name: string }
  encounter: {
    patient: { firstName: string; lastName: string }
    notes: { id: string; noteType: string; text: string }[]
  }
  codes: PaCode[]
  criteriaResults: CriterionResult[]
}

// ─── Result status badge ──────────────────────────────────────────────────────

function ResultBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pass: { label: 'Pass', cls: 'bg-green-100 text-green-800' },
    failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
    needs_info: { label: 'Needs info', cls: 'bg-amber-100 text-amber-800' },
    override: { label: 'Override', cls: 'bg-purple-100 text-purple-800' },
  }
  const v = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${v.cls}`}>
      {v.label}
    </span>
  )
}

// ─── Left panel — summary ─────────────────────────────────────────────────────

function ReviewSummary({ pa }: { pa: PaData }) {
  return (
    <div className="space-y-4 overflow-auto">
      {/* Patient / payer */}
      <Card>
        <h2 className="text-sm font-semibold text-surface-foreground mb-3">Patient &amp; payer</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-20 shrink-0">Patient</dt>
            <dd className="text-surface-foreground font-medium">
              {pa.encounter.patient.firstName} {pa.encounter.patient.lastName}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-20 shrink-0">Payer</dt>
            <dd className="text-surface-foreground">{pa.payer.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-20 shrink-0">Status</dt>
            <dd><StatusPill status={pa.status} size="sm" /></dd>
          </div>
        </dl>
      </Card>

      {/* Codes */}
      <Card>
        <h2 className="text-sm font-semibold text-surface-foreground mb-3">Procedure &amp; diagnosis codes</h2>
        <div className="space-y-2">
          {pa.codes.map((c) => (
            <div key={`${c.codeType}-${c.code}`} className="flex items-start gap-2">
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary shrink-0">
                {c.code}{c.modifier ? `-${c.modifier}` : ''}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-surface-foreground">{c.description}</p>
                <p className="text-xs text-muted-foreground">{c.codeType}{c.isPrimary ? ' · primary' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Criteria */}
      {pa.criteriaResults.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-surface-foreground mb-3">Criteria &amp; evidence</h2>
          <div className="space-y-4">
            {[...pa.criteriaResults]
              .sort((a, b) => a.criterion.ordinal - b.criterion.ordinal)
              .map((r) => (
                <div key={r.id} className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <ResultBadge status={r.status} />
                    <p className="text-xs text-surface-foreground leading-relaxed">{r.criterion.text}</p>
                  </div>
                  {r.rationale && (
                    <p className="text-xs text-muted-foreground pl-1 italic">{r.rationale}</p>
                  )}
                  {r.citations.length > 0 && (
                    <div className="pl-1 space-y-1">
                      {r.citations.flatMap((cit) =>
                        cit.supportingTexts.map((txt, i) => (
                          <blockquote
                            key={`${cit.id}-${i}`}
                            className="text-xs text-muted-foreground border-l-2 border-primary pl-2 py-0.5"
                          >
                            &ldquo;{txt}&rdquo;
                          </blockquote>
                        )),
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const { id: paId } = useParams<{ id: string }>()

  const [pa, setPa] = useState<PaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track whether a packet has been generated (enables submit button)
  const [packetAttachmentId, setPacketAttachmentId] = useState<string | null>(null)

  // Submit confirmation modal
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/pa/${paId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`PA not found (${r.status})`)
        return r.json() as Promise<PaData>
      })
      .then((data) => {
        setPa(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load PA')
        setLoading(false)
      })
  }, [paId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !pa) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-sm text-danger">{error ?? 'PA not found'}</p>
        <Link href="/queue"><Button variant="secondary">Back to queue</Button></Link>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <Link href={`/pa/${paId}`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to checklist
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm font-medium text-surface-foreground">
            Review &amp; Submit &mdash;{' '}
            {pa.encounter.patient.firstName} {pa.encounter.patient.lastName}
          </span>
        </div>
        <StatusPill status={pa.status} size="sm" />
      </div>

      {/* Two-panel body */}
      <div className="flex-1 h-0 grid grid-cols-2 gap-0 overflow-hidden">
        {/* Left: read-only summary */}
        <div className="overflow-auto px-6 py-4 border-r border-border">
          <ReviewSummary pa={pa} />
        </div>

        {/* Right: submission packet preview + actions */}
        <div className="flex flex-col h-full min-h-0">
          {/* PDF area — grows to fill */}
          <div className="flex-1 h-0 overflow-hidden">
            <SubmissionPacketPreview
              paId={paId}
              onPacketReady={(id) => setPacketAttachmentId(id)}
              autoGenerate
            />
          </div>

          {/* Submit action strip */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-border bg-surface">
            <p className="text-xs text-muted-foreground">
              {packetAttachmentId
                ? 'Packet ready — review above before submitting.'
                : 'Generating packet — submit will be enabled when ready.'}
            </p>
            <Button
              disabled={!packetAttachmentId}
              onClick={() => setConfirmOpen(true)}
            >
              Submit to payer
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      <SubmitConfirmation
        paId={paId}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}
