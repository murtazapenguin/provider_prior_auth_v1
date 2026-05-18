// Phase 6 T10 retention decision: this is the dev-mode mock-auth helper for
// the 13+ API routes that need a provider id. KEPT for `pnpm dev` + smoke-
// scenario ergonomics + the existing `/demo` flow. The middleware legacy
// block (NODE_ENV-gated, see middleware.ts) lets requests bearing
// pa_provider_id through; routes call this helper to extract the id.
//
// Full migration to SMART-session-only auth (routes resolve fhirUser →
// Practitioner id from `getCurrentSession()`) is deferred to Phase 7+
// alongside `phase-6-compliance`'s RBAC work. The right interim move once
// the smoke scenario authenticates via SMART is to extend this helper to
// consult SmartSession first and fall back to the legacy cookie.
// See `tasks/STATUS.md` Phase 6 closeout notes.
export const DEMO_PROVIDER_ID = 'provider-pcp-sarah-chen'

export function getProviderId(request: Request): string {
  const cookie = request.headers.get('cookie') ?? ''
  const match = /pa_provider_id=([^;]+)/.exec(cookie)
  return match?.[1] ?? DEMO_PROVIDER_ID
}
