import Link from 'next/link'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center">
      <div className="bg-surface border border-border rounded-2xl shadow-xl p-8 w-full max-w-sm text-center space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-surface-foreground">PA Workflow</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <Link
          href="/launch/standalone"
          className="block w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Continue to demo patients
        </Link>
        <p className="text-xs text-muted-foreground">
          Choose a demo patient to enter the workflow. Synthetic data only.
        </p>
      </div>
    </div>
  )
}
