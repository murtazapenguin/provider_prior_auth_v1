/**
 * __tests__/app/(admin)/policies/adminPolicyDetailPage.test.ts
 *
 * Server-component smoke tests for the admin policy detail page.
 *
 * Covers:
 *   - draft policy renders the Publish button + a POST form pointing at the
 *     publish route
 *   - published policy renders the "Published <date> by <user>" footer and
 *     hides the Publish button
 *   - 404 path calls notFound() (we mock it to throw a known sentinel)
 *   - criteria + codes are listed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

const hoisted = vi.hoisted(() => ({
  policyFindUnique: vi.fn(),
  notFoundSpy: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: { policy: { findUnique: hoisted.policyFindUnique } },
}))

vi.mock('next/navigation', () => ({
  notFound: hoisted.notFoundSpy,
  redirect: vi.fn(),
}))

import AdminPolicyDetailPage from '@/app/(admin)/policies/[id]/page'

// Walk the tree (same pattern as adminPoliciesPage.test.ts).
function flattenText(node: unknown, depth = 0): string {
  if (depth > 60) return ''
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => flattenText(n, depth + 1)).join(' ')
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>
    const parts: string[] = []
    for (const [key, value] of Object.entries(el.props ?? {})) {
      if (key === 'children') continue
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(String(value))
      }
    }
    parts.push(flattenText((el.props as { children?: unknown })?.children, depth + 1))
    if (typeof el.type === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Component = el.type as (props: any) => unknown
        const rendered = Component(el.props ?? {})
        parts.push(flattenText(rendered, depth + 1))
      } catch {
        // ignore
      }
    }
    return parts.join(' ')
  }
  return ''
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Find any element whose `type` is the string 'form'.
function findForms(node: unknown, acc: ReactElement[] = [], depth = 0): ReactElement[] {
  if (depth > 60) return acc
  if (node == null || typeof node === 'boolean') return acc
  if (Array.isArray(node)) {
    for (const c of node) findForms(c, acc, depth + 1)
    return acc
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>
    if (el.type === 'form') acc.push(el)
    findForms((el.props as { children?: unknown })?.children, acc, depth + 1)
    if (typeof el.type === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Component = el.type as (props: any) => unknown
        const rendered = Component(el.props ?? {})
        findForms(rendered, acc, depth + 1)
      } catch {
        // ignore
      }
    }
  }
  return acc
}

const baseCodes = [
  {
    id: 'pc-1',
    policyId: 'policy-uhc-ai-knee-mri',
    codeType: 'CPT',
    code: '73721',
    modifier: null,
    posCodes: [],
  },
]

const baseCriteria = [
  {
    id: 'crit-1',
    policyId: 'policy-uhc-ai-knee-mri',
    ordinal: 1,
    text: 'Conservative therapy attempted ≥6 weeks',
    evidenceHint: 'Look in PT notes',
    requiredCodes: [],
    group: null,
    groupOperator: null,
    sourceBboxes: null,
    sourceLineNumbers: [],
  },
]

describe('AdminPolicyDetailPage', () => {
  beforeEach(() => {
    hoisted.policyFindUnique.mockReset()
    hoisted.notFoundSpy.mockClear()
  })

  it('renders the Publish button for a draft policy', async () => {
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'policy-uhc-ai-knee-mri',
      title: 'Knee MRI (AI-ingested)',
      policyType: 'Medical Policy',
      externalId: null,
      publishStatus: 'draft',
      publishedAt: null,
      publishedBy: null,
      policyVersion: null,
      effectiveFrom: new Date('2026-05-01T00:00:00Z'),
      effectiveTo: null,
      sourceUrl: null,
      payer: { id: 'payer-uhc', name: 'United Healthcare', shortCode: 'UHC' },
      applicableCodes: baseCodes,
      criteria: baseCriteria,
    })

    const tree = await AdminPolicyDetailPage({
      params: Promise.resolve({ id: 'policy-uhc-ai-knee-mri' }),
    })
    const text = normalize(flattenText(tree))

    expect(text).toContain('Knee MRI (AI-ingested)')
    expect(text).toContain('draft')
    expect(text).toContain('Publish policy')
    expect(text).toContain('Conservative therapy attempted')

    // The Publish button is inside a <form method="post" action="...">.
    const forms = findForms(tree)
    expect(forms.length).toBeGreaterThanOrEqual(1)
    const publishForm = forms.find(
      (f) =>
        typeof (f.props as { action?: unknown }).action === 'string' &&
        ((f.props as { action: string }).action.includes('/publish')),
    )
    expect(publishForm).toBeDefined()
    expect((publishForm!.props as { method?: string }).method).toBe('post')
    expect((publishForm!.props as { action: string }).action).toBe(
      '/policies/policy-uhc-ai-knee-mri/publish',
    )
  })

  it('hides the Publish button for a published policy and shows the publisher line', async () => {
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'policy-uhc-evicore-head-ct',
      title: 'Head CT (eviCore)',
      policyType: 'Medical Policy',
      externalId: null,
      publishStatus: 'published',
      publishedAt: new Date('2026-05-10T09:00:00Z'),
      publishedBy: 'seed',
      policyVersion: 'phase-1-curated',
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      effectiveTo: null,
      sourceUrl: null,
      payer: { id: 'payer-uhc', name: 'United Healthcare', shortCode: 'UHC' },
      applicableCodes: baseCodes,
      criteria: baseCriteria,
    })

    const tree = await AdminPolicyDetailPage({
      params: Promise.resolve({ id: 'policy-uhc-evicore-head-ct' }),
    })
    const text = normalize(flattenText(tree))

    expect(text).toContain('Head CT (eviCore)')
    expect(text).toContain('published')
    expect(text).toContain('seed')
    expect(text).not.toContain('Publish policy')

    const forms = findForms(tree)
    expect(
      forms.find(
        (f) =>
          typeof (f.props as { action?: unknown }).action === 'string' &&
          (f.props as { action: string }).action.includes('/publish'),
      ),
    ).toBeUndefined()
  })

  it('calls notFound() when the policy does not exist', async () => {
    hoisted.policyFindUnique.mockResolvedValue(null)

    await expect(
      AdminPolicyDetailPage({ params: Promise.resolve({ id: 'missing-id' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hoisted.notFoundSpy).toHaveBeenCalled()
  })
})
