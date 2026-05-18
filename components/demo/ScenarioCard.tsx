'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, Button } from '@/components/ui'

export interface ScenarioCardProps {
  encounterId: string
  title: string
  patientName: string
  patientAge: number
  patientSex: string
  specialty: string
  code: string
  codeType: 'CPT' | 'HCPCS'
  payer: string
  demonstrates: string[]
  firstPassOutcome: string
  providerAction: string
  postSubmission: string
  estimatedMinutes: number
}

export default function ScenarioCard({
  encounterId,
  title,
  patientName,
  patientAge,
  patientSex,
  specialty,
  code,
  codeType,
  payer,
  demonstrates,
  firstPassOutcome,
  providerAction,
  postSubmission,
  estimatedMinutes,
}: ScenarioCardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Request failed with status ${res.status}`)
      }
      router.push(`/encounter/${encounterId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <Card padding="lg" className="flex flex-col gap-4 h-full">
      <CardContent className="flex flex-col gap-4 flex-1">
        {/* Title + timing */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-surface-foreground">{title}</h2>
          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-1 font-medium">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ~{estimatedMinutes} min
          </span>
        </div>

        {/* Patient info */}
        <div className="bg-muted rounded-lg p-3 flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="font-medium text-surface-foreground">{patientName}</span>
            <span className="text-muted-foreground">{patientAge}yo {patientSex}</span>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground pl-6">
            <span>{specialty}</span>
            <span className="font-mono font-medium text-surface-foreground">{codeType} {code}</span>
            <span>{payer}</span>
          </div>
        </div>

        {/* What it demonstrates */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">What this demonstrates</p>
          <ul className="flex flex-col gap-1">
            {demonstrates.map((point) => (
              <li key={point} className="flex items-start gap-2 text-sm text-surface-foreground">
                <svg className="h-4 w-4 text-primary shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Flow summary */}
        <div className="border border-border rounded-lg p-3 flex flex-col gap-2 text-sm mt-auto">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Expected flow</p>
          <div className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">First pass</span>
            <span className="text-surface-foreground">{firstPassOutcome}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">Provider action</span>
            <span className="text-surface-foreground">{providerAction}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">Post-submit</span>
            <span className="text-surface-foreground">{postSubmission}</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-danger" role="alert">{error}</p>
        )}

        {/* CTA */}
        <Button
          size="lg"
          loading={loading}
          onClick={handleStart}
          className="w-full mt-2"
        >
          Start Scenario
        </Button>
      </CardContent>
    </Card>
  )
}
