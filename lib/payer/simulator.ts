/**
 * lib/payer/simulator.ts
 *
 * Timer-driven adjudication simulator.
 *
 * runSimulatorTick() — pure(-ish) function called by Vercel Cron (and by unit
 *   tests with a mocked Prisma client).  Reads all PAs whose
 *   simulatorNextTransitionAt <= now, fires the correct transition, persists
 *   the next-transition timestamp, and audit-logs every hop.
 *
 * fastForward() — advances every in-flight PA one state immediately.  Powers
 *   the "fast-forward" demo button.
 *
 * notifyRfiResponse() — marks the Botox-scenario PA as having received an RFI
 *   response and arms it for the rfi→in_progress tick.  Called by the RFI
 *   response API route.
 *
 * Timing:
 *   pending → in_progress  :  submittedAt + 30 s  (set by the submit route)
 *   in_progress → terminal :  in_progress reached + 90 s
 *
 * Scenario outcomes (deterministic):
 *   head_ct   → in_progress → approved
 *   knee_mri  → in_progress → approved
 *   botox     → in_progress → rfi, then (after notifyRfiResponse) rfi → in_progress → approved
 *   default   → in_progress → approved
 *
 * State transitions go through statusMachine.transition().  Direct status
 * assignment is forbidden per project conventions.
 */

import type { PrismaClient } from '@/app/generated/prisma/client'
import { transition } from '@/lib/statusMachine/transitions'
import type { PaTransitionEvent } from '@/lib/statusMachine/transitions'
import { recordEvent } from '@/lib/audit/log'
import { simulatorQueue } from './submit'
import type { ScenarioTag, SimulatorEntry } from './submit'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Delay (ms) from submission until Pending → In Progress. */
export const PENDING_TO_IN_PROGRESS_MS = 30_000

/** Delay (ms) from In Progress until the terminal (or RFI) transition. */
export const IN_PROGRESS_TO_TERMINAL_MS = 90_000

/** The set of statuses that are still "in-flight" (not yet at a terminal). */
export const IN_FLIGHT_STATUSES = ['pending', 'in_progress', 'rfi'] as const
export type InFlightStatus = (typeof IN_FLIGHT_STATUSES)[number]

// ─── Simulator outcome scripts ────────────────────────────────────────────────

/**
 * Returns the event to fire for an in_progress PA given its scenario.
 * Botox goes to RFI; everything else goes to approved.
 */
function inProgressOutcomeEvent(
  scenario: ScenarioTag,
  entry: SimulatorEntry,
): PaTransitionEvent {
  if (scenario === 'botox' && !entry.rfiResponded) return { type: 'simulator_rfi', actor: 'system' }
  return { type: 'simulator_approved', actor: 'system' }
}

// ─── TickResult ───────────────────────────────────────────────────────────────

export interface TickResult {
  processed: number
  transitions: Array<{ paId: string; from: string; to: string }>
}

// ─── notifyRfiResponse ────────────────────────────────────────────────────────

/**
 * Called when the provider submits their RFI response.
 * Arms the simulator to transition rfi → in_progress on the next tick (or
 * immediately in fastForward).
 */
export async function notifyRfiResponse(
  prisma: PrismaClient,
  paId: string,
): Promise<void> {
  // Find the entry by paId (trackingId is the map key)
  for (const [, entry] of simulatorQueue) {
    if (entry.paId === paId) {
      entry.rfiResponded = true
      break
    }
  }

  // Set simulatorNextTransitionAt = now so the next tick picks it up immediately
  await prisma.priorAuth.update({
    where: { id: paId },
    data: { simulatorNextTransitionAt: new Date() },
  })
}

// ─── runSimulatorTick ─────────────────────────────────────────────────────────

/**
 * Walk PAs whose simulatorNextTransitionAt <= now and fire the next transition.
 * This is the function called by Vercel Cron.
 */
export async function runSimulatorTick(
  prisma: PrismaClient,
  now: Date,
): Promise<TickResult> {
  const due = await prisma.priorAuth.findMany({
    where: {
      simulatorNextTransitionAt: { lte: now },
      status: { in: [...IN_FLIGHT_STATUSES] },
    },
  })

  const tickResult: TickResult = { processed: 0, transitions: [] }

  for (const pa of due) {
    const currentStatus = pa.status as InFlightStatus

    // Find the corresponding simulator entry (keyed by trackingId)
    let entry: SimulatorEntry | undefined
    let trackingId: string | undefined

    for (const [tid, e] of simulatorQueue) {
      if (e.paId === pa.id) {
        entry = e
        trackingId = tid
        break
      }
    }

    // Determine which event to fire based on current status and scenario
    let event: Parameters<typeof transition>[1]

    if (currentStatus === 'pending') {
      event = { type: 'simulator_in_progress', actor: 'system' }
    } else if (currentStatus === 'in_progress') {
      const scenario: ScenarioTag = entry?.scenario ?? 'default'
      event = inProgressOutcomeEvent(scenario, entry ?? { paId: pa.id, scenario: 'default', step: 0, rfiResponded: false })
    } else if (currentStatus === 'rfi') {
      // rfi→in_progress (provider responded); the subsequent in_progress→approved
      // will be handled on the next tick
      if (entry?.rfiResponded) {
        event = { type: 'rfi_responded', actor: 'system' }
      } else {
        // RFI not yet responded to — skip for now
        continue
      }
    } else {
      continue
    }

    const result = transition(currentStatus, event)

    if (!result.ok) {
      // Transition not allowed from this status — clear the timer to avoid
      // reprocessing and move on
      await prisma.priorAuth.update({
        where: { id: pa.id },
        data: { simulatorNextTransitionAt: null },
      })
      continue
    }

    const nextStatus = result.next

    // Determine simulatorNextTransitionAt for the new status
    let nextTransitionAt: Date | null = null
    if (nextStatus === 'in_progress') {
      // Schedule in_progress → terminal transition
      nextTransitionAt = new Date(now.getTime() + IN_PROGRESS_TO_TERMINAL_MS)
    }
    // terminal states get null (no further transitions)

    // Persist the status change and schedule
    await prisma.priorAuth.update({
      where: { id: pa.id },
      data: {
        status: nextStatus,
        simulatorNextTransitionAt: nextTransitionAt,
      },
    })

    // Audit-log the transition
    await recordEvent({
      priorAuthId: pa.id,
      type: 'status_change',
      fromStatus: currentStatus,
      toStatus: nextStatus,
      actor: 'simulator',
      metadata: {
        event,
        trackingId: trackingId ?? pa.trackingId,
        tickAt: now.toISOString(),
      },
    })

    // Advance the in-memory entry step counter
    if (entry) {
      entry.step += 1
      // If we just moved to rfi and now the entry has rfiResponded already set
      // (shouldn't happen normally, but guard it), leave it alone.
    }

    tickResult.processed += 1
    tickResult.transitions.push({ paId: pa.id, from: currentStatus, to: nextStatus })
  }

  return tickResult
}

// ─── fastForward ─────────────────────────────────────────────────────────────

/**
 * Advance every in-flight PA one step immediately, regardless of the timer.
 * Powers the demo "fast-forward" admin endpoint.
 */
export async function fastForward(prisma: PrismaClient): Promise<TickResult> {
  // Set simulatorNextTransitionAt = now() for every in-flight PA so the tick
  // picks them all up
  const now = new Date()

  await prisma.priorAuth.updateMany({
    where: { status: { in: [...IN_FLIGHT_STATUSES] } },
    data: { simulatorNextTransitionAt: now },
  })

  return runSimulatorTick(prisma, now)
}
