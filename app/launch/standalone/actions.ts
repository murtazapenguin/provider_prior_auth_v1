'use server'

/**
 * app/launch/standalone/actions.ts
 *
 * Server action for the tester sign-in flow.
 *
 * Mock-mode only. Seeds a SmartSession row directly (no OAuth dance) and
 * redirects the tester into the app's queue. The tester then uses the
 * in-app `/pa/new` wizard to create patients and start prior auths exactly
 * as a real provider would. There is no demo-patient picker — the seeded
 * SmartSession carries no patient context.
 *
 * Production / FHIR_MODE=real:
 *   This action throws. Real Epic launches go through
 *   /launch?iss=...&launch=... + the authorize/callback chain.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { prisma } from '@/lib/db/client'
import { encrypt } from '@/lib/smart/crypto'
import { generateSessionToken } from '@/lib/smart/session'
import { SESSION_COOKIE_NAME, signSessionCookie } from '@/lib/smart/sessionCookie'
import { computePostLaunchDestination } from '@/lib/smart/postLaunchRouting'

const MOCK_SCOPE =
  'launch openid fhirUser profile patient/Patient.read patient/Encounter.read patient/Coverage.read'

/** 1-hour mock access-token lifetime (matches a typical Epic expires_in). */
const MOCK_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Seed a mock-mode SmartSession with no specific patient context and
 * redirect into the queue. The tester picks or creates patients via the
 * in-app /pa/new wizard from there.
 *
 * @throws if FHIR_MODE !== 'mock'
 */
export async function signInAsTester(_formData: FormData): Promise<void> {
  const mode = (process.env.FHIR_MODE ?? '').toLowerCase()
  if (mode !== 'mock') {
    throw new Error(
      'Tester sign-in is only available in mock mode (FHIR_MODE=mock). ' +
        'For real Epic launches use /launch?iss=...&launch=... instead.',
    )
  }

  // iss is recorded on the session for parity with real-launch sessions; it
  // is never called against the FHIR endpoint in mock mode (the mock adapter
  // reads fixture JSON instead).
  const iss = process.env.EPIC_SANDBOX_FHIR_BASE
  if (!iss) {
    throw new Error(
      'EPIC_SANDBOX_FHIR_BASE is not set. Set it in the environment before signing in.',
    )
  }

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + MOCK_ACCESS_TOKEN_TTL_MS)

  // Encrypted token at rest. Plaintext exists only on the wire to FHIR
  // (which, in mock mode, doesn't happen — fixture adapter skips HTTP).
  const accessTokenEnc = encrypt('mock-token-for-tester')

  await prisma.smartSession.create({
    data: {
      sessionToken,
      iss,
      accessTokenEnc,
      refreshTokenEnc: null,
      idTokenEnc: null,
      expiresAt,
      // Synthetic — fine in mock mode since getCurrentSession() doesn't
      // call FHIR to resolve this. Real launches put the verified
      // id_token.fhirUser claim here.
      fhirUser: 'Practitioner/mock-provider-1',
      // No specific patient/encounter — the tester picks or creates via the
      // /pa/new wizard.
      patientContext: null,
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
    { patientContext: null, encounterContext: null },
    prisma,
  )

  // `redirect()` throws — execution stops here. Next/server-action contract:
  // the thrown NEXT_REDIRECT is caught by Next and converted to a 303.
  redirect(destination)
}
