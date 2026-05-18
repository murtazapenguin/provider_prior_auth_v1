# Testing Strategy

The full testing playbook for Phase 6+ work — what every subagent is expected to run, what passing looks like, and how the orchestrator's gate evaluates them.

This doc is **prescriptive, not aspirational**. Every check listed here is a hard gate: a subagent does not declare done until the relevant tests run green. The integration-tester subagent (per `ORCHESTRATION.md`) verifies these at every phase boundary.

---

## Testing pyramid (from cheap to expensive)

| Layer | Tooling | When run | Owner | Gate |
|---|---|---|---|---|
| Unit | Vitest (TS), pytest (Py) | Per file save / pre-commit | Implementing agent | Per-ticket |
| Contract | Vitest + zod schema validation | After code change touches an interface | Implementing agent | Per-ticket |
| Integration | Vitest + supertest (TS), pytest + httpx (Py) | After phase-section completes | Implementing agent | Per-ticket |
| Cross-phase contract | integration-tester subagent | After every phase boundary | Orchestrator (auto-spawn) | Phase exit |
| AI quality / eval | Penguin `evals` module | After AI ticket lands | ai-engineer | Per-ticket + nightly |
| E2E browser | Playwright MCP | Phase 5 + Phase 6 polish phases | quality-tester subagent | Phase 5/6 exit |
| Workflow walks | Playwright MCP per `WORKFLOWS.md` | Phase 6+ exit | quality-tester | Phase exit |
| Performance | k6 / Artillery + custom harness | Phase 6+ | performance-engineer (Phase 7+) | Phase exit |
| Accessibility | axe-core + manual screen reader | Phase 5+ polish | qa-engineer | Phase exit |
| Security | Manual + automated; depends on phase | Phase 6-compliance | security-reviewer | `phase-6-compliance` exit |

A subagent's "Definition of Done" must include the layer(s) appropriate to their ticket. The integration-tester verifies cross-phase concerns; individual subagents own everything else.

---

## Per-agent test gates

Every subagent's "When done" report includes the relevant block below. **No green tests = ticket not done.**

### software-engineer / api-engineer / ui-engineer / fhir-engineer

Before declaring done:

```bash
# Unit
pnpm test                                              # or pytest in services/ai/
# Type check
pnpm tsc --noEmit
# Lint
pnpm lint
# Build verifies
pnpm build                                             # for UI tickets
# Contract validation (per the kit's contracts under
#  penguinai-claude-artifacts-main/.claude/contracts/)
pnpm tsx scripts/validate-contracts.ts --phase 6      # introduced Phase 6
```

Plus the ticket-specific tests defined in the Phase ticket file's "Tests must verify" block. If the ticket doesn't define tests, the subagent writes them as part of the work.

### ai-engineer

Adds:

```bash
# AI quality eval — uses penguin.evals (see "AI quality" section below)
cd services/ai && python -m pytest -m eval         # eval-tagged tests
# Cost telemetry — log token consumption per call; verify within budget
python services/ai/scripts/cost_report.py --since 1h
# Faithfulness validation — every citation supporting_text appears verbatim in source
python services/ai/scripts/validate_citations.py --pa <id>
```

### qa-engineer / quality-tester

Adds:

```bash
# Browser E2E via Playwright MCP — drives the live UI through every relevant
# WORKFLOWS.md scenario. Each scenario reports PASS/FAIL with TC-ID.
pnpm e2e:phase6          # script defined per phase

# Accessibility on every changed screen
pnpm a11y:scan           # axe-core via Playwright

# Visual regression (Phase 5+ added)
pnpm test:visual         # screenshot diff against baselines
```

### integration-tester

Per `ORCHESTRATION.md`, runs at every phase boundary. Specific checks per phase listed in each `tasks/phase-N-*.md` exit checklist's Step 2.

### docs-writer

```bash
# Verify links resolve in every doc
pnpm tsx scripts/check-doc-links.ts
# Verify no stale cross-references (e.g. "Phase 4" sections that moved)
pnpm tsx scripts/check-doc-coherence.ts
```

### security-reviewer (Phase 6-compliance)

```bash
# Dependency audit
pnpm audit --audit-level=moderate
pip-audit --requirement services/ai/requirements.txt
# Static analysis
pnpm semgrep --config=auto
# Secret scan
trufflehog filesystem . --no-update --fail
# OWASP top-10 manual checklist (see phase-6-compliance.md)
```

