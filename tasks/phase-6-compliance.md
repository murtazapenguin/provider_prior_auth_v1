# Phase 6 — Compliance (deferred)

> **Status:** placeholder. Created 2026-05-08 during Phase 6 foundation kickoff so that subagent work that creeps into compliance has a routing destination. Real authoring of this phase comes after Phase 6 foundation + `phase-6-epic-verification` close. **Do not work this ticket as part of Phase 6 foundation.**

## Why this is a separate phase

Phase 6 foundation is "make Epic work end-to-end." Compliance hardening (HIPAA Security Rule, encryption verification, SIEM forwarding, RBAC enforcement, retention policy, BAAs) is its own multi-week effort with different gates and a different responsible role (`security-reviewer` per ORCHESTRATION.md addendum). Bundling them risks shipping Phase 6 late and shipping compliance shallow.

## Scope (sketch — to be hardened before this ticket runs)

- **HIPAA Security Rule** technical safeguards: access control (§164.312(a)), audit controls (§164.312(b)), integrity (§164.312(c)), authentication (§164.312(d)), transmission security (§164.312(e)).
- **Encryption verification** at rest (Postgres, S3 staging bucket, page-image storage) + in transit (TLS to Epic, TLS to Bedrock, TLS to internal services). Document key management.
- **SIEM forwarding** of `PaEvent` audit log + auth events + FHIR access logs. Identify SIEM destination (Datadog / Splunk / TBD).
- **RBAC enforcement** on every API route and Server Component. Replace any "current provider" implicit access with explicit role checks. Practitioner ↔ org membership; access to PAs scoped by org.
- **Retention policy** for PHI: how long do we hold cached `Patient` / `Encounter` / `DocumentReference`? When does the audit log purge? Aligns with the BAA terms.
- **BAAs** with: Epic (covered entity), AWS (Bedrock + Textract + S3), Vercel / Railway / Supabase (whichever post-hackathon host wins), any LLM observability vendor (Langfuse if we adopt).
- **Vulnerability scans**: dependency audit (`npm audit`, `pip-audit`), secret scan (trufflehog), SAST (semgrep).
- **Penetration test** (third-party). Out of scope for in-house; contract a vendor.

## Roles

- **`security-reviewer`** subagent (ORCHESTRATION.md addendum line ~682). Activates here for the first time.
- `api-engineer` and `fhir-engineer` for RBAC enforcement and encryption-boundary code changes.
- Orchestrator inline for retention-policy decisions, BAA tracking, vendor selection.

## Tests to pass

Per `TESTING.md` "Security tests" section (line ~224 onward):
- OWASP Top 10 manual review checklist green.
- Automated scans green (or known issues triaged).
- All PHI access has a corresponding `PaEvent` audit row.
- All token / credential storage encrypted at rest.
- All transports TLS 1.2+.
- RBAC: provider A cannot read provider B's PA in a different org.

## Outputs

- `docs/compliance/hipaa-mapping.md` — § → control → implementation.
- `docs/compliance/retention-policy.md`.
- `docs/compliance/threat-model.md`.
- BAA register (filed with Legal, not in repo).
- Pen-test report from vendor (filed with Legal, not in repo).

## Dependencies

- Phase 6 foundation: complete (mock-verified + Epic-verified).
- `phase-6-epic-verification`: complete (real Epic sandbox calls verified).
- BAA execution with Epic (Vendor Services / App Orchard process — months of lead time; start in parallel with Phase 6).

## What this ticket deliberately does NOT include

- Production deploy decisions (handled separately when host is chosen).
- New product features (Phase 7+).
- Cerner / Athena / Allscripts adapters (Phase 7+).
- Real X12 / Da Vinci PAS payer integration (Phase 8).

---

## Maintenance follow-ups parked here from Phase 6 (docs-writer gate 14, 2026-05-12)

These are not in `phase-6-compliance`'s direct scope; they're parked here as the established "future Phase 6+ maintenance" lot rather than fragmenting into a new `tasks/phase-6-followups.md`. Pick them up when the responsible role next has a session in this area.

### (c) `TODO(phase-6-compliance)` RBAC gaps in the admin policy UI (T6-api)

The admin Policy publishing UI ships without role checks — any authenticated provider can view drafts and publish. Eight grep-able sites tag the gap; address them as part of this phase's RBAC enforcement work (`§164.312(a)` access control). Pre-compiled list as of Session 9:

```
app/(admin)/layout.tsx:10                                # docstring intro
app/(admin)/layout.tsx:13                                # grep instruction comment
app/(admin)/layout.tsx:24                                # gate site (the layout's auth check)
app/(admin)/policies/page.tsx:15                        # list view docstring
app/(admin)/policies/[id]/page.tsx:16                   # detail view docstring
app/(admin)/policies/[id]/publish/route.ts:27           # publish route docstring
app/(admin)/policies/[id]/publish/route.ts:103          # auth-check call site
app/(admin)/policies/[id]/publish/route.ts:145          # publisher-id audit-trail TODO
```

