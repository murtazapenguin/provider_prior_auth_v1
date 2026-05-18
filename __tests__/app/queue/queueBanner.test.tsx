/**
 * __tests__/app/queue/queueBanner.test.tsx
 *
 * Server-Component test for the new post-launch context banners on the
 * /queue page:
 *
 *   ?encounter={id} + no PA   →  "Create PA" banner pointing at /encounter/{id}
 *   ?encounter={id} + PA      →  banner suppressed (provider should have been
 *                                 redirected by computePostLaunchDestination)
 *   ?patient={id}             →  "Pick an encounter" list section
 *   no query                  →  no banner; tabs only
 *
 * Maps to TC-IDs:
 *   - WF-X-encounter-context-switch (banner appears for the right context)
 *   - WF-PROV-launch-standalone (the patient-context section is what mock
 *     standalone-launch lands the provider in)
 */

import { describe, it, expect, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

// ─── Prisma mock (hoisted so the factory can reach it) ────────────────────
const hoisted = vi.hoisted(() => ({
  priorAuthFindFirst: vi.fn<(args: { where: { encounterId: string } }) => Promise<{ id: string } | null>>(),
  patientFindUnique: vi.fn<(args: { where: { id: string } }) => Promise<{ id: string; firstName: string; lastName: string; dob: Date } | null>>(),
  encounterFindMany: vi.fn<(args: { where: { patientId: string } }) => Promise<Array<{
    id: string
    encounterDate: Date
    placeOfService: string
    priorAuths: Array<{ id: string }>
  }>>>(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    priorAuth: { findFirst: hoisted.priorAuthFindFirst },
    patient: { findUnique: hoisted.patientFindUnique },
    encounter: { findMany: hoisted.encounterFindMany },
  },
}))

// QueueTabs is a client component with hooks — we don't need its internals
// for this banner-focused test. Stub it to a marker element so the test
// doesn't touch React state plumbing.
vi.mock('@/components/pa/QueueTabs', () => ({
  default: () => null,
}))

import QueuePage from '@/app/(provider)/queue/page'

// Normalize runs of whitespace so JSX children like {firstName} {lastName}
// (which serialize with extra spaces between the React children) match
// the human-readable assertion strings.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ─── Helper: flatten React tree (handles function components by call) ─────
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

// ─── Tests ────────────────────────────────────────────────────────────────

describe('QueuePage banner (post-launch context)', () => {
  it('renders the "Create PA" banner when ?encounter={id} is set and no PA exists', async () => {
    hoisted.priorAuthFindFirst.mockResolvedValue(null)
    const tree = await QueuePage({
      searchParams: Promise.resolve({ encounter: 'encounter-botox' }),
    })
    const text = normalize(flattenText(tree))
    expect(text).toContain('No PA exists for this encounter yet')
    expect(text).toContain('Create PA')
    expect(text).toContain('encounter-botox')
    expect(hoisted.priorAuthFindFirst).toHaveBeenCalledWith({
      where: { encounterId: 'encounter-botox' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('suppresses the banner when ?encounter={id} is set but a PA already exists', async () => {
    // This shouldn't normally land here — computePostLaunchDestination would
    // have redirected to /pa/{id}. But if a provider lingers on a stale link
    // we still want to not show the misleading "no PA yet" banner.
    hoisted.priorAuthFindFirst.mockResolvedValue({ id: 'pa-rfi-knee-mri' })
    const tree = await QueuePage({
      searchParams: Promise.resolve({ encounter: 'encounter-knee-mri' }),
    })
    const text = normalize(flattenText(tree))
    expect(text).not.toContain('No PA exists for this encounter yet')
  })

  it('renders the "Pick an encounter" section when ?patient={id} is set', async () => {
    hoisted.patientFindUnique.mockResolvedValue({
      id: 'patient-priya-shah',
      firstName: 'Priya',
      lastName: 'Shah',
      dob: new Date('1985-07-22'),
    })
    hoisted.encounterFindMany.mockResolvedValue([
      {
        id: 'encounter-botox',
        encounterDate: new Date('2026-05-05T11:00:00Z'),
        placeOfService: 'Office',
        priorAuths: [],
      },
    ])
    const tree = await QueuePage({
      searchParams: Promise.resolve({ patient: 'patient-priya-shah' }),
    })
    const text = normalize(flattenText(tree))
    expect(text).toContain('Pick an encounter for Priya Shah')
    expect(text).toContain('encounter-botox')
    expect(text).toContain('No PA yet')
    expect(text).toContain('Create PA')
  })

  it('renders "Patient not synced yet" when the patient is unknown', async () => {
    hoisted.patientFindUnique.mockResolvedValue(null)
    const tree = await QueuePage({
      searchParams: Promise.resolve({ patient: 'patient-unknown' }),
    })
    const text = normalize(flattenText(tree))
    expect(text).toContain('Patient not synced yet')
    expect(text).toContain('patient-unknown')
  })

  it('renders no banner when neither encounter nor patient is in the URL', async () => {
    hoisted.priorAuthFindFirst.mockReset()
    hoisted.patientFindUnique.mockReset()
    hoisted.encounterFindMany.mockReset()
    const tree = await QueuePage({ searchParams: Promise.resolve({}) })
    const text = normalize(flattenText(tree))
    expect(text).not.toContain('No PA exists for this encounter yet')
    expect(text).not.toContain('Pick an encounter')
    expect(text).not.toContain('Patient not synced yet')
    // The header is always there
    expect(text).toContain('Work Queue')
    // We did not look up either prisma path
    expect(hoisted.priorAuthFindFirst).not.toHaveBeenCalled()
    expect(hoisted.patientFindUnique).not.toHaveBeenCalled()
  })
})
