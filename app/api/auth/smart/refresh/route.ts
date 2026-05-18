/**
 * app/api/auth/smart/refresh/route.ts
 *
 * POST /api/auth/smart/refresh
 *
 * Refreshes the current SmartSession against Epic's token endpoint and
 * re-signs the cookie with the new expiry. On failure (refresh token
 * revoked, Epic 5xx), revokes the session and clears the cookie.
 *
 * GET is also accepted so middleware can redirect to it on near-expiry —
 * the route then bounces back to the original destination via the `?next=`
 * query.
 */

import { NextResponse } from 'next/server'
import { refreshSession, revokeSession } from '@/lib/smart/session'
import {
  SESSION_COOKIE_NAME,
  signSessionCookie,
  verifySessionCookie,
} from '@/lib/smart/sessionCookie'

export const runtime = 'nodejs'

async function handle(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const next = url.searchParams.get('next') ?? '/queue'

  // Pull session cookie out of the request headers.
  const cookieValue =
    (request.headers.get('cookie') ?? '')
      .split(/;\s*/)
      .map((c) => c.split('='))
      .find(([k]) => k === SESSION_COOKIE_NAME)?.[1]

  const payload = await verifySessionCookie(cookieValue)
  if (!payload) {
    return jsonOrRedirect(request, { ok: false, reason: 'no_session' }, '/login')
  }

  const refreshed = await refreshSession(payload.sessionToken)
  if (!refreshed) {
    await revokeSession(payload.sessionToken)
    const response = jsonOrRedirect(request, { ok: false, reason: 'refresh_failed' }, '/login')
    response.cookies.set({ name: SESSION_COOKIE_NAME, value: '', path: '/', maxAge: 0 })
    return response
  }

  const newCookie = await signSessionCookie({
    sessionToken: refreshed.sessionToken,
    expiresAtMs: refreshed.expiresAt.getTime(),
  })

  const response = jsonOrRedirect(
    request,
    { ok: true, expiresAt: refreshed.expiresAt.toISOString() },
    next.startsWith('/') ? next : '/queue',
  )
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: newCookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: refreshed.expiresAt,
  })
  return response
}

/**
 * GET (from a browser redirect) → 302 to `next`. POST (from fetch) → JSON.
 */
function jsonOrRedirect(
  request: Request,
  json: Record<string, unknown>,
  redirectPath: string,
): NextResponse {
  if (request.method === 'GET') {
    return NextResponse.redirect(new URL(redirectPath, request.url))
  }
  return NextResponse.json(json, { status: json.ok ? 200 : 401 })
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request)
}
