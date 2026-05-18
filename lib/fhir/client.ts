/**
 * lib/fhir/client.ts
 *
 * Node-runtime FHIR HTTP client.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  Node runtime ONLY. This module is reachable from route handlers,  │
 *   │  server actions, and the AI service. NEVER import from a Server    │
 *   │  Component (FHIR call volume would explode) or from middleware     │
 *   │  (Edge runtime, no Prisma/Node crypto).                            │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Behavior:
 *  - Loads the current SMART session via `getCurrentSession()` from
 *    `lib/smart/session.ts`. Attaches `Authorization: Bearer <token>` and
 *    `Accept: application/fhir+json`.
 *  - On 401, calls `refreshSession()` once (silent rotation) and retries
 *    with the new token. A second 401 — or a failed/null refresh — throws
 *    `SmartSessionExpiredError`. `refreshSession()` revokes the underlying
 *    row on its own failure path, so the next request hits middleware with
 *    an invalid cookie and gets redirected to `/launch`.
 *  - On 429/503, retries with exponential backoff (max 3 attempts).
 *    Honors a numeric `Retry-After` header when present.
 *  - On other HTTP error, throws `FhirRequestError` with the status and
 *    redacted error message (never echoes the bearer token).
 *  - Search results paginate via `Bundle.link[relation='next'].url`. The
 *    next-page URL is absolute (Epic returns continuation tokens baked in)
 *    and follows the same auth/refresh/backoff path — including 401 mid-
 *    pagination.
 *
 * The public functions accept an optional `fetchImpl` / `sessionLoader` /
 * `refresher` for test injection (same pattern as `lib/smart/tokenExchange.ts`).
 */

import type { ZodType, ZodTypeAny } from 'zod'
import { BundleSchema } from './types'

/* ───────────────────────────────────────────────────────────────────────────
 *  Errors
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Thrown when Epic returns 401 after the silent-refresh retry path has been
 * exhausted. Callers (route handlers / server actions) should catch this and
 * return a 401 response to the client; T1's middleware redirects the user to
 * `/launch` on the subsequent navigation because the session row is revoked.
 */
export class SmartSessionExpiredError extends Error {
  public readonly code = 'smart_session_expired'
  constructor(message: string = 'SMART session expired and could not be refreshed') {
    super(message)
    this.name = 'SmartSessionExpiredError'
  }
}

export type FhirRequestErrorCode =
  | 'fhir_request_failed'
  | 'fhir_rate_limited'
  | 'fhir_validation_failed'
  | 'fhir_no_session'

export class FhirRequestError extends Error {
  public readonly code: FhirRequestErrorCode
  public readonly status?: number
  public readonly resourceType?: string
  public readonly details?: Record<string, unknown>

  constructor(opts: {
    code: FhirRequestErrorCode
    message: string
    status?: number
    resourceType?: string
    details?: Record<string, unknown>
  }) {
    super(opts.message)
    this.name = 'FhirRequestError'
    this.code = opts.code
    this.status = opts.status
    this.resourceType = opts.resourceType
    this.details = opts.details
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Public types
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The shape of a SMART session that `client.ts` actually consumes. A subset
 * of `SmartSessionData` from `lib/smart/types.ts`. Tests pass a minimal
 * fixture instead of standing up the encrypted-token machinery.
 */
export interface SmartSessionLike {
  sessionToken: string
  accessToken: string
  iss: string
  expiresAt: Date
}

/** Async loader for the current request's session. */
export type SessionLoader = () => Promise<SmartSessionLike | null>

/** Async function that performs a single silent refresh. */
export type SessionRefresher = (sessionToken: string) => Promise<SmartSessionLike | null>

/** Common knobs for every public adapter call. */
export interface FhirCallOpts {
  fetchImpl?: typeof fetch
  sessionLoader?: SessionLoader
  refresher?: SessionRefresher
  /** Returns the milliseconds to sleep before attempt N (1-indexed). */
  backoffMs?: (attempt: number) => number
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Internals
 * ───────────────────────────────────────────────────────────────────────── */

const MAX_BACKOFF_ATTEMPTS = 3

/** Default backoff schedule: 250ms, 500ms, 1000ms. */
function defaultBackoffMs(attempt: number): number {
  // attempt = 1 → 250, 2 → 500, 3 → 1000
  return 250 * Math.pow(2, attempt - 1)
}

/**
 * Compose the resource URL. iss is the FHIR base; we strip trailing slashes so
 * the join has exactly one `/`. id is path-escaped to defend against caller
 * accidents (FHIR ids are pure ASCII but defensive coding is cheap).
 */
function buildResourceUrl(iss: string, resourceType: string, id?: string): string {
  const trimmed = iss.replace(/\/+$/, '')
  if (id === undefined) return `${trimmed}/${resourceType}`
  return `${trimmed}/${resourceType}/${encodeURIComponent(id)}`
}

/**
 * Compose a search URL. URLSearchParams encodes `/` as `%2F`, which Epic
 * accepts for params like `?patient=Patient%2Fabc`.
 */
function buildSearchUrl(
  iss: string,
  resourceType: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const trimmed = iss.replace(/\/+$/, '')
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, v)
    } else {
      sp.append(key, value)
    }
  }
  const qs = sp.toString()
  return qs ? `${trimmed}/${resourceType}?${qs}` : `${trimmed}/${resourceType}`
}

