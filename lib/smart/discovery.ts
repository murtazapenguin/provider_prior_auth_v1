/**
 * lib/smart/discovery.ts
 *
 * Fetches `/.well-known/smart-configuration` from the FHIR issuer (iss),
 * validates the response against the zod schema, caches per-iss for 24 h.
 *
 * Spec: https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html
 *
 * In-process Map cache. Survives across requests within a single Node
 * worker. Doesn't survive deploys, which is fine — discovery is cheap.
 */

import { SmartConfigurationSchema, SmartLaunchError, type SmartConfiguration } from './types'

const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CacheEntry {
  config: SmartConfiguration
  fetchedAt: number
}

const _cache = new Map<string, CacheEntry>()

/**
 * Builds the discovery URL for an issuer. Epic publishes at:
 *   <iss>/.well-known/smart-configuration
 * Strips any trailing slash on iss so the resulting URL has exactly one
 * separator.
 */
function discoveryUrlFor(iss: string): string {
  const trimmed = iss.replace(/\/+$/, '')
  return `${trimmed}/.well-known/smart-configuration`
}

/**
 * Fetches and caches the SMART discovery document for an issuer.
 * Throws `SmartLaunchError({ code: 'discovery_failed' })` on HTTP error
 * or zod validation failure.
 */
export async function getSmartConfiguration(iss: string): Promise<SmartConfiguration> {
  const cached = _cache.get(iss)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.config
  }

  const url = discoveryUrlFor(iss)
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    throw new SmartLaunchError({
      code: 'discovery_failed',
      message: `SMART discovery fetch failed for iss ${iss}`,
      details: { iss, cause: err instanceof Error ? err.message : String(err) },
    })
  }

  if (!response.ok) {
    throw new SmartLaunchError({
      code: 'discovery_failed',
      message: `SMART discovery returned ${response.status} for iss ${iss}`,
      details: { iss, status: response.status },
    })
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    throw new SmartLaunchError({
      code: 'discovery_failed',
      message: 'SMART discovery response was not JSON',
      details: { iss, cause: err instanceof Error ? err.message : String(err) },
    })
  }

  const parsed = SmartConfigurationSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SmartLaunchError({
      code: 'discovery_failed',
      message: 'SMART discovery response failed schema validation',
      details: { iss, issues: parsed.error.issues },
    })
  }

  _cache.set(iss, { config: parsed.data, fetchedAt: Date.now() })
  return parsed.data
}

/**
 * Test-only helper: drops the in-memory discovery cache.
 * Tests asserting "second call is cached" must call this between cases
 * to avoid cross-test contamination.
 */
export function _clearDiscoveryCache(): void {
  _cache.clear()
}

/**
 * Test-only helper: peek at the cache so tests can assert hit-vs-miss.
 */
export function _peekDiscoveryCache(iss: string): { config: SmartConfiguration; fetchedAt: number } | undefined {
  return _cache.get(iss)
}
