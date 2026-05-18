'use client'

// Reusable priority classification control for a Prior Authorization.
// Renders a horizontal segmented control (Standard / Expedited / Urgent)
// matching the wizard's existing CPT/HCPCS toggle styling, with a rationale
// textarea conditionally shown for non-standard priorities.

import { Textarea } from '@/components/ui'

export type Priority = 'standard' | 'expedited' | 'urgent'

interface PrioritySelectorProps {
  priority: Priority
  rationale: string
  onPriorityChange: (p: Priority) => void
  onRationaleChange: (r: string) => void
  disabled?: boolean
}

interface OptionMeta {
  value: Priority
  label: string
  activeClass: string
}

// Color cues per the spec: neutral / amber / red. The unselected style mirrors
// the CPT/HCPCS toggle in the wizard (border-border + hover:bg-muted).
const OPTIONS: OptionMeta[] = [
  {
    value: 'standard',
    label: 'Standard',
    activeClass: 'bg-slate-200 text-slate-900',
  },
  {
    value: 'expedited',
    label: 'Expedited',
    activeClass: 'bg-amber-100 text-amber-900 border border-amber-300',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    activeClass: 'bg-red-100 text-red-800 border border-red-300',
  },
]

export default function PrioritySelector({
  priority,
  rationale,
  onPriorityChange,
  onRationaleChange,
  disabled = false,
}: PrioritySelectorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-surface-foreground">Priority</span>
        <div className="flex gap-2">
          {OPTIONS.map((opt) => {
            const active = priority === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onPriorityChange(opt.value)}
                disabled={disabled}
                aria-pressed={active}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                  active
                    ? opt.activeClass
                    : 'border border-border text-surface-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {priority !== 'standard' && (
        <Textarea
          label="Rationale"
          rows={3}
          value={rationale}
          onChange={(e) => onRationaleChange(e.target.value)}
          disabled={disabled}
          hint="Briefly explain why this PA needs to be expedited/urgent."
        />
      )}
    </div>
  )
}
