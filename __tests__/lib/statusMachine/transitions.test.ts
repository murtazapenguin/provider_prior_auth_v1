import { describe, it, expect } from 'vitest'
import {
  transition,
  TRANSITIONS,
  TERMINAL_STATES,
  type PaStatus,
  type PaTransitionEvent,
} from '@/lib/statusMachine/transitions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(
  current: PaStatus,
  event: PaTransitionEvent,
  expectedNext: PaStatus,
) {
  const result = transition(current, event)
  expect(result.ok, `Expected ok=true for ${current} + ${event.type}`).toBe(true)
  if (!result.ok) throw new Error('unreachable') // narrow type
  expect(result.next).toBe(expectedNext)
  // side effects array must always be present and contain at least an audit_event
  expect(Array.isArray(result.sideEffects)).toBe(true)
  expect(result.sideEffects.some((s) => s.type === 'audit_event')).toBe(true)
  return result
}

function fail(current: PaStatus, event: PaTransitionEvent) {
  const result = transition(current, event)
  expect(result.ok, `Expected ok=false for ${current} + ${event.type}`).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(typeof result.reason).toBe('string')
  expect(result.reason.length).toBeGreaterThan(0)
  return result
}

// ---------------------------------------------------------------------------
// Pre-submission positive transitions
// ---------------------------------------------------------------------------

describe('draft transitions', () => {
  it('criteria_all_met → ready_for_submission', () => {
    ok('draft', { type: 'criteria_all_met', actor: 'system' }, 'ready_for_submission')
  })

  it('provider_park → pending_submission (with timer side effect)', () => {
    const result = ok('draft', { type: 'provider_park', actor: 'prov_1' }, 'pending_submission')
    expect(result.sideEffects.some((s) => s.type === 'start_timer')).toBe(true)
  })

  it('provider_void → voided', () => {
    ok('draft', { type: 'provider_void', actor: 'prov_1' }, 'voided')
  })

  it('provider_cancel → cancelled', () => {
    ok('draft', { type: 'provider_cancel', actor: 'prov_1' }, 'cancelled')
  })

  it('patient_decline → cancelled', () => {
    ok('draft', { type: 'patient_decline', actor: 'prov_1' }, 'cancelled')
  })
})

describe('pending_submission transitions', () => {
  it('provider_resume → draft (clears timer)', () => {
    const result = ok(
      'pending_submission',
      { type: 'provider_resume', actor: 'prov_1' },
      'draft',
    )
    expect(result.sideEffects.some((s) => s.type === 'clear_timer')).toBe(true)
  })

  it('provider_void → voided (clears timer)', () => {
    const result = ok(
      'pending_submission',
      { type: 'provider_void', actor: 'prov_1' },
      'voided',
    )
    expect(result.sideEffects.some((s) => s.type === 'clear_timer')).toBe(true)
  })

  it('provider_cancel → cancelled (clears timer)', () => {
    const result = ok(
      'pending_submission',
      { type: 'provider_cancel', actor: 'prov_1' },
      'cancelled',
    )
    expect(result.sideEffects.some((s) => s.type === 'clear_timer')).toBe(true)
  })

  it('patient_decline → cancelled (clears timer)', () => {
    const result = ok(
      'pending_submission',
      { type: 'patient_decline', actor: 'prov_1' },
      'cancelled',
    )
    expect(result.sideEffects.some((s) => s.type === 'clear_timer')).toBe(true)
  })

  it('sixty_day_timer → expired', () => {
    ok('pending_submission', { type: 'sixty_day_timer', actor: 'system' }, 'expired')
  })
})

