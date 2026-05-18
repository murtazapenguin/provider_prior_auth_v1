/**
 * app/launch/standalone/page.tsx
 *
 * Standalone-launch route. Two modes:
 *
 *   FHIR_MODE=mock (dev default)
 *     - Renders a card grid of the four demo patients from
 *       prisma/fixtures/fhir/patient/. Clicking a card calls
 *       selectPatientForMockLaunch() (see ./actions.ts) which seeds a
 *       SmartSession row directly, sets the signed cookie, and redirects.
 *     - Mock-mode standalone-launch only — T10 audits.
 *
 *   FHIR_MODE=real (post-Epic-registration)
 *     - Placeholder card explaining that real Epic standalone-launch is
 *       deferred to phase-6-epic-verification. Pointing the user back to
 *       /launch?iss=... is the expected workflow once the app is registered.
 *
 * Placed under /launch/standalone (not /standalone-launch) so that the
 * existing middleware public-path prefix match on '/launch' allows
 * unauthenticated access without modifying middleware.ts.
 */

import Link from 'next/link'
import { searchPatients, FHIR_MODE } from '@/lib/fhir'
import PatientPicker, { type PatientCard } from './PatientPicker'
import { selectPatientForMockLaunch } from './actions'

// Server Component by default — needs to do a FHIR mock search at render
// time. The interactive card grid is the only client-side surface (in
// PatientPicker).

function MockEnvironmentBanner() {
  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-xs text-surface-foreground">
      <span className="font-semibold">Mock mode.</span>{' '}
      Selecting a patient seeds a local demo session — no real Epic call is made.
    </div>
  )
}

function RealModePlaceholder() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-4">
      <h2 className="text-lg font-semibold text-surface-foreground">
        Epic registration pending
      </h2>
      <p className="text-sm text-muted-foreground">
        Standalone launch against the real Epic sandbox requires app registration. This
        path is deferred to <code className="font-mono">phase-6-epic-verification</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        For now, launch from inside Epic with{' '}
        <code className="font-mono">/launch?iss=&lt;EpicFHIR&gt;&amp;launch=&lt;token&gt;</code>{' '}
        — or set <code className="font-mono">FHIR_MODE=mock</code> in{' '}
        <code className="font-mono">.env.local</code> to demo with fixture data.
      </p>
      <Link
        href="/launch"
        className="inline-flex items-center justify-center font-medium rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Back to launch
      </Link>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-danger/40 bg-danger/5 p-6 text-center text-sm text-surface-foreground"
    >
      <p className="font-semibold">Could not load patients</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  )
}

export default async function StandaloneLaunchPage() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-surface-foreground">
            Standalone launch
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a demo patient to start a prior-authorization session.
          </p>
        </header>

        {FHIR_MODE === 'mock' ? (
          <>
            <MockEnvironmentBanner />
            <PatientPickerSection />
          </>
        ) : (
          <RealModePlaceholder />
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Already have an EHR launch URL?{' '}
          <Link
            href="/launch"
            className="underline text-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring rounded"
          >
            Use /launch?iss=…
          </Link>{' '}
          instead.
        </p>
      </div>
    </div>
  )
}

async function PatientPickerSection() {
  let patients: PatientCard[] = []
  let loadError: string | null = null

  try {
    const fhirPatients = await searchPatients({ _count: 20 })
    patients = fhirPatients.map((p) => {
      const name = (p.name ?? [])[0]
      const firstName = (name?.given ?? [])[0] ?? ''
      const lastName = name?.family ?? ''
      return {
        id: p.id,
        firstName,
        lastName,
        dob: p.birthDate ?? '',
        sex: p.gender ?? '',
      }
    })
    // Stable ordering for the demo grid.
    patients.sort((a, b) =>
      a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    )
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Unknown error loading patients.'
  }

  if (loadError) {
    return <ErrorState message={loadError} />
  }

  return <PatientPicker patients={patients} action={selectPatientForMockLaunch} />
}
