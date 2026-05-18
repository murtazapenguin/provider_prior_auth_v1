// All 14 valid PA status values per CLAUDE.md "Status model" vocabulary lock.
// UI display strings are the PascalCase-with-spaces forms from that same table.

type PaStatus =
  | 'draft'
  | 'pending_submission'
  | 'ready_for_submission'
  | 'voided'
  | 'cancelled'
  | 'expired'
  | 'pending'
  | 'in_progress'
  | 'rfi'
  | 'approved'
  | 'denied'
  | 'partial_approval'
  | 'partial_denial'
  | 'withdrawn'

const DISPLAY: Record<PaStatus, string> = {
  draft: 'Draft',
  pending_submission: 'Pending Submission',
  ready_for_submission: 'Ready for Submission',
  voided: 'Voided',
  cancelled: 'Cancelled',
  expired: 'Expired',
  pending: 'Pending',
  in_progress: 'In Review',
  rfi: 'RFI',
  approved: 'Approved',
  denied: 'Denied',
  partial_approval: 'Partial Approval',
  partial_denial: 'Partial Denial',
  withdrawn: 'Withdrawn',
}

const COLORS: Record<PaStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_submission: 'bg-slate-100 text-slate-700',
  ready_for_submission: 'bg-green-100 text-green-800',
  voided: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-purple-100 text-purple-800',
  rfi: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-700',
  partial_approval: 'bg-amber-100 text-amber-800',
  partial_denial: 'bg-amber-100 text-amber-800',
  withdrawn: 'bg-slate-100 text-slate-700',
}

interface StatusPillProps {
  status: PaStatus | string
  className?: string
  size?: 'sm' | 'md'
}

export default function StatusPill({ status, className = '', size = 'md' }: StatusPillProps) {
  const s = status as PaStatus
  const color = COLORS[s] ?? 'bg-slate-100 text-slate-700'
  const label = DISPLAY[s] ?? status
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
  return (
    <span className={`inline-flex items-center font-medium rounded-full ${color} ${sizeClass} ${className}`}>
      {label}
    </span>
  )
}

export type { PaStatus }
