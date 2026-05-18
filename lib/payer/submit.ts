/**
 * lib/payer/submit.ts
 *
 * PayerAdapter interface + MockPayerAdapter implementation.
 *
 * The mock registers each submitted PA in a module-level in-memory queue that
 * the simulator (simulator.ts) drains on every tick.  Real adapters (X12 278,
 * FHIR Da Vinci PAS) implement the same interface and drop in here without
 * touching domain code.
 */

import { randomUUID } from 'crypto'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PriorAuthSubmission {
  paId: string
  encounterId: string
  providerId: string
  payerId: string
  codes: Array<{ codeType: string; code: string; modifier?: string }>
}

export interface SubmissionAck {
  trackingId: string
  submittedAt: Date
}

export interface PayerStatus {
  trackingId: string
  status: string
  updatedAt: Date
}

export interface PayerAdapter {
  submit(pa: PriorAuthSubmission): Promise<SubmissionAck>
  cancel(trackingId: string): Promise<void>
  fetchStatus(trackingId: string): Promise<PayerStatus>
}

// ─── Scenario tag helpers ─────────────────────────────────────────────────────

export type ScenarioTag = 'head_ct' | 'knee_mri' | 'botox' | 'default'

/**
 * Derive scenario from the encounterId suffix.
 * WORKFLOW.md: encounter id ends in 'head-ct', 'knee-mri', or 'botox'.
 */
export function deriveScenario(encounterId: string): ScenarioTag {
  const lower = encounterId.toLowerCase()
  if (lower.endsWith('head-ct') || lower.includes('head-ct')) return 'head_ct'
  if (lower.endsWith('knee-mri') || lower.includes('knee-mri')) return 'knee_mri'
  if (lower.endsWith('botox') || lower.includes('botox')) return 'botox'
  return 'default'
}

// ─── In-memory simulator queue ────────────────────────────────────────────────

export interface SimulatorEntry {
  paId: string
  scenario: ScenarioTag
  /** Counts completed transitions (0 = just submitted). */
  step: number
  /** True when the provider has responded to an RFI (Botox scenario). */
  rfiResponded: boolean
}

/** Module-level map keyed by trackingId.  Exported so simulator.ts can access it. */
export const simulatorQueue = new Map<string, SimulatorEntry>()

/**
 * Reset the in-memory queue.  Called in beforeEach in unit tests so state
 * doesn't bleed between test cases.
 */
export function __resetSimulatorState(): void {
  simulatorQueue.clear()
}

// ─── MockPayerAdapter ─────────────────────────────────────────────────────────

export class MockPayerAdapter implements PayerAdapter {
  async submit(pa: PriorAuthSubmission): Promise<SubmissionAck> {
    const trackingId = randomUUID()
    const submittedAt = new Date()

    simulatorQueue.set(trackingId, {
      paId: pa.paId,
      scenario: deriveScenario(pa.encounterId),
      step: 0,
      rfiResponded: false,
    })

    return { trackingId, submittedAt }
  }

  async cancel(trackingId: string): Promise<void> {
    simulatorQueue.delete(trackingId)
  }

  async fetchStatus(trackingId: string): Promise<PayerStatus> {
    const entry = simulatorQueue.get(trackingId)
    return {
      trackingId,
      status: entry ? 'in_flight' : 'unknown',
      updatedAt: new Date(),
    }
  }
}
