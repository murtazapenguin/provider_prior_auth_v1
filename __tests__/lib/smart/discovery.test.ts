/**
 * __tests__/lib/smart/discovery.test.ts
 *
 * SMART discovery fetch + 24h cache + zod validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import smartConfigFixture from '../../fixtures/smart/smart-configuration.json'
import {
  _clearDiscoveryCache,
  _peekDiscoveryCache,
  getSmartConfiguration,
} from '@/lib/smart/discovery'
import { jsonResponse, errorResponse } from './_testEnv'

const ISS = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'

describe('getSmartConfiguration', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    _clearDiscoveryCache()
    fetchSpy = vi.fn(async () => jsonResponse(smartConfigFixture))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    _clearDiscoveryCache()
    vi.useRealTimers()
  })

  it('fetches /.well-known/smart-configuration from the iss and validates', async () => {
    const config = await getSmartConfiguration(ISS)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [calledUrl] = fetchSpy.mock.calls[0] as [string]
    expect(calledUrl).toBe(`${ISS}/.well-known/smart-configuration`)
    expect(config.authorization_endpoint).toBe(smartConfigFixture.authorization_endpoint)
    expect(config.token_endpoint).toBe(smartConfigFixture.token_endpoint)
  })

  it('strips trailing slash on iss before forming discovery URL', async () => {
    await getSmartConfiguration(ISS + '/')
    const [calledUrl] = fetchSpy.mock.calls[0] as [string]
    expect(calledUrl).toBe(`${ISS}/.well-known/smart-configuration`)
  })

  it('caches the result — second call within 24h does not refetch', async () => {
    await getSmartConfiguration(ISS)
    await getSmartConfiguration(ISS)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('cache expires after 24 hours', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await getSmartConfiguration(ISS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // 23h59m — still cached
    vi.setSystemTime(new Date('2026-01-01T23:59:00Z'))
    await getSmartConfiguration(ISS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // 24h01m — refetch
    vi.setSystemTime(new Date('2026-01-02T00:01:00Z'))
    await getSmartConfiguration(ISS)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws SmartLaunchError on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(500, { error: 'server_error' }))
    await expect(getSmartConfiguration(ISS)).rejects.toThrow(/discovery/i)
  })

  it('throws on schema validation failure (e.g. missing authorization_endpoint)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ token_endpoint: 'https://foo' }))
    await expect(getSmartConfiguration(ISS)).rejects.toThrow(/discovery/i)
  })

  it('exposes a peek helper for cache state', async () => {
    await getSmartConfiguration(ISS)
    const peeked = _peekDiscoveryCache(ISS)
    expect(peeked?.config.token_endpoint).toBe(smartConfigFixture.token_endpoint)
  })
})
