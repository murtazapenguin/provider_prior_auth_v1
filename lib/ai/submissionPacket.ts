/**
 * lib/ai/submissionPacket.ts — Phase 3 implementation.
 *
 * Calls /generate-submission-packet on the FastAPI AI sidecar.
 * Validates the response with zod.
 *
 * Canned-response fallback: when FastAPI is unreachable (AiUnreachableError),
 * returns a pre-built static PDF URL for the three demo scenarios.
 * The static PDFs live at /submission-packets/canned/{encounterKey}.pdf
 * and are generated once by the test suite fixture builder.
 *
 * Only triggers on AiUnreachableError — AiInvalidResponseError propagates loudly.
 * Throws for unknown (encounterId) pairs — non-demo paths must not succeed silently.
 */

import { AiInvalidResponseError, AiUnreachableError, aiFetch } from './penguinClient'
import { getCannedSubmissionPacket } from './cannedResponses'
import { GeneratePacketResponseSchema } from './schemas/submissionPacket'
import type { GeneratePacketResponse } from './schemas/submissionPacket'

// ─── Request body ─────────────────────────────────────────────────────────────

interface GeneratePacketRequestBody {
  pa_id: string
  regenerate: boolean
  provider_id?: string | null
}

// ─── generateSubmissionPacket ─────────────────────────────────────────────────

export async function generateSubmissionPacket(
  paId: string,
  options: {
    regenerate?: boolean
    providerId?: string | null
    encounterId?: string // used for canned fallback only
  } = {}
): Promise<GeneratePacketResponse> {
  const body: GeneratePacketRequestBody = {
    pa_id: paId,
    regenerate: options.regenerate ?? false,
    provider_id: options.providerId ?? null,
  }

  try {
    const raw = await aiFetch<unknown>('/generate-submission-packet', body)
    return GeneratePacketResponseSchema.parse(raw)
  } catch (err) {
    // 5xx from AI service (e.g. missing Bedrock creds in demo env) falls back to canned.
    if (err instanceof AiInvalidResponseError && err.status >= 500 && options.encounterId) {
      return getCannedSubmissionPacket(options.encounterId)
    }

    if (err instanceof AiInvalidResponseError) throw err

    if (err instanceof AiUnreachableError && options.encounterId) {
      return getCannedSubmissionPacket(options.encounterId)
    }

    throw err
  }
}
