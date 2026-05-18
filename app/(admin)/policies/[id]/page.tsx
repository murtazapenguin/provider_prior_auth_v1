/**
 * app/(admin)/policies/[id]/page.tsx
 *
 * Policy detail review surface — shows codes + criteria, plus a Publish
 * button when the policy is currently in 'draft' status.
 *
 * Read-only display. Publish action posts to
 * `app/(admin)/policies/[id]/publish/route.ts`.
 *
 * TC-IDs covered:
 *   - WF-INF-policy-review (criteria visibility)
 *   - WF-INF-trigger-rescrape (the manual Publish button is the operator
 *     trigger surface; the underlying re-extraction lives on the
 *     ai-engineer side of this pair ticket)
 *
 * TODO(phase-6-compliance): NO RBAC YET — the (admin) layout's
 * `getCurrentSession()` check is the only gate. Add an admin-role
 * authorization check before production.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db/client'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

interface AdminPolicyDetailPageProps {
  params: Promise<{ id: string }>
}

function formatDate(d: Date | null): string {
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

export default async function AdminPolicyDetailPage({
  params,
}: AdminPolicyDetailPageProps) {
  const { id } = await params

  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      payer: { select: { id: true, name: true, shortCode: true } },
      applicableCodes: {
        orderBy: [{ codeType: 'asc' }, { code: 'asc' }],
      },
      criteria: {
        orderBy: { ordinal: 'asc' },
      },
    },
  })

  if (!policy) {
    notFound()
  }

  const isDraft = policy.publishStatus === 'draft'

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-5">
      <nav className="text-xs text-muted-foreground">
        <Link href="/policies" className="hover:underline">
          ← All policies
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-surface-foreground">
            {policy.title}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={publishStatusBadgeVariant(policy.publishStatus)}>
              {policy.publishStatus}
            </Badge>
            <span>·</span>
            <span>{policy.payer.shortCode}</span>
            <span>·</span>
            <span>{policy.policyType}</span>
            {policy.externalId ? (
              <>
                <span>·</span>
                <span>{policy.externalId}</span>
              </>
            ) : null}
            {policy.policyVersion ? (
              <>
                <span>·</span>
                <span>{policy.policyVersion}</span>
              </>
            ) : null}
          </div>
        </div>
        <div>
          {isDraft ? (
            <form
              method="post"
              action={`/policies/${encodeURIComponent(policy.id)}/publish`}
            >
              <Button type="submit" variant="primary" size="md">
                Publish policy
              </Button>
            </form>
          ) : (
            <div className="text-xs text-muted-foreground text-right">
              Published{' '}
              <span className="font-medium">{formatDate(policy.publishedAt)}</span>
              {policy.publishedBy ? (
                <>
                  {' '}
                  by <span className="font-mono">{policy.publishedBy}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Effective from</dt>
              <dd className="mt-0.5 text-surface-foreground">
                {formatDate(policy.effectiveFrom)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Effective to</dt>
              <dd className="mt-0.5 text-surface-foreground">
                {formatDate(policy.effectiveTo)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Source URL</dt>
              <dd className="mt-0.5 text-surface-foreground break-all">
                {policy.sourceUrl ?? '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applicable codes ({policy.applicableCodes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {policy.applicableCodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No codes have been associated with this policy yet.
            </p>
          ) : (
            <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {policy.applicableCodes.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground mr-1">
                    {c.codeType}
                  </span>
                  <span className="font-medium text-surface-foreground">
                    {c.code}
                  </span>
                  {c.modifier ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      mod {c.modifier}
                    </span>
                  ) : null}
                  {c.posCodes.length > 0 ? (
                    <span className="block mt-0.5 text-xs text-muted-foreground">
                      POS: {c.posCodes.join(', ')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Criteria ({policy.criteria.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {policy.criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No criteria have been extracted yet. AI ingestion will populate
              this section.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="Policy criteria">
              {policy.criteria.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono text-muted-foreground">
                      #{c.ordinal}
                    </span>
                    {c.group ? (
                      <span className="text-xs text-muted-foreground">
                        ({c.group} · {c.groupOperator ?? 'ALL'})
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-surface-foreground whitespace-pre-wrap">
                    {c.text}
                  </p>
                  {c.evidenceHint ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Hint: {c.evidenceHint}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
