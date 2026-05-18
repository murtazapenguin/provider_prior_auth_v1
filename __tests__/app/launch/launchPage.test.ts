/**
 * __tests__/app/launch/launchPage.test.ts
 *
 * Tests the launch page's Server-Component rendering and redirect contract:
 *   - ?error=<code> renders the friendly per-case copy (orchestrator
 *     override #7)
 *   - missing iss renders the "missing parameters" inline form, including
 *     the /launch/standalone fallback link
 *   - iss present + no error redirects via next/navigation.redirect() to
 *     /api/auth/smart/authorize with the params forwarded
 *
 * We don't pull in @testing-library/react — the page is a plain async
 * function that returns a React element tree, so we walk the tree looking
 * for the expected string content. That keeps the test in the node env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

// ─── next/navigation mock ─────────────────────────────────────────────────
const hoisted = vi.hoisted(() => ({
  redirectSpy: vi.fn((_url: string) => {
    const err = new Error('NEXT_REDIRECT')
    ;(err as Error & { digest: string }).digest = `NEXT_REDIRECT;push;${_url};303;`
    throw err
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: hoisted.redirectSpy,
}))

import LaunchPage from '@/app/launch/page'

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Flatten a React element tree to its visible text. Walks both intrinsic
 * elements (string types like 'div') and function components (the page
 * may render `<ErrorCard title=... body=... />` whose text-bearing props
 * live OUTSIDE `children`). For function components we invoke them to get
 * their rendered subtree and additionally include any string-valued props
 * so passing copy through `title=`/`body=` still shows up in the search.
 */
function flattenText(node: unknown, depth = 0): string {
  if (depth > 50) return '' // safety against accidental cycles
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => flattenText(n, depth + 1)).join(' ')
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>
    const propsText: string[] = []
    for (const [key, value] of Object.entries(el.props ?? {})) {
      if (key === 'children') continue
      if (typeof value === 'string' || typeof value === 'number') {
        propsText.push(String(value))
      }
    }
    let childrenText = flattenText(
      (el.props as { children?: unknown })?.children,
      depth + 1,
    )

    // If this is a function component, invoke it so its output text is
    // included too. We don't render to HTML — just chase the function
    // return value and walk it as another React element tree.
    if (typeof el.type === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Component = el.type as (props: any) => unknown
        const rendered = Component(el.props ?? {})
        childrenText += ' ' + flattenText(rendered, depth + 1)
      } catch {
        // ignore — some components (server-only) may not be safely callable here.
      }
    }
    return [...propsText, childrenText].join(' ')
  }
  return ''
}

function renderAndExtractText(promise: Promise<unknown>): Promise<string> {
  return promise.then((tree) => flattenText(tree).replace(/\s+/g, ' ').trim())
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('LaunchPage', () => {
  beforeEach(() => {
    hoisted.redirectSpy.mockClear()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the missing-iss inline form when no iss is provided', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({}) }),
    )
    expect(text).toContain('SMART launch parameters missing')
    expect(text).toContain('Open the standalone patient picker')
    expect(hoisted.redirectSpy).not.toHaveBeenCalled()
  })

  it('renders the discovery_failed friendly message for ?error=discovery_failed', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({ error: 'discovery_failed' }) }),
    )
    expect(text).toContain('Cannot reach the FHIR server')
    expect(text).toContain('Check the endpoint URL')
  })

  it('renders the missing_config friendly message for ?error=missing_config (no env var leak)', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({ error: 'missing_config' }) }),
    )
    expect(text).toContain('App is not registered with this FHIR server yet')
    expect(text).toContain('Contact your administrator')
    expect(text).not.toContain('EPIC_SANDBOX_CLIENT_ID')
  })

  it('renders the state_expired friendly message for ?error=state_expired', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({ error: 'state_expired' }) }),
    )
    expect(text).toContain('Launch session expired')
  })

  it('renders the token_exchange_failed friendly message for ?error=token_exchange_failed', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({ error: 'token_exchange_failed' }) }),
    )
    expect(text).toContain('Epic returned an error during authentication')
  })

  it('ignores unknown error codes and falls through to the iss/redirect branch', async () => {
    const text = await renderAndExtractText(
      LaunchPage({ searchParams: Promise.resolve({ error: 'bogus' }) }),
    )
    expect(text).toContain('SMART launch parameters missing')
  })

  it('redirects to /api/auth/smart/authorize when iss is present', async () => {
    try {
      await LaunchPage({
        searchParams: Promise.resolve({
          iss: 'https://fhir.epic.com/foo',
          launch: 'launch-tok-1',
        }),
      })
    } catch {
      // expected — redirect throws
    }
    expect(hoisted.redirectSpy).toHaveBeenCalledTimes(1)
    const arg = hoisted.redirectSpy.mock.calls[0][0]
    expect(arg).toContain('/api/auth/smart/authorize')
    expect(arg).toContain('iss=https')
    expect(arg).toContain('launch=launch-tok-1')
  })
})
