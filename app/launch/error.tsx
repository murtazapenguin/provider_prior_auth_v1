'use client'

/**
 * app/launch/error.tsx
 *
 * React Error Boundary scoped to the /launch segment (and any nested route
 * like /launch/standalone). Catches uncaught exceptions thrown from server
 * components / server actions — e.g. `MissingEpicConfigError` thrown by the
 * SMART discovery path when EPIC_SANDBOX_CLIENT_ID is unset.
 *
 * Important: this file is intentionally bland. We do NOT surface error
 * messages directly because they may contain env-var names, stack traces,
 * or token fragments. The friendly per-code copy lives in /launch/page.tsx
 * under the `?error=<code>` branch; the authorize/callback handlers route
 * users back there with the appropriate code.
 *
 * This boundary's job is to keep the page from rendering a raw 500 when
 * something we didn't anticipate throws. The "Try again" button calls
 * `reset()` so the segment re-renders.
 */

import { useEffect } from 'react'
import Link from 'next/link'

interface LaunchErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function LaunchError({ error, reset }: LaunchErrorProps) {
  useEffect(() => {
    // Log to console only — the surface here never persists PHI / tokens
    // and we deliberately don't expose the raw message in the UI.
    // eslint-disable-next-line no-console
    console.error('Launch error boundary caught', { digest: error.digest })
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div
        role="alert"
        className="max-w-md bg-surface border border-border rounded-2xl shadow-xl p-8 text-center space-y-4"
      >
        <h1 className="text-xl font-semibold text-surface-foreground">
          Something went wrong starting your session
        </h1>
        <p className="text-sm text-muted-foreground">
          The launch could not complete. This is usually a transient problem —
          retry, or relaunch from Epic.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center w-full font-medium rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            Try again
          </button>
          <Link
            href="/launch/standalone"
            className="inline-flex items-center justify-center w-full font-medium rounded-lg px-4 py-2 text-sm border border-border text-surface-foreground bg-transparent hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            Open standalone patient picker
          </Link>
        </div>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Reference id: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
