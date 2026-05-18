#!/usr/bin/env tsx
/**
 * scripts/qa/mint-smart-session.ts (gate-12 qa-engineer helper, NOT shipped)
 *
 * Mints a mock-mode SmartSession row directly in Prisma and prints the
 * signed cookie value to stdout — equivalent to clicking a patient card
 * on /launch/standalone, but in-process so we can pipe the cookie into curl.
 *
 * Mirrors `app/launch/standalone/actions.ts:selectPatientForMockLaunch`
 * exactly — same encrypt() wrapper, same MOCK_SCOPE, same TTL, same cookie
 * signing call. The only difference is we print the cookie instead of
 * setting it via next/headers + redirecting.
 *
 * Usage:
 *   pnpm tsx scripts/qa/mint-smart-session.ts <patientId>
 *   pnpm tsx scripts/qa/mint-smart-session.ts patient-jordan-avery
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { prisma } from '../../lib/db/client'
import { encrypt } from '../../lib/smart/crypto'
import { generateSessionToken } from '../../lib/smart/session'
import { signSessionCookie, SESSION_COOKIE_NAME } from '../../lib/smart/sessionCookie'

const ALLOWED_PATIENT_IDS = [
  'patient-jordan-avery',
  'patient-sam-rodriguez',
  'patient-priya-shah',
  'patient-eleanor-vance',
] as const

const MOCK_SCOPE =
  'launch openid fhirUser profile patient/Patient.read patient/Encounter.read patient/Coverage.read'
const MOCK_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000

async function main(): Promise<void> {
  const patientId = process.argv[2]
  if (!patientId || !ALLOWED_PATIENT_IDS.includes(patientId as never)) {
    console.error(`Usage: pnpm tsx scripts/qa/mint-smart-session.ts <patientId>`)
    console.error(`  Allowed: ${ALLOWED_PATIENT_IDS.join(', ')}`)
    process.exit(1)
  }

  const iss = process.env.EPIC_SANDBOX_FHIR_BASE
  if (!iss) {
    console.error('EPIC_SANDBOX_FHIR_BASE missing — check .env.local')
    process.exit(1)
  }

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + MOCK_ACCESS_TOKEN_TTL_MS)
  const accessTokenEnc = encrypt(`mock-token-for-${patientId}`)

  await prisma.smartSession.create({
    data: {
      sessionToken,
      iss,
      accessTokenEnc,
      refreshTokenEnc: null,
      idTokenEnc: null,
      expiresAt,
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

  // Single-line output: COOKIE_NAME=VALUE for direct piping into curl.
  console.log(`${SESSION_COOKIE_NAME}=${cookieValue}`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('mint-smart-session failed:', err)
  process.exit(1)
})
