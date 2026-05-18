import Button from '@/components/ui/Button'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted p-8">
      <h1 className="text-h1 font-bold text-surface-foreground">Provider PA</h1>
      <div className="glass-effect rounded-xl p-6 shadow-md">
        <p className="text-body text-muted-foreground mb-4">Phase 0 scaffold — build in progress.</p>
        <Button>Get Started</Button>
      </div>
    </main>
  )
}
