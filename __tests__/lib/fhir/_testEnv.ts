/**
 * __tests__/lib/fhir/_testEnv.ts
 *
 * Shared helpers for fhir adapter tests. Builds the SmartSessionLike + the
 * `sessionLoader` / `refresher` injectables so each test can drive the
 * client deterministically with `fetchImpl: vi.fn()`.
 */

import { vi } from 'vitest'
import type { SmartSessionLike, SessionLoader, SessionRefresher } from '@/lib/fhir/client'

export const TEST_ISS = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'

export function makeSession(overrides: Partial<SmartSessionLike> = {}): SmartSessionLike {
  return {
    sessionToken: overrides.sessionToken ?? 'test-session-token',
    accessToken: overrides.accessToken ?? 'fixture-access-token',
    iss: overrides.iss ?? TEST_ISS,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  }
}

export function loaderFor(session: SmartSessionLike | null): SessionLoader {
  return vi.fn(async () => session)
}

/**
 * Build a refresher that returns the given session after one call. Useful
 * for tests that want to assert "refresher was called once."
 */
export function refresherOnce(refreshed: SmartSessionLike | null): SessionRefresher {
  return vi.fn(async () => refreshed)
}

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/fhir+json', ...(init.headers ?? {}) },
  })
}

export function errorResponse(status: number, body: unknown = { resourceType: 'OperationOutcome' }, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/fhir+json', ...(headers ?? {}) },
  })
}

export function binaryResponse(buf: Buffer, headers?: Record<string, string>): Response {
  // Construct a Uint8Array view to keep BodyInit happy in Node 20+.
  const body = new Uint8Array(buf)
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', ...(headers ?? {}) },
  })
}