describe('ready_for_submission transitions', () => {
  it('provider_submit → pending (sets submittedAt)', () => {
    const result = ok(
      'ready_for_submission',
      { type: 'provider_submit', actor: 'prov_1' },
      'pending',
    )
    expect(
      result.sideEffects.some((s) => s.type === 'set_field' && s.field === 'submittedAt'),
    ).toBe(true)
  })

  it('provider_void → voided', () => {
    ok('ready_for_submission', { type: 'provider_void', actor: 'prov_1' }, 'voided')
  })

  it('provider_cancel → cancelled', () => {
    ok('ready_for_submission', { type: 'provider_cancel', actor: 'prov_1' }, 'cancelled')
  })

  it('patient_decline → cancelled', () => {
    ok('ready_for_submission', { type: 'patient_decline', actor: 'prov_1' }, 'cancelled')
  })
})

// ---------------------------------------------------------------------------
// Post-submission positive transitions
// ---------------------------------------------------------------------------

describe('pending transitions', () => {
  it('simulator_in_progress → in_progress', () => {
    ok('pending', { type: 'simulator_in_progress', actor: 'system' }, 'in_progress')
  })

  it('provider_withdraw → withdrawn', () => {
    ok('pending', { type: 'provider_withdraw', actor: 'prov_1' }, 'withdrawn')
  })
})

describe('in_progress transitions', () => {
  it('simulator_rfi → rfi', () => {
    ok('in_progress', { type: 'simulator_rfi', actor: 'system' }, 'rfi')
  })

  it('simulator_approved → approved', () => {
    ok('in_progress', { type: 'simulator_approved', actor: 'system' }, 'approved')
  })

  it('simulator_denied → denied', () => {
    ok('in_progress', { type: 'simulator_denied', actor: 'system' }, 'denied')
  })

  it('simulator_partial_approval → partial_approval', () => {
    ok('in_progress', { type: 'simulator_partial_approval', actor: 'system' }, 'partial_approval')
  })

  it('simulator_partial_denial → partial_denial', () => {
    ok('in_progress', { type: 'simulator_partial_denial', actor: 'system' }, 'partial_denial')
  })

  it('provider_withdraw → withdrawn', () => {
    ok('in_progress', { type: 'provider_withdraw', actor: 'prov_1' }, 'withdrawn')
  })
})

describe('rfi transitions', () => {
  it('rfi_responded → in_progress', () => {
    ok('rfi', { type: 'rfi_responded', actor: 'prov_1' }, 'in_progress')
  })

  it('provider_withdraw → withdrawn', () => {
    ok('rfi', { type: 'provider_withdraw', actor: 'prov_1' }, 'withdrawn')
  })

  it('provider_cancel → cancelled', () => {
    ok('rfi', { type: 'provider_cancel', actor: 'prov_1' }, 'cancelled')
  })

  it('patient_decline → cancelled', () => {
    ok('rfi', { type: 'patient_decline', actor: 'prov_1' }, 'cancelled')
  })
})

describe('partial_approval transitions', () => {
  it('provider_withdraw → withdrawn', () => {
    ok('partial_approval', { type: 'provider_withdraw', actor: 'prov_1' }, 'withdrawn')
  })
})

describe('partial_denial transitions', () => {
  it('provider_withdraw → withdrawn', () => {
    ok('partial_denial', { type: 'provider_withdraw', actor: 'prov_1' }, 'withdrawn')
  })
})

// ---------------------------------------------------------------------------
// Invalid / blocked transitions — must return ok: false
// ---------------------------------------------------------------------------

