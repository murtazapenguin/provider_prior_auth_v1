// All valid PA status values — WORKFLOW.md is authoritative. Do not add new values.
// Values are snake_case in code; the UI layer converts to display strings.
export type PaStatus =
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

// Terminal states are fully read-only — no transitions leave them.
//
// NOTE: WORKFLOW.md §"Terminal states" lists partial_approval and partial_denial
// as terminal, but the mermaid state diagram in the same document shows both
// accepting a `provider_withdraw → withdrawn` transition. The mermaid diagram
// is the executable specification; the prose list is informational only.
// partial_approval and partial_denial are therefore NOT in TERMINAL_STATES —
// they have one valid outgoing edge each.
// Candidate future state: a "finalised" or "closed" super-state could capture
// this nuance if it matters for UI display; document but do not implement.
export const TERMINAL_STATES: ReadonlySet<PaStatus> = new Set([
  'voided',
  'cancelled',
  'expired',
  'approved',
  'denied',
  'withdrawn',
])

// ---------------------------------------------------------------------------
// Side effects — typed list of follow-on actions the caller must perform.
// The state machine is pure; it only declares what should happen.
// ---------------------------------------------------------------------------
export type SideEffect =
  | { type: 'set_field'; field: 'submittedAt'; value: 'now' }
  | { type: 'start_timer'; kind: 'pending_submission_60d' }
  | { type: 'clear_timer'; kind: 'pending_submission_60d' }
  | { type: 'audit_event'; metadata: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Transition events — discriminated union; one variant per trigger.
// `actor` is required on every variant: either a provider/user id or "system".
//
// NOTE: `provider_cancel` and `patient_decline` both route to `cancelled`.
// In the UI these are distinct buttons ("Cancel PA" vs "Patient Declined"),
// but the outcome state is identical — WORKFLOW.md only defines one state for
// this case. Both events are preserved so the audit trail can distinguish
// the initiator without requiring a new state.
// ---------------------------------------------------------------------------
export type PaTransitionEvent =
  | { type: 'provider_submit'; actor: string }
  | { type: 'provider_park'; actor: string }
  | { type: 'provider_resume'; actor: string }
  | { type: 'provider_void'; actor: string }
  | { type: 'provider_cancel'; actor: string }
  | { type: 'provider_withdraw'; actor: string }
  | { type: 'patient_decline'; actor: string }
  | { type: 'criteria_all_met'; actor: string }
  | { type: 'sixty_day_timer'; actor: 'system' }
  | { type: 'simulator_in_progress'; actor: 'system' }
  | { type: 'simulator_rfi'; actor: 'system' }
  | { type: 'simulator_approved'; actor: 'system' }
  | { type: 'simulator_denied'; actor: 'system' }
  | { type: 'simulator_partial_approval'; actor: 'system' }
  | { type: 'simulator_partial_denial'; actor: 'system' }
  | { type: 'rfi_responded'; actor: string }

type EventType = PaTransitionEvent['type']

// ---------------------------------------------------------------------------
// TRANSITIONS table — keyed by (fromStatus, eventType) → { next, sideEffects }
// sideEffects is a function so it can inspect the event (e.g. capture actor).
// ---------------------------------------------------------------------------
type TransitionDef = {
  next: PaStatus
  sideEffects: (event: PaTransitionEvent) => SideEffect[]
}

type TransitionTable = Partial<Record<PaStatus, Partial<Record<EventType, TransitionDef>>>>

export const TRANSITIONS: TransitionTable = {
  draft: {
    criteria_all_met: {
      next: 'ready_for_submission',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'all criteria met' } },
      ],
    },
    provider_park: {
      next: 'pending_submission',
      sideEffects: (e) => [
        { type: 'start_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider parked PA' } },
      ],
    },
    provider_void: {
      next: 'voided',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider voided from draft' } },
      ],
    },
    provider_cancel: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider cancelled (patient declined) from draft' } },
      ],
    },
    patient_decline: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'patient declined from draft' } },
      ],
    },
  },

  pending_submission: {
    provider_resume: {
      next: 'draft',
      sideEffects: (e) => [
        { type: 'clear_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider resumed parked PA' } },
      ],
    },
    provider_void: {
      next: 'voided',
      sideEffects: (e) => [
        { type: 'clear_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider voided from pending_submission' } },
      ],
    },
    provider_cancel: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'clear_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider cancelled (patient declined) from pending_submission' } },
      ],
    },
    patient_decline: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'clear_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'patient declined from pending_submission' } },
      ],
    },
    sixty_day_timer: {
      next: 'expired',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: '60-day inactivity timer expired' } },
      ],
    },
  },

  ready_for_submission: {
    provider_submit: {
      next: 'pending',
      sideEffects: (e) => [
        { type: 'set_field', field: 'submittedAt', value: 'now' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider submitted PA to payer' } },
      ],
    },
    provider_park: {
      next: 'pending_submission',
      sideEffects: (e) => [
        { type: 'start_timer', kind: 'pending_submission_60d' },
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider parked PA from ready_for_submission' } },
      ],
    },
    provider_void: {
      next: 'voided',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider voided from ready_for_submission' } },
      ],
    },
    provider_cancel: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider cancelled (patient declined) from ready_for_submission' } },
      ],
    },
    patient_decline: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'patient declined from ready_for_submission' } },
      ],
    },
  },

  pending: {
    simulator_in_progress: {
      next: 'in_progress',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer started review' } },
      ],
    },
    provider_withdraw: {
      next: 'withdrawn',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider withdrew from pending' } },
      ],
    },
  },

  in_progress: {
    simulator_rfi: {
      next: 'rfi',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer requested additional information' } },
      ],
    },
    simulator_approved: {
      next: 'approved',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer approved all codes' } },
      ],
    },
    simulator_denied: {
      next: 'denied',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer denied all codes' } },
      ],
    },
    simulator_partial_approval: {
      next: 'partial_approval',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer approved with modifications' } },
      ],
    },
    simulator_partial_denial: {
      next: 'partial_denial',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'payer denied some codes (multi-code PA)' } },
      ],
    },
    provider_withdraw: {
      next: 'withdrawn',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider withdrew from in_progress' } },
      ],
    },
  },

  rfi: {
    rfi_responded: {
      next: 'in_progress',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider responded to RFI' } },
      ],
    },
    provider_withdraw: {
      next: 'withdrawn',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider withdrew from rfi' } },
      ],
    },
    provider_cancel: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider cancelled (patient declined) from rfi' } },
      ],
    },
    patient_decline: {
      next: 'cancelled',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'patient declined from rfi' } },
      ],
    },
  },

  partial_approval: {
    provider_withdraw: {
      next: 'withdrawn',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider withdrew from partial_approval' } },
      ],
    },
  },

  partial_denial: {
    provider_withdraw: {
      next: 'withdrawn',
      sideEffects: (e) => [
        { type: 'audit_event', metadata: { actor: e.actor, reason: 'provider withdrew from partial_denial' } },
      ],
    },
  },
}

// ---------------------------------------------------------------------------
// transition() — pure function, no DB calls. Caller persists results.
// ---------------------------------------------------------------------------
export function transition(
  currentStatus: PaStatus,
  event: PaTransitionEvent,
): { ok: true; next: PaStatus; sideEffects: SideEffect[] } | { ok: false; reason: string } {
  // Terminal states are fully read-only
  if (TERMINAL_STATES.has(currentStatus)) {
    return {
      ok: false,
      reason: `PA is in terminal state '${currentStatus}' and cannot be transitioned`,
    }
  }

  const fromDef = TRANSITIONS[currentStatus]
  if (!fromDef) {
    return {
      ok: false,
      reason: `No transitions defined from status '${currentStatus}'`,
    }
  }

  const def = fromDef[event.type as EventType]
  if (!def) {
    return {
      ok: false,
      reason: `Event '${event.type}' is not valid from status '${currentStatus}'`,
    }
  }

  return {
    ok: true,
    next: def.next,
    sideEffects: def.sideEffects(event),
  }
}
