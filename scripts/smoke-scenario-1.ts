/**
 * Smoke test: Head CT scenario (Scenario 1) — happy path end-to-end.
 *
 * Runs against a live Next.js dev server at BASE_URL (default http://localhost:3000).
 * Seed data must already be loaded (pnpm db:seed).
 *
 * Expected flow:
 *   POST /api/encounters (load encounter-head-ct)
 *   POST /api/pa         (create PA → draft)
 *   POST /api/pa/:id/recheck (canned AI → all_passed → ready_for_submission)
 *   POST /api/pa/:id/submit  (→ pending)
 *   POST /api/cron/sweep (tick × N until approved, max 15s)
 *   GET  /api/pa/:id     (verify events present)
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const CRON_SECRET = process.env.CRON_SECRET ?? ''

async function api<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(path.includes('/cron/') ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  return json as T
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`)
}

async function main() {
  console.log('▶  Smoke scenario 1 — Head CT (happy path)')
  const start = Date.now()

  // 1. Load encounter
  const encounter = await api<{ id: string }>('POST', '/api/encounters', {
    encounterId: 'encounter-head-ct',
  })
  assert(encounter.id === 'encounter-head-ct', 'encounter id mismatch')
  console.log('  ✓ encounter loaded')

  // 2. Create PA
  const pa = await api<{ id: string; status: string }>('POST', '/api/pa', {
    encounterId: 'encounter-head-ct',
  })
  assert(pa.status === 'draft', `expected draft, got ${pa.status}`)
  const paId = pa.id
  console.log(`  ✓ PA created (${paId}) → draft`)

  // 3. Add primary code so match engine can find the policy
  await api('POST', `/api/pa/${paId}/codes`, {
    codes: [
      {
        codeType: 'CPT',
        code: '70450',
        description: 'CT head/brain without contrast',
        isPrimary: true,
        derivedBy: 'provider',
        confidence: 1.0,
      },
    ],
  })
  console.log('  ✓ codes set (CPT 70450)')

  // 4. Recheck — canned AI returns all_passed → ready_for_submission
  const recheck = await api<{ pa: { status: string }; matchResult: { overallStatus: string } }>(
    'POST',
    `/api/pa/${paId}/recheck`
  )
  assert(recheck.matchResult.overallStatus === 'all_passed', `expected all_passed, got ${recheck.matchResult.overallStatus}`)
  assert(recheck.pa.status === 'ready_for_submission', `expected ready_for_submission, got ${recheck.pa.status}`)
  console.log('  ✓ recheck → all_passed → ready_for_submission')

  // 5. Submit → pending
  const submitted = await api<{ status: string }>('POST', `/api/pa/${paId}/submit`)
  assert(submitted.status === 'pending', `expected pending, got ${submitted.status}`)
  console.log('  ✓ submitted → pending')

  // 6. Fast-forward simulator until approved (each call advances all in-flight PAs one step)
  let finalStatus = 'pending'
  const maxFastForwards = 5

  for (let i = 0; i < maxFastForwards; i++) {
    await api('POST', '/api/simulator/fast-forward')
    const current = await api<{ status: string }>('GET', `/api/pa/${paId}`)
    finalStatus = current.status
    if (finalStatus === 'approved') break
    process.stdout.write('.')
  }
  if (finalStatus !== 'approved') console.log()

  assert(finalStatus === 'approved', `expected approved after fast-forwarding, got ${finalStatus}`)
  console.log('  ✓ simulator fast-forwarded → approved')

  // 7. Verify audit trail
  const detail = await api<{ events: Array<{ type: string; fromStatus?: string; toStatus?: string }> }>(
    'GET',
    `/api/pa/${paId}`
  )
  const statusChanges = detail.events.filter((e) => e.type === 'status_change')
  assert(statusChanges.length >= 3, `expected ≥3 status_change events, got ${statusChanges.length}`)
  console.log(`  ✓ audit trail has ${statusChanges.length} status_change events`)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✅ Smoke scenario 1 passed — Head CT → approved in ${elapsed}s`)
}

main().catch((err) => {
  console.error('\n❌ Smoke scenario 1 FAILED:', err.message)
  process.exit(1)
})
