/**
 * __tests__/app/(admin)/policies/adminPoliciesPage.test.ts
 *
 * Server-component smoke tests for the admin policy list page.
 *
 * Covers:
 *   - default (status=all) renders all policies
 *   - status=draft filters the WHERE clause
 *   - status=published filters the WHERE clause
 *   - garbage status falls back to all
 *   - empty result renders the empty state
 *
 * Strategy: mock the Prisma client and walk the returned React tree to
 * assert the expected text. Mirrors the queueBanner test approach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

// ─── Hoisted Prisma mock ──────────────────────────────────────────────────
const hoisted = vi.hoisted(() => ({
  policyFindMany: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    policy: { findMany: hoisted.policyFindMany },
  },
}))

import AdminPoliciesPage from '@/app/(admin)/policies/page'

// ─── Tree walker (same pattern as launchPage.test.ts) ─────────────────────
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
        // ignore — some server components are not safely callable here.
      }
    }
    return parts.join(' ')
  }
  return ''
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ─── Fixtures ─────────────────────────────────────────────────────────────
const handCurated = {
  id: 'policy-uhc-evicore-head-ct',
  title: 'Head CT (eviCore)',
  policyType: 'Medical Policy',
  externalId: null,
  publishStatus: 'published',
  publishedAt: new Date('2026-05-12T11:00:00Z'),
  publishedBy: 'seed',
  policyVersion: 'phase-1-curated',
  effectiveFrom: new Date('2024-01-01T00:00:00Z'),
  effectiveTo: null,
  payer: { id: 'payer-uhc', name: 'United Healthcare', shortCode: 'UHC' },
  _count: { criteria: 3, applicableCodes: 1 },
}

const aiDraft = {
  id: 'policy-uhc-ai-mri-ankle',
  title: 'Ankle MRI (AI-ingested)',
  policyType: 'Medical Policy',
  externalId: 'MP-123',
  publishStatus: 'draft',
  publishedAt: null,
  publishedBy: null,
  policyVersion: null,
  effectiveFrom: new Date('2026-05-01T00:00:00Z'),
  effectiveTo: null,
  payer: { id: 'payer-uhc', name: 'United Healthcare', shortCode: 'UHC' },
  _count: { criteria: 7, applicableCodes: 2 },
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AdminPoliciesPage', () => {
  beforeEach(() => {
    hoisted.policyFindMany.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders all policies when no status filter is set', async () => {
    hoisted.policyFindMany.mockResolvedValue([handCurated, aiDraft])

    const tree = await AdminPoliciesPage({ searchParams: Promise.resolve({}) })
    const text = normalize(flattenText(tree))

    expect(text).toContain('Head CT (eviCore)')
    expect(text).toContain('Ankle MRI (AI-ingested)')
    expect(text).toContain('published')
    expect(text).toContain('draft')
    expect(text).toContain('UHC')
    // Filter dropdown defaults to 'all'.
    expect(text).toContain('Filter')

    // Verify the WHERE clause did NOT include publishStatus when status=all.
    expect(hoisted.policyFindMany).toHaveBeenCalledTimes(1)
    const callArgs = hoisted.policyFindMany.mock.calls[0][0]
    expect(callArgs.where).toEqual({})
    expect(callArgs.orderBy).toEqual([
      { publishStatus: 'asc' },
      { title: 'asc' },
    ])
  })

  it('filters by publishStatus when status=draft', async () => {
    hoisted.policyFindMany.mockResolvedValue([aiDraft])

    const tree = await AdminPoliciesPage({
      searchParams: Promise.resolve({ status: 'draft' }),
    })
    const text = normalize(flattenText(tree))

    expect(text).toContain('Ankle MRI (AI-ingested)')
    expect(text).not.toContain('Head CT (eviCore)')

    const callArgs = hoisted.policyFindMany.mock.calls[0][0]
    expect(callArgs.where).toEqual({ publishStatus: 'draft' })
  })

  it('filters by publishStatus when status=published', async () => {
    hoisted.policyFindMany.mockResolvedValue([handCurated])

    const tree = await AdminPoliciesPage({
      searchParams: Promise.resolve({ status: 'published' }),
    })
    const text = normalize(flattenText(tree))

    expect(text).toContain('Head CT (eviCore)')

    const callArgs = hoisted.policyFindMany.mock.calls[0][0]
    expect(callArgs.where).toEqual({ publishStatus: 'published' })
  })

  it('falls back to status=all when an invalid status is passed', async () => {
    hoisted.policyFindMany.mockResolvedValue([handCurated, aiDraft])

    await AdminPoliciesPage({
      searchParams: Promise.resolve({ status: 'banana' }),
    })

    const callArgs = hoisted.policyFindMany.mock.calls[0][0]
    expect(callArgs.where).toEqual({})
  })

  it('renders an empty state when no policies match', async () => {
    hoisted.policyFindMany.mockResolvedValue([])

    const tree = await AdminPoliciesPage({
      searchParams: Promise.resolve({ status: 'retired' }),
    })
    const text = normalize(flattenText(tree))

    expect(text).toContain('No policies match the current filter.')
  })
})