describe('invalid transitions (must fail)', () => {
  // 1. Terminal states block all events
  it('approved → provider_submit is blocked', () => {
    fail('approved', { type: 'provider_submit', actor: 'prov_1' })
  })

  it('denied → rfi_responded is blocked', () => {
    fail('denied', { type: 'rfi_responded', actor: 'prov_1' })
  })

  it('voided → provider_resume is blocked', () => {
    fail('voided', { type: 'provider_resume', actor: 'prov_1' })
  })

  it('cancelled → provider_void is blocked', () => {
    fail('cancelled', { type: 'provider_void', actor: 'prov_1' })
  })

  it('expired → provider_submit is blocked', () => {
    fail('expired', { type: 'provider_submit', actor: 'prov_1' })
  })

  it('withdrawn → simulator_in_progress is blocked', () => {
    fail('withdrawn', { type: 'simulator_in_progress', actor: 'system' })
  })

  // 2. Events out of order / wrong state
  it('draft → provider_submit is blocked (must go via ready_for_submission)', () => {
    fail('draft', { type: 'provider_submit', actor: 'prov_1' })
  })

  it('pending → simulator_approved is blocked (must pass through in_progress)', () => {
    fail('pending', { type: 'simulator_approved', actor: 'system' })
  })

  it('rfi → simulator_approved is blocked (must respond first)', () => {
    fail('rfi', { type: 'simulator_approved', actor: 'system' })
  })

  it('draft → rfi_responded is blocked', () => {
    fail('draft', { type: 'rfi_responded', actor: 'prov_1' })
  })

  it('ready_for_submission → provider_resume is blocked (only from pending_submission)', () => {
    fail('ready_for_submission', { type: 'provider_resume', actor: 'prov_1' })
  })

  it('in_progress → sixty_day_timer is blocked (timer is pre-submission only)', () => {
    fail('in_progress', { type: 'sixty_day_timer', actor: 'system' })
  })
})

// ---------------------------------------------------------------------------
// TRANSITIONS table structural checks
// ---------------------------------------------------------------------------

describe('TRANSITIONS table structure', () => {
  it('is a non-empty object', () => {
    expect(typeof TRANSITIONS).toBe('object')
    expect(Object.keys(TRANSITIONS).length).toBeGreaterThan(0)
  })

  it('contains entries for all non-terminal source states', () => {
    const sourceStates: PaStatus[] = [
      'draft',
      'pending_submission',
      'ready_for_submission',
      'pending',
      'in_progress',
      'rfi',
      'partial_approval',
      'partial_denial',
    ]
    for (const s of sourceStates) {
      expect(TRANSITIONS[s], `TRANSITIONS missing entry for '${s}'`).toBeDefined()
    }
  })

  it('terminal states have no outgoing transitions in TRANSITIONS table', () => {
    // partial_approval and partial_denial are NOT in TERMINAL_STATES —
    // the mermaid diagram in WORKFLOW.md gives them provider_withdraw edges.
    for (const s of TERMINAL_STATES) {
      expect(TRANSITIONS[s as PaStatus], `TRANSITIONS unexpectedly has entries for terminal '${s}'`).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Side-effect integrity checks
// ---------------------------------------------------------------------------

describe('side effects', () => {
  it('provider_park includes start_timer side effect', () => {
    const result = transition('draft', { type: 'provider_park', actor: 'prov_1' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sideEffects.some((s) => s.type === 'start_timer')).toBe(true)
  })

  it('provider_resume includes clear_timer side effect', () => {
    const result = transition('pending_submission', { type: 'provider_resume', actor: 'prov_1' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sideEffects.some((s) => s.type === 'clear_timer')).toBe(true)
  })

  it('provider_submit includes set_field submittedAt=now', () => {
    const result = transition('ready_for_submission', { type: 'provider_submit', actor: 'prov_1' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    const setField = result.sideEffects.find((s) => s.type === 'set_field')
    expect(setField).toBeDefined()
    expect((setField as { type: 'set_field'; field: string; value: string }).field).toBe('submittedAt')
  })

  it('every successful transition includes an audit_event side effect', () => {
    const checks: Array<[PaStatus, PaTransitionEvent]> = [
      ['draft', { type: 'criteria_all_met', actor: 'system' }],
      ['pending', { type: 'simulator_in_progress', actor: 'system' }],
      ['in_progress', { type: 'simulator_denied', actor: 'system' }],
      ['rfi', { type: 'rfi_responded', actor: 'prov_1' }],
    ]
    for (const [status, event] of checks) {
      const result = transition(status, event)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      expect(
        result.sideEffects.some((s) => s.type === 'audit_event'),
        `Missing audit_event for ${status} + ${event.type}`,
      ).toBe(true)
    }
  })
})
