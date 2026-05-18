/**
 * Task 1 — Code derivation
 *
 * Thin TypeScript wrapper over the FastAPI /derive-codes endpoint.
 * Validates the response with zod before returning to callers.
 * Falls back to CANNED_DERIVATION on AiUnreachableError (conference WiFi safety net).
 */

import { AiInvalidResponseError, AiUnreachableError, aiFetch } from './penguinClient'
import { getCannedDerivation } from './cannedResponses'
import {
  DeriveCodesRequestSchema,
  DeriveCodesResponseSchema,
  type DeriveCodesRequest,
  type DeriveCodesResponse,
} from './schemas/codeDerivation'

export type { DeriveCodesRequest, DeriveCodesResponse } from './schemas/codeDerivation'
export type { ProcedureCode, DiagnosisCode, Note } from './schemas/codeDerivation'

/**
 * Derive CPT/HCPCS/ICD-10 codes from clinical notes.
 *
 * @throws AiInvalidResponseError — service returned an unexpected shape (not caught here)
 * @throws Error — if AiUnreachableError fires for a non-demo encounter with no canned entry
 */
export async function deriveCodesFromNotes(
  payload: DeriveCodesRequest
): Promise<DeriveCodesResponse> {
  const validatedRequest = DeriveCodesRequestSchema.parse(payload)

  try {
    const raw = await aiFetch<unknown>('/derive-codes', validatedRequest)

    const parsed = DeriveCodesResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AiInvalidResponseError(
        `AI service /derive-codes returned unexpected shape: ${parsed.error.message}`,
        200,
        raw
      )
    }

    return parsed.data
  } catch (err) {
    // 5xx from the AI service (e.g. missing Bedrock credentials in demo env) is treated
    // the same as unreachable — fall back to canned responses.
    if (err instanceof AiInvalidResponseError && err.status >= 500) {
      return { ...getCannedDerivation(validatedRequest.encounter_id), cached: true }
    }

    // Non-5xx AiInvalidResponseError propagates loudly (unexpected response shape).
    if (err instanceof AiInvalidResponseError) throw err

    if (err instanceof AiUnreachableError) {
      // Fallback: return hard-coded result for the three demo encounters.
      // Throws for unknown encounter IDs — non-demo paths must not silently succeed.
      return { ...getCannedDerivation(validatedRequest.encounter_id), cached: true }
    }

    throw err
  }
}
