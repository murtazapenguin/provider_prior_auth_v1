import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/smart/sessionCookie'

/**
 * Edge-runtime middleware. Cannot import Prisma / pg / node:crypto — only
 * libraries that work in both Node and Edge are safe here. `jose` (used
 * inside `verifySessionCookie`) is Edge-compatible.
 *
 * Auth decision:
 *   1. Public paths pass through.
 *   2. API routes pass through (they call `getCurrentSession()` themselves).
 *   3. For protected UI routes:
 *      - If `smart_session` HMAC verifies and exp > now + 60s → pass.
 *      - If valid but exp ≤ now + 60s → redirect to /api/auth/smart/refresh
 *        with `next=` set to the original path (Node-runtime route does DB
 *        + Epic refresh, then bounces back).
 *      - If invalid / expired / missing → check legacy demo cookie
 *        (pa_provider_id) for backward compatibility with the existing
 *        hackathon demo. If neither → redirect to /launch.
 *
 * Note: middleware cannot revoke a session row (no DB access in Edge).
 * Revocation manifests via the refresh route clearing the cookie on
 * failure; once the cookie is gone, this middleware sends the user back
 * to /launch on their next protected-route request.
 */

/**
 * Phase 6 T10 retention decision: `LEGACY_DEMO_COOKIE` is the dev-mode
 * mock-auth path. KEPT for `pnpm dev` + smoke-scenario ergonomics so the
 * existing `/demo` flow works without a full SMART launch dance every time.
 * Strictly gated by `NODE_ENV !== 'production'` (line 79 below). Production
 * deploys MUST set `NODE_ENV=production` (Vercel does this automatically);
 * the same gating pattern as T9's standalone-launch mock-mode SmartSession
 * seeding in `app/launch/standalone/actions.ts`. `phase-6-compliance` hardens
 * further — full legacy rip-out is deferred to Phase 7+ along with
 * RBAC + production HIPAA hardening. See STATUS.md.
 */
const LEGACY_DEMO_COOKIE = 'pa_provider_id'
const NEAR_EXPIRY_SECONDS = 60

const PUBLIC_PATHS = [
  '/launch',
  '/login',
  '/api/auth/smart',
  '/api/health',
  '/_dev',
  '/favicon.ico',
]

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true
  if (pathname.startsWith('/_next')) return true
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) return NextResponse.next()

  // API routes authenticate at the handler level.
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Provider UI routes require either a valid SMART session OR (for the
  // hackathon demo flow that ships pre-Epic-registration) the legacy
  // pa_provider_id cookie.
  const smartCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (smartCookie) {
    const payload = await verifySessionCookie(smartCookie)
    if (payload) {
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp - now <= NEAR_EXPIRY_SECONDS) {
        const refresh = new URL('/api/auth/smart/refresh', request.url)
        refresh.searchParams.set('next', pathname + request.nextUrl.search)
        return NextResponse.redirect(refresh)
      }
      return NextResponse.next()
    }
    // Cookie present but invalid/expired by HMAC check. Clear it and fall
    // through to the no-session branch.
    const response = redirectToLaunch(request)
    response.cookies.set({ name: SESSION_COOKIE_NAME, value: '', path: '/', maxAge: 0 })
    return response
  }

  // Legacy demo cookie support — only honoured outside production.
  const legacy = request.cookies.get(LEGACY_DEMO_COOKIE)?.value
  if (legacy && process.env.NODE_ENV !== 'production') {
    return NextResponse.next()
  }

  return redirectToLaunch(request)
}

function redirectToLaunch(request: NextRequest): NextResponse {
  // No iss to pass yet (the user wasn't launched). Send them to /login so
  // they can either run the demo flow or click through to a launch link.
  const target = new URL('/login', request.url)
  target.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(target)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