---

## What each test layer covers

### Unit tests

Per module, against pure-logic functions. Fast (<1s per test). No I/O.

Required coverage thresholds (enforced by Vitest config):
- `lib/statusMachine/` — 100% branch coverage (state transitions are tabulated; missing one is a bug)
- `lib/policies/matchEngine.ts` — 95%
- `lib/fhir/*` — 90% (mappers, parsers); 80% (HTTP client — some retry paths hard to unit test)
- `services/ai/` — 80% (a lot of LLM-call paths get tested via integration; that's fine)
- Everything else — 70% baseline

Subagents that drop coverage below threshold get blocked at the integration-tester gate.

### Contract tests

Validate that data flowing between modules matches the canonical contracts under `penguinai-claude-artifacts-main/.claude/contracts/`. Critical contracts we enforce:

| Contract | What it constrains | Where it's validated |
|---|---|---|
| `bbox-format` | 8-point normalized arrays, integer page_number, document_name matches files[] | All Citation rows + AI service responses + FHIR-doc OCR output |
| `evidence-citation` | supporting_texts/reasoning/confidence/bboxes shape | AI service `/extract-evidence-criterion` response, `Citation` rows, API response from `/api/pa/{id}` |
| `pdfviewer-data` | files[] + presigned_urls{filename}{page} structure | API responses for any PDF rendering — clinical docs + policy docs + submission packets |
| `extraction-result` | Generic AI extraction wrapper | All AI task responses |
| `auth-response` (Phase 6) | Authenticated-session establishment. As of Phase 6 Session 9, this is enforced as a **cookie + redirect** flow, not a JSON-body response: `/api/auth/smart/callback` and `/launch/standalone` (mock mode) set an HMAC-signed `pa_session` cookie carrying the `SmartSession.sessionToken` and 302 to the destination computed by `lib/smart/postLaunchRouting.ts`. The old JSON-body mock route `/api/auth/login-as-demo-provider` (and `lib/auth/session.ts`) was **deleted in Phase 6 T10 Stage 8D** — see `tasks/STATUS.md` Stage 8D entry. The legacy `pa_provider_id` dev-mode cookie path lives in `middleware.ts` + `lib/api/auth.ts` gated on `NODE_ENV !== 'production'`; remove in Phase 7+ alongside RBAC work. | Contract validation: server-side test asserts the redirect status, `Set-Cookie: pa_session=...` header shape, and that a `SmartSession` row exists with `sessionToken` matching the signed cookie value. No JSON body to validate. |
| `error-response` | `{error: {code, message, details?}}` | Every API error path on both Next.js and FastAPI |
| `pagination` | `{items, total, page, page_size}` | `/api/queue`, `/admin/policies/drafts`, etc. |

Validation is a Vitest test that loads a fixture response, runs it through the corresponding zod schema, asserts no validation errors. New contracts get new fixtures; same pattern.

A separate `scripts/validate-contracts.ts` script re-runs every contract test against live API responses (per phase) — wired into the integration-tester gate.

### Integration tests

Cross-module within a single phase. Hits the local DB, hits the local FastAPI, hits the local FHIR mock adapter. **Does not hit Epic sandbox** (those are E2E).

Key integration flows to test (one test file per):

- `__tests__/integration/pa-flow.test.ts` — the demo's three scenarios at the API level (the scripts we already have at `scripts/smoke-scenario-*.ts` get promoted into integration tests).
- `__tests__/integration/fhir-sync.test.ts` (Phase 6) — `syncPatientFromFhir()` against the mock FHIR adapter for each demo patient; assert Prisma rows match expected shape.
- `__tests__/integration/document-triage.test.ts` (Phase 6) — Phase 3 evidence extraction with triage layer; assert top-K filter applied; assert Sonnet not called for non-relevant docs.
- `__tests__/integration/citation-pipeline.test.ts` (Phase 6) — clinical-note OCR + bbox + citation flow end-to-end.
- `__tests__/integration/submission-packet.test.ts` — packet generation for each scenario; assert page count, content extractability.

### Cross-phase contract (integration-tester)

Run automatically at every phase boundary. The integration-tester subagent reads the phase's exit checklist Step 2, executes every check, reports PASS/FAIL with structured failure output (per `penguinai-claude-artifacts-main/.claude/agents/integration-tester.md` format), and routes failures via the table in `ORCHESTRATION.md`.

A failing integration-tester blocks the next phase. Max 3 resume cycles per failure before escalating to user.

### AI quality / eval

Built on Penguin's `evals` module. Lives in `services/ai/evals/`.

Per AI task, an eval suite that:
1. Defines a golden set of (input, expected_output) pairs.
2. Runs the live AI task against each input.
3. Scores output against expected via `penguin.evals.criteria.for_qa()` / `for_extraction()` / custom criteria.
4. Reports per-criterion accuracy + overall pass rate.

Suites:

| Suite | Inputs | Expected | Pass threshold |
|---|---|---|---|
| `code_derivation_eval.py` | 30 synthetic notes covering common procedure scenarios | Expected CPT/HCPCS/ICD-10 sets | ≥90% exact match on primary procedure code; ≥80% on full set |
| `evidence_extraction_eval.py` | 50 (criterion, chart) pairs labeled by clinical reviewer | Expected pass/fail/needs_info per pair | ≥85% agreement with labels; ≥95% on the three demo scenarios specifically |
| `cover_letter_eval.py` | 20 PA states (codes + criteria + patient) | Quality scored via LLM-as-judge with rubric (clinical voice, factual grounding, no hallucinated facts) | ≥4/5 average rating; 0% factual hallucinations |
| `document_triage_eval.py` (Phase 6) | 10 patients with 50+ docs each, criteria + manually-labeled relevance | F1 score against labels | ≥0.85 F1; recall ≥0.95 (false negatives are worse than false positives in triage) |
| `policy_ingestion_eval.py` (Phase 6) — **matcher-tolerance calibration, NOT LLM-quality** | 5 hand-curated paraphrase scenarios: golden criterion text vs synthetically-perturbed ingested text (typos, reordering, near-synonym substitution). The eval **stubs `ingest_policy` entirely** — Bedrock is never called — so what's measured is whether the greedy Jaccard matcher at threshold 0.20 tolerates plausible paraphrasing. | Greedy Jaccard F1 / precision / recall against the golden curated rows | F1 ≥ 0.75, recall ≥ 0.80, precision ≥ 0.70 (matcher tolerance). **Do not read these numbers as Bedrock extraction quality.** Live-Bedrock policy-ingestion quality will be re-evaluated in `phase-6-epic-verification` once we replace the stub with a real `services/ai/policy_rescrape.py` call against a small held-out UHC PDF set; thresholds for that follow-on suite are TBD. |

Eval suites run in two modes:
- **Per-ticket:** the ai-engineer's "When done" report includes the eval pass rate for the suites their ticket touches.
- **Nightly:** scheduled CI (Phase 7+) re-runs all suites, alerts on regression >5%.

### E2E / browser tests via quality-tester

The quality-tester subagent (pattern from `penguinai-claude-artifacts-main/.claude/agents/quality-tester.md`) drives the live UI via Playwright MCP through every workflow in `WORKFLOWS.md` that's been implemented to date.

**Test case derivation rule:** every workflow in `WORKFLOWS.md` becomes one or more TC-IDs. A workflow's "Steps" map 1:1 to test assertions. A workflow's "Failure modes" each become a separate negative-path TC.

Example mapping for `WF-PROV-document-upload`:
- TC-WF-PROV-document-upload-happy — provider uploads PT records, recheck runs, criterion goes red → green
- TC-WF-PROV-document-upload-too-large — provider uploads 15MB file, sees size error
- TC-WF-PROV-document-upload-corrupt-pdf — corrupt PDF, OCR fails, criterion stays red, error surfaced
- TC-WF-PROV-document-upload-extraction-timeout — AI times out, criterion downgrades to needs_info

The quality-tester reports PASS/FAIL per TC-ID with screenshots on failure, and the orchestrator marks the phase complete only if all TCs pass (or a documented waiver is in `tasks/STATUS.md`).

### Workflow walks

A subset of the E2E suite. Specifically: walk every workflow in `WORKFLOWS.md` (not just the demo scenarios), confirming the UI supports it end-to-end. Workflow walks run at Phase 6 exit and again at every Phase 6+ exit.

### Performance tests (Phase 7+)

Not gated for Phase 6. Documented here so subagents know what's coming:

- LLM call latency: p50 <3s for evidence extraction; p95 <8s; document triage p50 <2s
- API endpoint latency: p50 <200ms for read endpoints; p95 <500ms
- OCR throughput: per-document end-to-end (FHIR fetch → Textract → page-images → DB write) p50 <30s
- Concurrent users: 50 simultaneous PAs in flight per org tier
- DB query: no N+1 patterns; every list endpoint paginated; index hits >99%

### Accessibility tests (Phase 5+)

Run on every screen at Phase 5 polish + Phase 6 polish:

- Keyboard-only navigation works for every workflow in `WORKFLOWS.md` PROV persona.
- Screen reader (NVDA / VoiceOver) reads logical content order.
- Color contrast: WCAG 2.2 AA on all interactive elements (axe-core enforces).
- Focus indicators visible.
- ARIA roles correct on the PDFViewer + Checklist (the most complex components).
- All form errors announced to assistive tech.

The qa-engineer agent runs `axe-core` on every screen as part of the Phase 5+ exit checklist.

### Security tests (Phase 6-compliance)

Detailed in `tasks/phase-6-compliance.md` (deferred). Phase 6 establishes the foundation; phase-6-compliance hardens. Must include:

- Dependency CVE scan (npm audit, pip-audit) — no high/critical
- Static analysis (semgrep) — no critical findings
- Secret scan (trufflehog) — zero hits
- Penetration test against authn/authz — done by external party, not subagent
- HIPAA controls audit — manual checklist; phase-6-compliance ticket
- BAA verification with all subprocessors — operational, not test
- TLS configuration — Mozilla SSL Test grade A or better
- OWASP Top 10 review

---

## Test data strategy

### Demo data (existing)

Three synthetic patients (Jordan Avery, Sam Rodriguez, Priya Shah, plus Fawad Butt for the Head CT demo) with deterministic ids. Loaded via `pnpm db:seed`. Backs every existing scenario test.

### Mock FHIR fixtures (Phase 6)

For every Epic-FHIR resource we use, a fixture file under `__tests__/fixtures/fhir/{resource}/{name}.json` with the EXACT shape Epic returns from its sandbox. Source: pull these once from Epic's sandbox via authenticated FHIR calls; commit to repo as test fixtures. Update via `pnpm tsx scripts/refresh-fhir-fixtures.ts` (Phase 6 ticket adds this).

Fixtures cover:
- `Patient` — Camila Lopez (sandbox patient with rich data), Derrick Lin (sparser data), edge cases (deceased, pediatric, gender-non-binary)
- `Encounter` — outpatient office visit, ED visit, inpatient admission (each)
- `Coverage` — UHC commercial, Medicare Part B, Medicare Advantage, BCBS — at least one of each
- `DocumentReference` — H&P (PDF), progress note (RTF), discharge summary (CCDA XML), imaging report (PDF), telehealth note (HTML)
- `ServiceRequest` — Head CT, Knee MRI, Botox infusion, generic primary care visit
- `Practitioner` — primary care, specialist, NP — variations on `qualification` array

### Synthea-generated patients (Phase 6+)

For load testing and broader coverage: a Synthea generation step produces 100 synthetic patients with full chart data. Inject into Epic's sandbox via the bulk-data API; reference in stress tests.

### Live Epic sandbox (Phase 6)

`fhir.epic.com` open sandbox. Test patients published by Epic at `https://fhir.epic.com/Documentation?docId=testpatients` — Camila Lopez et al. Used by the integration-tester at Phase 6 exit.

**Never** point any test at Epic production. Production access requires an App Orchard contract and customer onboarding (post-Phase 6).

---

## Test commands cheatsheet

Centralized so every subagent reaches for the same handle:

```bash
# Per-ticket loop (run before declaring done)
pnpm test                                   # Vitest unit + integration
pnpm tsc --noEmit                           # Type check
pnpm lint                                   # ESLint
cd services/ai && pytest && cd -            # Python tests
pnpm tsx scripts/validate-contracts.ts      # Contract validation

# AI eval (ai-engineer only)
cd services/ai && python -m pytest -m eval

# Pre-phase-exit (integration-tester runs these)
pnpm tsx scripts/smoke-scenario-1.ts        # Head CT
pnpm tsx scripts/smoke-scenario-2.ts        # Knee MRI
pnpm tsx scripts/smoke-scenario-3.ts        # Botox
pnpm tsx scripts/smoke-fhir-sync.ts         # Phase 6+ — real Epic sandbox

# Pre-Phase-5/6/7-exit (quality-tester runs)
pnpm e2e                                    # full Playwright suite
pnpm a11y:scan                              # accessibility
pnpm test:visual                            # visual regression (Phase 5+)

# Cleanup before declaring done
grep -rn "TODO\|FIXME\|XXX\|HACK" lib/ app/ services/ai/ | grep -v "^Binary"  # zero hits
grep -rn "console.log\|print(" lib/ app/ services/ai/ | grep -v "// allowed"  # zero hits
git diff --check                            # no whitespace errors / merge markers
```

---

## What "passing" means at a phase gate

The integration-tester reports PASS only if all of these hold simultaneously:

1. **No tests skipped** without an annotated waiver in `tasks/STATUS.md`. Skip annotations include the TC-ID, reason, and the ticket where the skip is unblocked.
2. **No coverage regressions** below the thresholds above. New code is covered to threshold; existing code not touched can stay where it was.
3. **All workflows in `WORKFLOWS.md` flagged "first implemented in: this phase or earlier" pass their TC-IDs.** Workflows scheduled for later phases can be UI-skeleton or stubbed.
4. **All contract validations green.** Every API response shape matches the canonical kit contracts.
5. **AI eval suites green** for tasks touched in this phase. Regressions of >5% from previous phase block.
6. **No high/critical security findings** from automated scans.
7. **No accessibility violations of severity "serious" or "critical"** on changed screens.

---

## Failure routing (when a test fails)

Same table as `ORCHESTRATION.md` "Failure routing" — extended with test-failure types:

| Test failure type | Resume target |
|---|---|
| Unit test red on a function the agent wrote | The implementing agent |
| Contract validation fails (response shape wrong) | api-engineer (or whoever owns the route) |
| Bbox-format violation | ai-engineer |
| Evidence extraction citation invalid | ai-engineer |
| FHIR adapter parses fixture wrong | fhir-engineer |
| SMART launch flow broken | fhir-engineer |
| E2E flow broken on a UI component | ui-engineer |
| AI eval regression | ai-engineer (with Plan agent for prompt iteration if needed) |
| Performance regression | performance-engineer (Phase 7+) |
| Accessibility violation | qa-engineer + ui-engineer pair |
| Security finding | security-reviewer + the responsible agent |

The integration-tester's structured failure report already includes the responsible-agent suggestion per kit's spec; orchestrator routes accordingly.

---

## Cadence (when each layer runs)

| Layer | Frequency |
|---|---|
| Unit, lint, type-check | Pre-commit + per-ticket |
| Contract validation | Per-ticket + at every phase boundary |
| Integration | Per-ticket + at every phase boundary |
| AI quality (per-suite) | Per ai-ticket + nightly (Phase 7+) |
| Cross-phase contract (integration-tester) | At every phase boundary |
| E2E browser (quality-tester) | Phase 5 + Phase 6+ exits |
| Performance | Phase 7+ exit; nightly Phase 8+ |
| Accessibility | Phase 5+ exit; nightly Phase 7+ |
| Security automated | Pre-commit (lint level) + Phase 6-compliance gate |
| Security manual / pen test | Phase 6-compliance + recurring annually |

---

## Anti-patterns (testing-specific)

- **Don't mock what you should integration-test.** If a test mocks `lib/policies/matchEngine.ts`, that's a unit test for the module that uses match — not a test of match itself. Match has its own integration tests.
- **Don't skip flaky tests — fix them.** A skipped test is a regression risk. Either it's flaky and we delete it (and document why), or it's a real failure and we fix it. "Skipped because flaky" is a code smell.
- **Don't write tests after the code.** TDD or near-TDD: write the test stub before the implementation, watch it fail, implement until it passes. The Plan agent's task backlogs explicitly call out tests as their own backlog items.
- **Don't trust an agent's "tests passed" report without seeing the output.** Subagents that say "all tests pass" without including the test-runner output get bounced. Same rule: assume problems exist; the agent's job is to find them, not to claim none.
- **Don't write fixtures that pass too easily.** Especially in AI evals — if every input matches every expected output, the test is meaningless. Adversarial inputs, edge cases, ambiguous data — all required.