/** Redact `Bearer xxx` tokens before they land in error messages or logs. */
export function redactToken(input: string): string {
  return input.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]')
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse Retry-After header. Per RFC 7231 it's either a delta-seconds integer
 * or an HTTP-date; we only honor the integer form. Returns ms or undefined.
 */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined
  const trimmed = headerValue.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const seconds = parseInt(trimmed, 10)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return seconds * 1000
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Lazy session-module imports
 *
 *  We `require` these at call time (not at module load) so unit tests that
 *  inject `sessionLoader` / `refresher` never trigger the real Prisma-backed
 *  module's side effects.
 * ───────────────────────────────────────────────────────────────────────── */

async function defaultSessionLoader(): Promise<SmartSessionLike | null> {
  const mod = await import('@/lib/smart/session')
  const session = await mod.getCurrentSession()
  if (!session) return null
  return {
    sessionToken: session.sessionToken,
    accessToken: session.accessToken,
    iss: session.iss,
    expiresAt: session.expiresAt,
  }
}

async function defaultRefresher(sessionToken: string): Promise<SmartSessionLike | null> {
  const mod = await import('@/lib/smart/session')
  const refreshed = await mod.refreshSession(sessionToken)
  if (!refreshed) return null
  return {
    sessionToken: refreshed.sessionToken,
    accessToken: refreshed.accessToken,
    iss: refreshed.iss,
    expiresAt: refreshed.expiresAt,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Core request driver
 *
 *  Handles auth attachment, 401-with-refresh, 429/503 backoff, and error
 *  surfacing. Returns the raw Response (parsed by callers).
 *
 *  Auth retry policy:
 *    attempt 1 → 401 → refresh → attempt 2 → 401 ⇒ SmartSessionExpiredError
 *    attempt 1 → 401 → refresh returns null     ⇒ SmartSessionExpiredError
 *
 *  Rate-limit retry policy (counts as backoff attempts):
 *    up to MAX_BACKOFF_ATTEMPTS attempts; on the Nth still-429/503 we throw
 *    FhirRequestError(code='fhir_rate_limited').
 *
 *  Note: 401 retry and 429/503 retry are independent — a 429 doesn't consume
 *  the auth-refresh allowance, and a 401 doesn't consume the rate-limit
 *  allowance. This mirrors how Epic's quirks compose in practice.
 * ───────────────────────────────────────────────────────────────────────── */

interface DriveOpts {
  resourceType: string
  /** When set, the driver uses this URL directly (used for next-page hops). */
  absoluteUrl?: string
  /** Otherwise the driver composes from iss + path. */
  pathParts?: { id?: string; search?: Record<string, string | string[] | undefined> }
  /** Headers to merge in (Accept etc.). */
  accept: string
  fetchImpl: typeof fetch
  sessionLoader: SessionLoader
  refresher: SessionRefresher
  backoffMs: (attempt: number) => number
}

interface AuthAttempt {
  session: SmartSessionLike
  /** True after we've consumed our one refresh attempt. */
  refreshed: boolean
}

async function loadInitialSession(loader: SessionLoader, resourceType: string): Promise<SmartSessionLike> {
  const session = await loader()
  if (!session) {
    throw new FhirRequestError({
      code: 'fhir_no_session',
      message: 'No active SMART session — caller must launch via /launch first',
      resourceType,
    })
  }
  return session
}

async function executeRequest(opts: DriveOpts): Promise<Response> {
  let attempt: AuthAttempt = {
    session: await loadInitialSession(opts.sessionLoader, opts.resourceType),
    refreshed: false,
  }

  // Outer loop is bounded by MAX_BACKOFF_ATTEMPTS for 429/503; auth retry is
  // a one-shot that happens inside the outer iteration.
  let lastResponse: Response | undefined

  for (let backoffAttempt = 1; backoffAttempt <= MAX_BACKOFF_ATTEMPTS; backoffAttempt++) {
    const url = opts.absoluteUrl ?? buildUrl(attempt.session.iss, opts)
    const init: RequestInit = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${attempt.session.accessToken}`,
        Accept: opts.accept,
      },
    }

    let response: Response
    try {
      response = await opts.fetchImpl(url, init)
    } catch (err) {
      throw new FhirRequestError({
        code: 'fhir_request_failed',
        message: `FHIR ${opts.resourceType} request transport error: ${redactToken(
          err instanceof Error ? err.message : String(err),
        )}`,
        resourceType: opts.resourceType,
      })
    }

    if (response.status === 401) {
      if (attempt.refreshed) {
        // Already used our one refresh; this is the second 401 in a row.
        throw new SmartSessionExpiredError()
      }
      const refreshed = await opts.refresher(attempt.session.sessionToken)
      if (!refreshed) {
        throw new SmartSessionExpiredError()
      }
      attempt = { session: refreshed, refreshed: true }
      // Re-enter the loop without consuming a backoff slot.
      backoffAttempt -= 1
      continue
    }

    if (response.status === 429 || response.status === 503) {
      lastResponse = response
      if (backoffAttempt >= MAX_BACKOFF_ATTEMPTS) break
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
      const waitMs = retryAfterMs ?? opts.backoffMs(backoffAttempt)
      await sleep(waitMs)
      continue
    }

    if (!response.ok) {
      const bodyText = await safeReadText(response)
      throw new FhirRequestError({
        code: 'fhir_request_failed',
        message: `FHIR ${opts.resourceType} ${response.status}`,
        status: response.status,
        resourceType: opts.resourceType,
        details: { body: redactToken(bodyText).slice(0, 500) },
      })
    }

    return response
  }

  // Exhausted backoff
  throw new FhirRequestError({
    code: 'fhir_rate_limited',
    message: `FHIR ${opts.resourceType} rate-limited (${lastResponse?.status ?? '429'}) after ${MAX_BACKOFF_ATTEMPTS} attempts`,
    status: lastResponse?.status,
    resourceType: opts.resourceType,
  })
}

function buildUrl(iss: string, opts: DriveOpts): string {
  const parts = opts.pathParts ?? {}
  if (parts.search) return buildSearchUrl(iss, opts.resourceType, parts.search)
  return buildResourceUrl(iss, opts.resourceType, parts.id)
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Public API
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Read a single FHIR resource by id. The response is parsed as JSON and
 * validated against `schema`; the typed object is returned. Validation
 * failures throw `FhirRequestError(code='fhir_validation_failed')`.
 */
export async function fhirGet<T>(opts: {
  resourceType: string
  id: string
  schema: ZodType<T>
  fetchImpl?: typeof fetch
  sessionLoader?: SessionLoader
  refresher?: SessionRefresher
  backoffMs?: (attempt: number) => number
}): Promise<T> {
  const driveOpts: DriveOpts = {
    resourceType: opts.resourceType,
    pathParts: { id: opts.id },
    accept: 'application/fhir+json',
    fetchImpl: opts.fetchImpl ?? fetch,
    sessionLoader: opts.sessionLoader ?? defaultSessionLoader,
    refresher: opts.refresher ?? defaultRefresher,
    backoffMs: opts.backoffMs ?? defaultBackoffMs,
  }

  const response = await executeRequest(driveOpts)
  const json = await response.json().catch((err) => {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `FHIR ${opts.resourceType} response was not JSON`,
      resourceType: opts.resourceType,
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  })

  const parsed = opts.schema.safeParse(json)
  if (!parsed.success) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `FHIR ${opts.resourceType} response failed schema validation`,
      resourceType: opts.resourceType,
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data as T
}

/**
 * Search a FHIR resource type and return all matching entries across every
 * page in the bundle. Pagination follows `Bundle.link[relation='next'].url`
 * (absolute, with Epic continuation tokens baked in) — and the next-page
 * hop re-enters the same auth/refresh/backoff path so a mid-pagination 401
 * gets handled identically to a first-page 401.
 */
export async function fhirSearch<TEntry>(opts: {
  resourceType: string
  searchParams: Record<string, string | string[] | undefined>
  entrySchema: ZodType<TEntry>
  fetchImpl?: typeof fetch
  sessionLoader?: SessionLoader
  refresher?: SessionRefresher
  backoffMs?: (attempt: number) => number
}): Promise<TEntry[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sessionLoader = opts.sessionLoader ?? defaultSessionLoader
  const refresher = opts.refresher ?? defaultRefresher
  const backoffMs = opts.backoffMs ?? defaultBackoffMs

  const bundleSchema = BundleSchema(opts.entrySchema)

  const collected: TEntry[] = []
  let nextUrl: string | undefined

  // First-page request
  const firstDriveOpts: DriveOpts = {
    resourceType: opts.resourceType,
    pathParts: { search: opts.searchParams },
    accept: 'application/fhir+json',
    fetchImpl,
    sessionLoader,
    refresher,
    backoffMs,
  }

  let response = await executeRequest(firstDriveOpts)
  let bundle = await parseBundle<TEntry>(response, opts.resourceType, bundleSchema)
  for (const entry of bundle.entry ?? []) collected.push(entry.resource as TEntry)
  nextUrl = findNextLink(bundle)

  while (nextUrl) {
    const pageDriveOpts: DriveOpts = {
      resourceType: opts.resourceType,
      absoluteUrl: nextUrl,
      accept: 'application/fhir+json',
      fetchImpl,
      sessionLoader,
      refresher,
      backoffMs,
    }
    response = await executeRequest(pageDriveOpts)
    bundle = await parseBundle<TEntry>(response, opts.resourceType, bundleSchema)
    for (const entry of bundle.entry ?? []) collected.push(entry.resource as TEntry)
    nextUrl = findNextLink(bundle)
  }

  return collected
}

async function parseBundle<TEntry>(
  response: Response,
  resourceType: string,
  bundleSchema: ZodTypeAny,
): Promise<{ entry?: Array<{ resource: TEntry }>; link?: Array<{ relation: string; url: string }> }> {
  const json = await response.json().catch((err) => {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `FHIR ${resourceType} bundle was not JSON`,
      resourceType,
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  })
  const parsed = bundleSchema.safeParse(json)
  if (!parsed.success) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `FHIR ${resourceType} bundle failed schema validation`,
      resourceType,
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data as { entry?: Array<{ resource: TEntry }>; link?: Array<{ relation: string; url: string }> }
}

function findNextLink(bundle: { link?: Array<{ relation: string; url: string }> }): string | undefined {
  return bundle.link?.find((l) => l.relation === 'next')?.url
}

/**
 * Fetch a Binary resource as raw bytes. Epic returns base64 in the JSON
 * `data` field by default — we pass `Accept: application/octet-stream` to
 * get raw bytes back, which is what we want for PDFs and other content
 * destined for OCR / packet assembly.
 */
export async function fhirFetchBinary(opts: {
  url: string
  fetchImpl?: typeof fetch
  sessionLoader?: SessionLoader
  refresher?: SessionRefresher
  backoffMs?: (attempt: number) => number
}): Promise<Buffer> {
  const driveOpts: DriveOpts = {
    resourceType: 'Binary',
    absoluteUrl: opts.url,
    accept: 'application/octet-stream',
    fetchImpl: opts.fetchImpl ?? fetch,
    sessionLoader: opts.sessionLoader ?? defaultSessionLoader,
    refresher: opts.refresher ?? defaultRefresher,
    backoffMs: opts.backoffMs ?? defaultBackoffMs,
  }
  const response = await executeRequest(driveOpts)
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Test-only helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Exposed for unit tests. */
export const _internals = {
  buildResourceUrl,
  buildSearchUrl,
  parseRetryAfterMs,
  defaultBackoffMs,
}
