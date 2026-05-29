/**
 * Payer Policies — provider-facing coverage catalog.
 *
 * Server Component.  Lists every payer with at least one ingested policy,
 * bucketed; per-payer cards show total/reachable counts, a service-category
 * histogram, and the full policy list.
 */

import Link from 'next/link'
import { getPayerPolicyBuckets } from '@/lib/dashboard/payerPoliciesQuery'

export const dynamic = 'force-dynamic'

export default async function PayerPoliciesPage() {
  const buckets = await getPayerPolicyBuckets()

  const totalPayers = buckets.length
  const totalPolicies = buckets.reduce((s, b) => s + b.totalCount, 0)
  const totalReachable = buckets.reduce((s, b) => s + b.reachableCount, 0)

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-foreground">Payer Policies</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {totalPayers} {totalPayers === 1 ? 'payer' : 'payers'} ·{' '}
          {totalPolicies} {totalPolicies === 1 ? 'policy' : 'policies'} ingested ·{' '}
          <span className="text-primary font-medium">{totalReachable} reachable</span> via the{' '}
          <Link href="/pa/new" className="underline">code-entry wizard</Link>.
        </p>
      </div>

      {/* Banner — what this surface is */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-surface-foreground">Coverage at a glance</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every policy on this list has had its criteria + applicable codes extracted by
          our AI ingestion pipeline. When a tester or provider starts a PA with a
          matching procedure / drug / DME code, the policy is auto-selected and its
          criteria are run against the uploaded clinical notes.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          New payers are added by running the ingestion pipeline against their policy
          PDFs — no code changes required.
        </p>
      </div>

      {/* Per-payer cards */}
      {buckets.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">No payers ingested yet.</p>
        </div>
      ) : (
        buckets.map((b) => (
          <section
            key={b.payer.id}
            className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden"
          >
            {/* Header */}
            <header className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  {b.payer.shortCode.slice(0, 3).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-semibold text-surface-foreground">{b.payer.name}</h2>
                  <p className="text-xs text-muted-foreground">{b.payer.shortCode}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                <span className="font-medium text-surface-foreground">{b.totalCount}</span> policies ·{' '}
                <span className="font-medium text-primary">{b.reachableCount}</span> reachable
                {b.totalCount > b.reachableCount && (
                  <span className="ml-1">
                    ({b.totalCount - b.reachableCount} pending code extraction)
                  </span>
                )}
              </div>
            </header>

            {/* Service-category breakdown */}
            {b.serviceBreakdown.length > 0 && (
              <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">By service:</span>
                {b.serviceBreakdown.map((s) => (
                  <span
                    key={s.key}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-medium ${s.chipClass}`}
                  >
                    {s.label}
                    <span className="tabular-nums opacity-70">{s.count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Policy table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="px-5 py-2.5 text-left font-medium">Policy</th>
                    <th className="px-5 py-2.5 text-left font-medium">Service</th>
                    <th className="px-5 py-2.5 text-right font-medium">Criteria</th>
                    <th className="px-5 py-2.5 text-right font-medium">Codes</th>
                    <th className="px-5 py-2.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {b.policies.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-5 py-3 text-surface-foreground">{p.title}</td>
                      <td className="px-5 py-3">
                        {p.category ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${p.category.chipClass}`}
                          >
                            {p.category.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            no codes yet
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-surface-foreground">{p.criteriaCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {p.codeCount === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span className="text-surface-foreground font-medium">{p.codeCount}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <PublishStatusBadge status={p.publishStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function PublishStatusBadge({ status }: { status: string }) {
  if (status === 'published') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-700">
        Published
      </span>
    )
  }
  if (status === 'retired') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
        Retired
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700">
      Draft
    </span>
  )
}
