'use client'

// DocumentList: vertical list of clinical notes + uploaded attachments.
// Used in the left pane of the EvidenceCheckModal as the default view
// (when no document is selected).

import type { ClinicalNoteSummary, AttachmentSummary } from '@/components/pa/EvidenceCheckModal'

export type DocSelection =
  | { source: 'note'; id: string }
  | { source: 'attachment'; id: string }

interface DocumentListProps {
  notes: ClinicalNoteSummary[]
  attachments: AttachmentSummary[]
  onSelect: (selection: DocSelection) => void
  selectedId?: string | null
}

const NOTE_TYPE_LABELS: Record<string, string> = {
  history_and_physical: 'History & Physical',
  consult: 'Consult Note',
  progress_note: 'Progress Note',
  discharge_summary: 'Discharge Summary',
  procedure_note: 'Procedure Note',
  imaging_report: 'Imaging Report',
  pathology_report: 'Pathology Report',
  lab_report: 'Lab Report',
}

function readableNoteType(noteType: string): string {
  if (NOTE_TYPE_LABELS[noteType]) return NOTE_TYPE_LABELS[noteType]
  return noteType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function readableAuthorRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString()
}

function NoteIcon() {
  return (
    <svg
      className="h-5 w-5 text-muted-foreground shrink-0"
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
  )
}

function AttachmentIcon() {
  return (
    <svg
      className="h-5 w-5 text-muted-foreground shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
      />
    </svg>
  )
}

function shortMime(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return mime.split('/')[1].toUpperCase()
  if (mime === 'text/plain') return 'TEXT'
  if (mime === 'application/msword' || mime.includes('officedocument.wordprocessingml')) return 'DOC'
  return mime.split('/').pop()?.toUpperCase() ?? 'FILE'
}

export default function DocumentList({
  notes,
  attachments,
  onSelect,
  selectedId,
}: DocumentListProps) {
  const empty = notes.length === 0 && attachments.length === 0

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-surface-foreground">Documents</h3>
        <p className="text-xs text-muted-foreground">
          {empty
            ? 'No clinical notes or uploaded attachments yet.'
            : `${notes.length} note${notes.length === 1 ? '' : 's'} · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {empty && (
          <div className="p-6 text-sm text-muted-foreground">
            Upload a document or pull a note in from the encounter to populate this list.
          </div>
        )}

        {notes.length > 0 && (
          <div>
            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50">
              Clinical notes
            </div>
            <ul>
              {notes.map((note) => {
                const isSelected = selectedId === note.id
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ source: 'note', id: note.id })}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-border transition-colors ${
                        isSelected ? 'bg-pink-50 border-l-2 border-l-primary' : 'hover:bg-muted/40'
                      }`}
                    >
                      <NoteIcon />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-surface-foreground truncate">
                          Clinical Note — {readableNoteType(note.noteType)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {readableAuthorRole(note.authorRole)} · {formatDate(note.authoredAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {attachments.length > 0 && (
          <div>
            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50">
              Attachments
            </div>
            <ul>
              {attachments.map((att) => {
                const isSelected = selectedId === att.id
                return (
                  <li key={att.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ source: 'attachment', id: att.id })}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-border transition-colors ${
                        isSelected ? 'bg-pink-50 border-l-2 border-l-primary' : 'hover:bg-muted/40'
                      }`}
                    >
                      <AttachmentIcon />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-surface-foreground truncate">
                          {att.filename}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {shortMime(att.mimeType)} · {formatDate(att.uploadedAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
