/**
 * lib/smart/types.ts
 *
 * Shared types + zod schemas for the SMART on FHIR launch flow.
 *
 * Wire shapes are validated by zod at the network boundary (discovery,
 * token endpoint, id_token claims). Internal types come from `z.infer`
 * so they stay in lockstep with the validation schemas.
 */

import { z } from 'zod'

/* ───────────────────────────────────────────────────────────────────────────
 *  SMART discovery — /.well-known/smart-configuration
 *  Schema is permissive: Epic returns extra fields we don't model.
 *  We discard them via `.passthrough()` not being used; zod by default
 *  strips unknown keys which is what we want.
 * ───────────────────────────────────────────────────────────────────────── */

export const SmartConfigurationSchema = z.object({
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url().optional(),
  introspection_endpoint: z.string().url().optional(),
  scopes_supported: z.array(z.string()).optional(),
  grant_types_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  issuer: z.string().optional(),
  jwks_uri: z.string().url().optional(),
})

export type SmartConfiguration = z.infer<typeof SmartConfigurationSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Token response from `${token_endpoint}` after the code exchange.
 *  Epic returns: access_token, token_type, expires_in, scope, refresh_token,
 *  id_token, plus the SMART launch-context claims (patient, encounter,
 *  fhirUser) at the top level for EHR launches.
 * ───────────────────────────────────────────────────────────────────────── */

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  patient: z.string().optional(),
  encounter: z.string().optional(),
  // Some Epic responses echo fhirUser here too; we still prefer the
  // claim from the verified id_token over this top-level convenience field.
  fhirUser: z.string().optional(),
})

export type TokenResponse = z.infer<typeof TokenResponseSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  id_token claims we care about.
 *  Spec: https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html#fhirUser
 * ───────────────────────────────────────────────────────────────────────── */

export const IdTokenClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number().optional(),
  fhirUser: z.string().optional(),
  profile: z.string().optional(),
})

export type IdTokenClaims = z.infer<typeof IdTokenClaimsSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Launch state — encoded in a transient encrypted cookie between
 *  /authorize and /callback. Survives Epic redirect; verified on
 *  callback.
 * ───────────────────────────────────────────────────────────────────────── */

export interface StatePayload {
  iss: string
  launch?: string
  codeVerifier: string
  redirectAfterAuth?: string
  nonce: string
  createdAt: number // epoch ms
}

/* ───────────────────────────────────────────────────────────────────────────
 *  getCurrentSession() return shape.
 *  Tokens are DECRYPTED here — never serialize this across API/audit
 *  boundaries. Each call decrypts fresh; nothing caches plaintext.
 * ───────────────────────────────────────────────────────────────────────── */

export interface SmartSessionData {
  id: string
  sessionToken: string
  iss: string
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  expiresAt: Date
  fhirUser: string
  patientContext: string | null
  encounterContext: string | null
  scope: string
  createdAt: Date
  lastUsedAt: Date
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Default requested scopes. Epic returns granted as a subset; we persist
 *  what was granted, not what we asked for.
 * ───────────────────────────────────────────────────────────────────────── */

export const DEFAULT_SCOPES = [
  'launch',
  'openid',
  'fhirUser',
  'profile',
  'offline_access',
  'patient/Patient.read',
  'patient/Encounter.read',
  'patient/Coverage.read',
  'patient/Practitioner.read',
  'patient/ServiceRequest.read',
  'patient/DocumentReference.read',
  'patient/Binary.read',
  'patient/Condition.read',
  'patient/Observation.read',
  'user/Practitioner.read',
].join(' ')

// Standalone launch requires the patient picker scope.
export const STANDALONE_LAUNCH_SCOPES = DEFAULT_SCOPES.replace(
  /\blaunch\b/,
  'launch/patient',
)

// Minimum required granted scopes for the app to function.
export const MIN_REQUIRED_GRANTED_SCOPES = [
  'openid',
  'fhirUser',
  'patient/Patient.read',
] as const

/* ───────────────────────────────────────────────────────────────────────────
 *  Typed errors. Discriminate by `code` so callers can branch without
 *  string-matching messages.
 * ───────────────────────────────────────────────────────────────────────── */

export type SmartLaunchErrorCode =
  | 'discovery_failed'
  | 'state_invalid'
  | 'state_expired'
  | 'state_missing'
  | 'state_nonce_mismatch'
  | 'token_exchange_failed'
  | 'id_token_invalid'
  | 'scope_missing'
  | 'refresh_failed'
  | 'epic_error_response'

export class SmartLaunchError extends Error {
  public readonly code: SmartLaunchErrorCode
  public readonly details?: Record<string, unknown>

  constructor(opts: { code: SmartLaunchErrorCode; message?: string; details?: Record<string, unknown> }) {
    super(opts.message ?? opts.code)
    this.name = 'SmartLaunchError'
    this.code = opts.code
    this.details = opts.details
  }
}

export class MissingEpicConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Epic SMART config missing: ${missing.join(', ')}. ` +
        `Set these env vars (see .env.example) before launching against Epic.`,
    )
    this.name = 'MissingEpicConfigError'
  }
}
