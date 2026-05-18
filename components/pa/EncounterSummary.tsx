/**
 * EncounterSummary — left panel of the encounter intake screen.
 *
 * Server Component: receives pre-fetched data from the page.
 * Renders patient demographics, coverage, provider, encounter metadata,
 * and a collapsible list of clinical notes.
 */

'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui'

// ─── Types (mirroring Prisma shape, no generated client import) ────────────────

export interface NoteData {
  id: string
  noteType: string
  authoredAt: string
  authorRole: string
  text: string
  source: string
}

export interface CoverageData {
  planName: string
  payerId: string
  memberId: string
  groupNumber: string | null
  benefitCategory: string
}

export interface EncounterSummaryData {
  encounterId: string
  encounterDate: string
  placeOfService: string
  patient: {
    id: string
    firstName: string
    lastName: string
    dob: string
    sex: string
    coverages: CoverageData[]
  }
  provider: {
    firstName: string
    lastName: string
    specialty: string
    npi: string
  }
  notes: NoteData[]
}

interface EncounterSummaryProps {
  data: EncounterSummaryData
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function calculateAge(dob: string): number {
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function noteTypeLabel(noteType: string): string {
  const labels: Record<string, string> = {
    hp: 'H&P',
    progress: 'Progress Note',
    consult: 'Consult Note',
    scribe: 'Scribe Note',
    discharge: 'Discharge Note',
    other: 'Note',
  }
  return labels[noteType] ?? noteType
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function NoteItem({ note }: { note: NoteData }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="info" className="shrink-0 text-xs">{noteTypeLabel(note.noteType)}</Badge>
          <span className="text-sm text-muted-foreground truncate">{note.authorRole}</span>
          <span className="text-xs text-muted-foreground shrink-0">{formatDate(note.authoredAt)}</span>
        </div>
        <svg
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-muted/30">
          <pre className="text-xs text-surface-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {note.text}
          </pre>
          {note.source && note.source !== 'ehr' && (
            <p className="text-xs text-muted-foreground mt-2">Source: {note.source}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function EncounterSummary({ data }: EncounterSummaryProps) {
  const { patient, provider, notes, encounterDate, placeOfService } = data
  const age = calculateAge(patient.dob)
  const primaryCoverage = patient.coverages.find((c) => c.benefitCategory !== 'none') ?? patient.coverages[0]

  return (
    <div className="flex flex-col gap-4">
      {/* Patient card */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Patient</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-surface-foreground">
                {patient.firstName} {patient.lastName}
              </span>
              <span className="text-sm text-muted-foreground">
                {age}yo {patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              DOB: {formatDate(patient.dob)}
            </div>
            {primaryCoverage && (
              <div className="mt-1 bg-muted rounded-lg p-2.5 flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="font-medium text-surface-foreground">{primaryCoverage.planName}</span>
                </div>
                <div className="pl-5 flex flex-col gap-0.5 text-muted-foreground">
                  <span>Member ID: <span className="font-mono text-surface-foreground">{primaryCoverage.memberId}</span></span>
                  {primaryCoverage.groupNumber && (
                    <span>Group: <span className="font-mono text-surface-foreground">{primaryCoverage.groupNumber}</span></span>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Encounter card */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Encounter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium text-surface-foreground">{formatDate(encounterDate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium text-surface-foreground">
                Dr. {provider.firstName} {provider.lastName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Specialty</span>
              <span className="font-medium text-surface-foreground">{provider.specialty}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Place of Service</span>
              <span className="font-mono text-surface-foreground">{placeOfService}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clinical notes */}
      <Card padding="md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Clinical Notes</CardTitle>
            <Badge variant="default">{notes.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes available for this encounter.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((note) => (
                <NoteItem key={note.id} note={note} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
