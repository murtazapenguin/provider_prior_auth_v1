import ScenarioCard from '@/components/demo/ScenarioCard'
import type { ScenarioCardProps } from '@/components/demo/ScenarioCard'

// ─── Scenario data ────────────────────────────────────────────────────────────
// Sourced from DEMO_SCENARIOS.md

const SCENARIOS: ScenarioCardProps[] = [
  {
    encounterId: 'encounter-head-ct',
    title: 'Scenario 1: Head CT — PCP order',
    patientName: 'Jordan Avery',
    patientAge: 58,
    patientSex: 'F',
    specialty: 'Internal Medicine (PCP)',
    code: '70450',
    codeType: 'CPT',
    payer: 'UHC Choice Plus',
    demonstrates: [
      'Happy path — all criteria met on first pass',
      'Code derivation from PCP-style notes',
      'Policy lookup against commercial payer',
      'Submit → simulated approval pipeline',
    ],
    firstPassOutcome: 'All criteria pass; PA goes directly to Ready for Submission.',
    providerAction: 'None — review packet and click Submit.',
    postSubmission: 'Pending → In Progress → Approved (~2 min, or ~6 sec fast-forward).',
    estimatedMinutes: 2,
  },
  {
    encounterId: 'encounter-knee-mri',
    title: 'Scenario 2: Knee MRI — Orthopedic order',
    patientName: 'Sam Rodriguez',
    patientAge: 53,
    patientSex: 'M',
    specialty: 'Orthopedic Surgery',
    code: '73721',
    codeType: 'CPT',
    payer: 'UHC Choice Plus (eviCore)',
    demonstrates: [
      'Upload-and-recheck loop — the core missing-evidence workflow',
      'AI returning needs_info with a clear rationale',
      'Re-running extraction across all criteria after upload',
      'Citation to a newly uploaded document',
    ],
    firstPassOutcome: 'One criterion fails: conservative therapy not documented. Two pass.',
    providerAction: 'Upload PT discharge summary (8 weeks, 2x/week). System rechecks.',
    postSubmission: 'Pending → In Progress → Approved after clean second pass.',
    estimatedMinutes: 3,
  },
  {
    encounterId: 'encounter-botox',
    title: 'Scenario 3: Botox for Migraines — Neurology order',
    patientName: 'Priya Shah',
    patientAge: 40,
    patientSex: 'F',
    specialty: 'Neurology',
    code: 'J0585',
    codeType: 'HCPCS',
    payer: 'UHC Choice Plus',
    demonstrates: [
      'Multi-criterion evaluation with mixed pass / needs_info',
      'Manual override flow with audit trail',
      'Citations across multiple note types (progress note, diary, prior PCP note)',
      'RFI loop — payer requests info, provider responds, approval follows',
    ],
    firstPassOutcome: 'Two criteria pass; one flagged needs_info (amitriptyline trial < 2 months).',
    providerAction: 'Manual override: propranolol + topiramate already satisfy criterion 2.',
    postSubmission: 'Pending → In Progress → RFI → provider responds → Approved.',
    estimatedMinutes: 4,
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DemoLauncherPage() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Header */}
        <div className="glass-effect rounded-xl border border-border px-6 py-4">
          <h1 className="text-xl font-semibold text-surface-foreground">
            Demo scenario launcher — these load synthetic data and walk through a scripted PA flow.
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            No real PHI or payer systems are involved. Select a scenario below to begin.
          </p>
        </div>

        {/* Scenario cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {SCENARIOS.map((scenario) => (
            <ScenarioCard key={scenario.encounterId} {...scenario} />
          ))}
        </div>

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center">
          Suggested order: Head CT (~2 min) → Knee MRI (~3 min) → Botox (~4 min).
          Total with narration: ~9–10 minutes.
        </p>
      </div>
    </div>
  )
}
