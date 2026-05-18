/**
 * app/launch/page.tsx
 *
 * SMART on FHIR launch entrypoint. Epic redirects to /launch?iss=&launch=
 * with the FHIR base URL and an opaque launch token. We bounce the user
 * straight to /api/auth/smart/authorize which builds the OAuth dance URL,
 * sets the state cookie, and redirects to Epic.
 *
 * Standalone launch also works: a provider opens https://<our-app>/launch?iss=
 * without a `launch` parameter, and the authorize route swaps the requested
 * scope to launch/patient so Epic shows the patient picker.
 *
 * Phase 6 / Session 5 additions (T9 — additive, see tasks/phase-6-foundation.md):
 *   - `?error=<code>` renders user-friendly per-case messages so the
 *     authorize/callback/refresh routes can land users back here with a
 *     plain-English explanation instead of leaking tokens or env-var names.
 *   - The "missing iss" branch now points the user at /launch/standalone
 *     so they can pick a mock patient without an EHR launch.
 *   - `error.tsx` is the safety net for thrown exceptions
 *     (e.g. MissingEpicConfigError) — see app/launch/error.tsx.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

interface LaunchPageProps {
  searchParams: Promise<{
    iss?: string
    launch?: string
    redirectAfterAuth?: string
    error?: string
  }>
}

// ─── Error copy ──────────────────────────────────────────────────────────────
//
// These strings come straight from the orchestrator override (Phase 6 / T9 /
// override #7). They intentionally avoid leaking env var names or raw Epic
// payloads — error codes / tokens may contain sensitive info.

const ERROR_COPY: Record<
  string,
  { title: string; body: string }
> = {
  missing_iss: {
    title: 'Launch URL is missing the FHIR endpoint',
    body:
      'If you launched from Epic, please retry. If standalone, use /launch/standalone instead.',
  },
  discovery_failed: {
    title: 'Cannot reach the FHIR server',
    body: 'Check the endpoint URL or contact your IT department.',
  },
  missing_config: {
    title: 'App is not registered with this FHIR server yet',
    body: 'Contact your administrator.',
  },
  state_expired: {
    title: 'Launch session expired',
    body: 'Please relaunch from Epic.',
  },
  token_exchange_failed: {
    title: 'Epic returned an error during authentication',
    body: 'Please relaunch.',
  },
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div
        role="alert"
        className="max-w-md bg-surface border border-border rounded-2xl shadow-xl p-8 text-center space-y-4"
      >
        <h1 className="text-xl font-semibold text-surface-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <p className="text-xs text-muted-foreground">
          <Link
            href="/launch/standalone"
            className="underline text-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring rounded"
          >
            Open the standalone patient picker
          </Link>
        </p>
      </div>
    </div>
  )
}

export default async function LaunchPage({ searchParams }: LaunchPageProps) {
  const { iss, launch, redirectAfterAuth, error } = await searchParams

  // Per-error rendering takes precedence — the authorize/callback handlers
  // redirect back here with ?error=<code> to surface a friendly message.
  if (error && ERROR_COPY[error]) {
    const copy = ERROR_COPY[error]
    return <ErrorCard title={copy.title} body={copy.body} />
  }

  if (!iss) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md bg-surface border border-border rounded-2xl shadow-xl p-8 text-center space-y-4">
          <h1 className="text-xl font-semibold">SMART launch parameters missing</h1>
          <p className="text-sm text-muted-foreground">
            This page requires an <code className="font-mono">iss</code> query parameter pointing
            at a FHIR R4 server. EHR launches arrive with both <code>iss</code> and{' '}
            <code>launch</code>; standalone launches need only <code>iss</code>.
          </p>
          <p className="text-xs text-muted-foreground">
            If you are testing locally, open{' '}
            <code className="font-mono">/launch?iss={'<epicFhirBase>'}</code>.
          </p>
          <p className="text-xs text-muted-foreground">
            Want to demo the app without Epic?{' '}
            <Link
              href="/launch/standalone"
              className="underline text-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring rounded"
            >
              Open the standalone patient picker
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  // Server-side redirect to the authorize endpoint. Encode all three params
  // into the next-hop URL — the authorize handler reads them back from query.
  const target = new URL('/api/auth/smart/authorize', 'http://internal')
  target.searchParams.set('iss', iss)
  if (launch) target.searchParams.set('launch', launch)
  if (redirectAfterAuth) target.searchParams.set('redirectAfterAuth', redirectAfterAuth)

  redirect(`/api/auth/smart/authorize?${target.searchParams.toString()}`)
}