Regenerate the list at the time of pickup: `grep -rn "TODO(phase-6-compliance)" lib app components`.

### (i) Standardize API error-response shape

Phase 6 shipped two inconsistent error envelopes across routes:
- Legacy / domain routes return `{detail: "<message>"}` (Pydantic-style, inherited from the FastAPI sidecar pattern). Example: `app/api/pa/route.ts:20`.
- SMART / Phase 6 auth + admin routes return the canonical kit contract `{error: {code, message}}` (per `penguinai-claude-artifacts-main/.claude/contracts/error-response.md`).

Pick the canonical kit contract as the target shape, migrate legacy routes in a single api-engineer ticket (likely scope: 13+ routes under `app/api/pa/`, `app/api/encounters/`, the cron sweep, the simulator webhook). Update the corresponding contract validation in `scripts/validate-contracts.ts` so the migration is fenced. This is **not a security finding** — surfaced here because the touch set overlaps the RBAC work and the two changes are cheaper to test together.

### (p) Override route premature-transition bug (real code bug, not a doc drift)

`app/api/pa/[id]/criteria/[cid]/override/route.ts:86-101` computes "are all criteria passed" via `await prisma.criterionResult.findMany({where: {priorAuthId: id}, distinct: ['criterionId']})` and checks `allResults.every(r => r.status === 'passed')`. **It counts CriterionResult rows, not the underlying `policy.criteria.length`.** For a PA with no prior `recheck` (so no rows exist yet), the FIRST override creates exactly 1 passed row, `allResults.length === 1`, `every(passed)` returns true vacuously, and the PA prematurely transitions `draft → ready_for_submission`.

Recommended fix (api-engineer, ~10 lines):
```ts
const policy = await prisma.policy.findUnique({
  where: { id: pa.policyId },
  include: { criteria: true },
})
const criteriaCount = policy?.criteria.length ?? 0
const allPassed =
  criteriaCount > 0 &&
  allResults.length === criteriaCount &&
  allResults.every((r) => r.status === 'passed')
```

Add a regression test: PA with N criteria, exactly 1 override → status stays `draft` (it should), N overrides → status walks to `ready_for_submission`. DO NOT fix in Phase 6 docs-writer scope — it's an api-engineer code change that wants its own ticket + smoke walk.

### (q) `Policy.pageImages` is NULL for all 6 seeded policies

STATUS.md line ~41 ("Botox policy PDFViewer data (28 PNGs) verified") is a half-truth and is being softened in Session 9. The 28 PNGs exist on disk at `public/policy-pdfs/policy-uhc-botox-chronic-migraine/page_*.png` (and analogous paths for the other 5 hand-curated policies), but the canonical `pdfviewer-data` JSON (per the kit contract `pdfviewer-data.md`) is NOT written into the `Policy.pageImages` Json column — `SELECT id, pageImages IS NULL FROM "Policy"` returns `t` for every row.

Today this is mostly cosmetic — the citation viewer hits the policy PDF via the PNG paths directly through `DocumentPdfViewer`'s page-image loader. But if a future ticket introduces a code path that reads `Policy.pageImages` (e.g. a "PDF was reingested, the on-disk PNGs are now stale" eviction check), it will encounter NULL and fall over. Fix: add a `populatePolicyPageImages()` seed step that walks each hand-curated policy's PNG directory and writes the canonical `{files: [{filename, page, dimensions}], presigned_urls: {...}}` shape into the column. ~15 LOC; can be a seed-only change with no migration.

### (r) Missing canned-fallback entries for the Power Wheelchair scenario

`lib/ai/cannedResponses.ts` has `extract:` / `derive:` / `packet:` entries keyed by `encounter-head-ct`, `encounter-knee-mri`, and `encounter-botox`. There are **NO entries** keyed by `encounter-power-wheelchair` (the 4th demo encounter introduced in Phase 6 fixture work). Behavior with the AI sidecar **up**: recheck + submission packet succeed via Bedrock. Behavior with the AI sidecar **down** (`AiUnreachableError` thrown): the canned-fallback map throws (per the file's "Rule: If a key is not in the map, throw"), so recheck + submission-packet routes 500.

Two acceptable resolutions; pick one:
1. **Add canned entries** for `encounter-power-wheelchair` — clones the existing 3-scenario template, ~50 LOC, no architectural change. Most consistent with the demo-readiness ethos.
2. **Document PWC as override-only-by-design** in `DEMO_SCENARIOS.md` — the scenario already showcases the manual-override path; pre-record that automated AI extraction is intentionally not exercised. ~5 LOC doc change, zero code change.

Either way, the canned-fallback drill that Phase 3 verified should be re-run after the fix lands: `kill uvicorn → run scenario 4 → confirm graceful behavior, no 500`.
