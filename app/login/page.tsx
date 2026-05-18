export default function LoginPage() {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center">
      <div className="bg-surface border border-border rounded-2xl shadow-xl p-8 w-full max-w-sm text-center space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-surface-foreground">PA Workflow</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <form action="/api/auth/login-as-demo-provider" method="POST">
          <button
            type="submit"
            className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            Sign in as demo provider
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          This sets a session cookie for the hackathon demo environment.
        </p>
      </div>
    </div>
  )
}
