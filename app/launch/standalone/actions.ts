'use server'

/**
 * app/launch/standalone/actions.ts
 *
 * Server actions for the standalone-launch route. In mock mode the provider
 * picks one of the four demo patients from a card grid; this action
 * directly seeds a SmartSession row in Prisma (no OAuth dance) and
 * redirects per the standard post-launch routing tree.
 *
 * Mock-mode standalone-launch only — T10 audits.
 *
 * Why direct seeding (not /api/auth/smart/callback):
 *   - Replicating an OAuth token-exchange response in-process would create a
 *     second auth-code path T10 would have to audit; T1's callback expects a
 *     real Epic token response with a JWT id_token, which would force us to
 *     mint a fake JWT just to satisfy the callback. Direct SmartSession
 *     seeding is the clean approach — middleware reads SmartSession by
 *     cookie regardless of how the row got there.
 *
 * Production / FHIR_MODE=real:
 *   - This action throws a typed error. Real Epic standalone-launch goes
 *     through the standard /launch?iss=...&launch=... + authorize/callback
 *     chain. Real standalone-launch handling is deferred to
 *     phase-6-epic-verification (see override #4).
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { prisma } from '@/lib/db/client'
import { encrypt } from '@/lib/smart/crypto'
import { generateSessionToken } from '@/lib/smart/session'
import { SESSION_COOKIE_NAME, signSessionCookie } from '@/lib/smart/sessionCookie'
import { computePostLaunchDestination } from '@/lib/smart/postLaunchRouting'

/** Whitelist of demo FHIR patient ids accepted by the mock standalone launch. */
const ALLOWED_PATIENT_IDS = [
  'patient-jordan-avery',
  'patient-sam-rodriguez',
  'patient-priya-shah',
  'patient-eleanor-vance',
] as const

const SelectPatientSchema = z.object({
  patientId: z.enum(ALLOWED_PATIENT_IDS),
})

/** Public scope list seeded into the mock SmartSession. */
const MOCK_SCOPE =
  'launch openid fhirUser profile patient/Patient.read patient/Encounter.read patient/Coverage.read'

/** 1-hour mock access-token lifetime (matches a typical Epic expires_in). */
const MOCK_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Seed a mock-mode SmartSession for the picked patient, set the signed
 * cookie, redirect to the computed post-launch destination.
 *
 * @throws if FHIR_MODE !== 'mock' (real standalone-launch is deferred)
 * @throws if patientId is not in the demo whitelist
 */
export async function selectPatientForMockLaunch(formData: FormData): Promise<void> {
  const mode = (process.env.FHIR_MODE ?? '').toLowerCase()
  if (mode !== 'mock') {
    // We refuse to seed a fake session in real mode — see file header.
    throw new Error(
      'Standalone-launch in mock mode is the only supported standalone path right now. ' +
        'For real Epic standalone-launch, complete app registration and use /launch with a real iss. ' +
        '(Real standalone-launch handling deferred to phase-6-epic-verification.)',
    )
  }

  const rawPatientId = formData.get('patientId')
  const parsed = SelectPatientSchema.safeParse({ patientId: rawPatientId })
  if (!parsed.success) {
    throw new Error('Invalid patient selection — pick one of the demo patients on the page.')
  }
  const { patientId } = parsed.data

  // We pull iss from the env so that when this becomes real, it stays the
  // same Epic sandbox URL. In mock mode the value is never used to make a
  // FHIR call — the mock adapter reads fixture JSON instead.
  const iss = process.env.EPIC_SANDBOX_FHIR_BASE
  if (!iss) {
    throw new Error(
      'EPIC_SANDBOX_FHIR_BASE is not set. Add it to .env.local before running standalone-launch (see .env.example).',
    )
  }

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + MOCK_ACCESS_TOKEN_TTL_MS)

  // Encrypted token at rest. Plaintext exists only on the wire to FHIR
  // (which, in mock mode, doesn't happen — fixture adapter skips HTTP).
  const accessTokenEnc = encrypt(`mock-token-for-${patientId}`)

  await prisma.smartSession.create({
    data: {
      sessionToken,
      iss,
      accessTokenEnc,
      refreshTokenEnc: null,
      idTokenEnc: null,
      expiresAt,
      // Synthetic — fine for mock mode since getCurrentSession() doesn't
      // call FHIR to resolve this. Real launches put the verified
      // id_token.fhirUser claim here.
      fhirUser: 'Practitioner/mock-provider-1',
      patientContext: patientId,
      encounterContext: null,
      scope: MOCK_SCOPE,
    },
  })

  const cookieValue = await signSessionCookie({
    sessionToken,
    expiresAtMs: expiresAt.getTime(),
  })
  const cookieStore = await cookies()
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })

  const destination = await computePostLaunchDestination(
    { patientContext: patientId, encounterContext: null },
    prisma,
  )

  // `redirect()` throws — execution stops here. Next/server-action contract:
  // the thrown NEXT_REDIRECT is caught by Next and converted to a 303.
  redirect(destination)
}
