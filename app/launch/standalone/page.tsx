/**
 * app/launch/standalone/page.tsx
 *
 * Tester sign-in. Mock-mode only: a single "Continue" button seeds a
 * SmartSession with no patient context (see ./actions.ts) and redirects to
 * the queue. Testers create patients and start prior auths via the in-app
 * `/pa/new` wizard, exactly as a real provider would.
 *
 * Production / FHIR_MODE=real: shows a placeholder. Real Epic launches go
 * through /launch?iss=... + the authorize/callback chain.
 */

import Link from 'next/link'
import { FHIR_MODE } from '@/lib/fhir'
import { signInAsTester } from './actions'

function MockBanner() {
  return (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-surface-foreground">
      <span className="font-semibold">Test environment.</span>{' '}
      Synthetic data only. Signing in seeds a session for testing the prior-auth workflow.
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
        — or set <code className="font-mono">FHIR_MODE=mock</code> to use the test environment.
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

export default function StandaloneLaunchPage() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-md mx-auto px-6 py-16">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-surface-foreground">
            Sign in to test
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the prior-auth workflow.
          </p>
        </header>
        {FHIR_MODE === 'mock' ? (
          <>
            <MockBanner />
            <form action={signInAsTester}>
              <button
                type="submit"
                className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                Continue
              </button>
            </form>
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
