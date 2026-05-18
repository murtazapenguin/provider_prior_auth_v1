/**
 * app/(admin)/policies/page.tsx
 *
 * Clinical Informaticist policy list. Shows every Policy row (regardless of
 * publishStatus) with quick filtering via `?status=draft|published|retired`.
 *
 * Read-only server component. Mutations (publish) happen via the route
 * handler at `[id]/publish/route.ts`.
 *
 * TC-IDs covered:
 *   - WF-INF-policy-review (the page itself)
 *   - WF-INF-criteria-accuracy-monitoring (partial — surface the
 *     draft/published distribution so an informaticist knows where to look)
 *
 * TODO(phase-6-compliance): NO RBAC YET — the (admin) layout's
 * `getCurrentSession()` check is the only gate. Add an admin-role
 * authorization check before production.
 */

import Link from 'next/link'
import { prisma } from '@/lib/db/client'
import { Card } from '@/components/ui'
import Badge from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'

type PublishStatusFilter = 'all' | 'draft' | 'published' | 'retired'

const VALID_FILTERS: PublishStatusFilter[] = ['all', 'draft', 'published', 'retired']

interface AdminPoliciesPageProps {
  searchParams: Promise<{ status?: string }>
}

function normalizeStatusFilter(raw: string | undefined): PublishStatusFilter {
  if (!raw) return 'all'
  const v = raw.toLowerCase()
  return (VALID_FILTERS as string[]).includes(v) ? (v as PublishStatusFilter) : 'all'
}

function formatRelativeDate(d: Date | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

function publishStatusBadgeVariant(
  s: string,
): 'success' | 'warning' | 'danger' | 'default' {
  if (s === 'published') return 'success'
  if (s === 'draft') return 'warning'
  if (s === 'retired') return 'danger'
  return 'default'
}

export default async function AdminPoliciesPage({
  searchParams,
}: AdminPoliciesPageProps) {
  const params = await searchParams
  const filter = normalizeStatusFilter(params.status)

  const where = filter === 'all' ? {} : { publishStatus: filter }

  const policies = await prisma.policy.findMany({
    where,
    select: {
      id: true,
      title: true,
      policyType: true,
      externalId: true,
      publishStatus: true,
      publishedAt: true,
      publishedBy: true,
      policyVersion: true,
      effectiveFrom: true,
      effectiveTo: true,
      payer: { select: { id: true, name: true, shortCode: true } },
      _count: { select: { criteria: true, applicableCodes: true } },
    },
    orderBy: [{ publishStatus: 'asc' }, { title: 'asc' }],
  })

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      <header className="mb-5 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-surface-foreground">
            Policies
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Review AI-ingested and hand-curated policies. Publish a draft to
            make it visible to the matching engine under{' '}
            <code className="font-mono text-xs">POLICY_SOURCE=production</code>.
          </p>
        </div>
        <FilterDropdown current={filter} />
      </header>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Payer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Updated</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No policies match the current filter.
                  </td>
                </tr>
              ) : (
                policies.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/policies/${encodeURIComponent(p.id)}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {p.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.policyType}
                        {p.externalId ? ` · ${p.externalId}` : ''}
                        {p._count.applicableCodes > 0
                          ? ` · ${p._count.applicableCodes} codes`
                          : ''}
                        {p._count.criteria > 0
                          ? ` · ${p._count.criteria} criteria`
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-surface-foreground">
                      {p.payer.shortCode}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={publishStatusBadgeVariant(p.publishStatus)}>
                        {p.publishStatus}
                      </Badge>
                      {p.policyVersion ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p.policyVersion}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeDate(p.publishedAt ?? p.effectiveFrom)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/policies/${encodeURIComponent(p.id)}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function FilterDropdown({ current }: { current: PublishStatusFilter }) {
  return (
    <form method="get" className="flex items-center gap-2">
      <label htmlFor="status-filter" className="text-xs text-muted-foreground">
        Filter
      </label>
      <select
        id="status-filter"
        name="status"
        defaultValue={current}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
      >
        <option value="all">All</option>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="retired">Retired</option>
      </select>
      <button
        type="submit"
        className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
      >
        Apply
      </button>
    </form>
  )
}
