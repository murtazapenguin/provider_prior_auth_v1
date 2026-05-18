// Shared status icons + confidence pill used by both CriterionCard
// and CompactCriterionRow. Pure presentational helpers — no state,
// no side effects.

export function CheckIcon({ overridden }: { overridden: boolean }) {
  return (
    <div
      className={`h-5 w-5 rounded-full flex items-center justify-center ${
        overridden ? 'bg-amber-400' : 'bg-green-500'
      }`}
    >
      <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
}

export function NeedsInfoIcon() {
  return (
    <div className="h-5 w-5 rounded-full bg-amber-400 flex items-center justify-center">
      <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          d="M12 9v2m0 4h.01"
        />
      </svg>
    </div>
  )
}

export function FailedIcon() {
  return (
    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
      <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
}

// Per POLICIES.md: ≥0.8 = high (green), ≥0.5 = medium (amber), <0.5 = low (red)
export function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  if (confidence >= 0.8) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        {pct}%
      </span>
    )
  }
  if (confidence >= 0.5) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        {pct}%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
      {pct}%
    </span>
  )
}

// Detect override: passed with explicit rationale + confidence === 1.0 + no citations.
// Same heuristic CriterionCard already uses — extracted so both cards stay in sync.
export function isOverrideResult(args: {
  status: string
  confidence: number | null
  citations: { length: number }
  rationale: string | null
}): boolean {
  return (
    args.status === 'passed' &&
    args.confidence === 1.0 &&
    args.citations.length === 0 &&
    Boolean(args.rationale)
  )
}
