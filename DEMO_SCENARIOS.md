# Demo Scenarios

Three scripted scenarios that exercise the system end-to-end. Each is built on synthetic patient data, has a deterministic outcome, and is designed to demonstrate a different facet of the workflow.

These scenarios drive what we seed, what we hand-validate in policy ingestion, and what we test against. If a scenario can't be demoed cleanly, the build isn't done.

## Scenario 1: Head CT — PCP order

**What it demonstrates:** the happy path. PA required, all criteria already met by chart evidence, smooth submission, simulated approval.

### Patient profile
- **Name:** Jordan Avery (synthetic)
- **DOB:** 1968-03-12 (age ~58)
- **Sex:** F
- **Coverage:** UHC commercial PPO, plan "Choice Plus"
- **Member ID:** 9 alpha-numeric, mock
- **PCP encounter date:** today

### Encounter setup
- **Provider:** PCP, internal medicine
- **Place of service:** 11 (Office)
- **Chief complaint:** "New-onset severe headache for 3 days, worst-ever quality, photophobia"
- **Notes available:**
  - PCP H&P with HPI describing thunderclap onset, no prior history of similar headaches, neurologic exam documented (cranial nerves intact, normal motor and sensation), red flags noted
- **Order placed:** CT head/brain without contrast, **CPT 70450**

### Expected derived codes
- CPT: **70450**
- ICD-10: **R51.9** (Headache, unspecified) and/or **G43.909** (Migraine, unspecified, not intractable, without status migrainosus) — AI should pick R51.9 as primary based on the documented "new-onset severe headache, no prior history"

### Expected policy hit
- **Reality check:** same as Knee MRI — the UHC eviCore radiology policy in the dataset confirms 70450 is PA-required, but the clinical criteria live on eviCore's site.
- **For the demo we hand-curate** "UHC Choice Plus advanced imaging of the head — managed by eviCore" with criteria typical of UM vendor policies. Document the synthesis honestly.
- **Criteria for the hand-curated demo policy:**
  - "New or worsening headache pattern" — passes (citation: HPI line about 3-day onset, worst-ever quality)
  - "Red flag symptoms documented" — passes (citation: thunderclap onset, photophobia)
  - "Neurologic exam performed and documented" — passes (citation: physical exam section)

### Expected outcome
- All criteria pass on first run.
- PA goes Draft → **Ready for Submission**.
- Provider clicks Continue to review screen → submission packet auto-generates (~3 seconds; LLM narrative paragraph + assembled PDF) → provider reviews packet preview → clicks Submit.
- Simulator: Pending → In Progress (30s) → **Approved** (90s).
- Demo time end-to-end: ~2 minutes (or ~10 seconds with fast-forward).

### What this tests
- Code derivation from PCP-style notes
- Policy lookup against commercial payer
- All-pass evidence extraction with strong citations
- Submit → simulated approval pipeline

---

## Scenario 2: Knee MRI — Orthopedic order

**What it demonstrates:** the missing-evidence loop. Provider order arrives, criteria check finds gaps (conservative therapy not documented in the available notes), provider uploads PT documentation, system rechecks, all green, submit, approved.

### Patient profile
- **Name:** Sam Rodriguez (synthetic)
- **DOB:** 1972-09-04 (age ~53)
- **Sex:** M
- **Coverage:** UHC commercial PPO, plan "Choice Plus" (PA managed by eviCore)
- **Encounter date:** today

### Encounter setup
- **Provider:** Orthopedic surgeon
- **Place of service:** 11 (Office)
- **Chief complaint:** "Right knee pain for 4 months, worsening, not responding to treatment"
- **Notes available initially:**
  - Ortho consult note: HPI, PE (positive McMurray, joint line tenderness), assessment ("Suspected medial meniscal tear, conservative measures failed per patient report"), plan ("MRI right knee for further evaluation")
  - **Note:** the ortho note mentions "conservative measures failed per patient report" but does NOT include the actual PT records, durations, or outcomes
- **Order placed:** MRI right knee without contrast, **CPT 73721**

### Expected derived codes
- CPT: **73721**
- ICD-10: **M23.231** (Derangement of anterior horn of medial meniscus due to old tear or injury, right knee) or **S83.241A** depending on documentation

### Expected policy hit
- **Reality check:** real CMS LCDs do not generally PA-require an outpatient knee MRI for traditional Medicare Part B; PA for outpatient imaging is handled by third-party UM vendors (eviCore, NIA, etc.) for Medicare Advantage and commercial plans. The dataset's `UHC/medical-policies/radiology-procedures-evicore-ohp.pdf` confirms 73721 is PA-required by eviCore, but the actual clinical criteria live on the eviCore website (not in our data).
- **For the demo we hand-curate** an eviCore-style policy "Outpatient MRI of the Knee — managed by eviCore (commercial)" with criteria typical of UM vendor policies. Document the synthesis honestly in the demo policy fixture.
- **Criteria for the hand-curated demo policy:**
  - "Failure of conservative therapy ≥6 weeks (PT, NSAIDs, activity modification)"
  - "Documented findings on physical exam consistent with internal derangement"
  - "Imaging will change clinical management"

### First evidence extraction pass
- "Failure of conservative therapy" — **fails / needs_info**: best citation is the orthopedist's mention "conservative measures failed per patient report" but no documentation of duration or specific therapy. AI returns `needs_info` with low confidence and a clear rationale.
- "Physical exam findings" — **passes**: clear citation to PE section
- "Imaging changes management" — **passes**: clear citation to plan section

### Expected first-pass UI state
- Checklist shows 1 missing item with a clear ask: "Documentation of conservative therapy duration ≥6 weeks (PT records, NSAID trial, activity modification log)."
- Status: **Draft** (with missing items)

### Provider action: upload
- Provider uploads PT discharge summary (PDF or text) showing 8 weeks of PT, 2x/week, with start and end dates and outcome ("limited functional improvement").
- System runs evidence extraction across all criteria again (not just the missing one).

### Second evidence extraction pass
- "Failure of conservative therapy" — **passes**: citation to PT discharge note, "8 weeks PT, 2x/week, limited functional improvement"

### Expected outcome
- All criteria pass on second run.
- PA auto-transitions Draft → **Ready for Submission**.
- Provider clicks Continue to review screen → submission packet auto-generates (now includes the PT discharge upload from the recheck loop) → provider reviews → clicks Submit.
- Simulator: Pending → In Progress → **Approved**.

### What this tests
- The upload-and-recheck loop (the most important UX flow in the app)
- AI handling `needs_info` vs `failed` (both block, but rendered differently)
- Re-running across all criteria, not just the failed one
- Citation to a newly uploaded document

---

## Scenario 3: Botox for Migraines — Neurology order

**What it demonstrates:** the most complex case. Detailed criteria, evidence spread across multiple note types, RFI loop with the simulated payer, eventual approval. This is the "showcase" demo.

### Patient profile
- **Name:** Priya Shah (synthetic)
- **DOB:** 1985-07-22 (age ~40)
- **Sex:** F
- **Coverage:** UHC commercial PPO, plan "Choice Plus"
- **Encounter date:** today

### Encounter setup
- **Provider:** Neurologist
- **Place of service:** 11 (Office)
- **Chief complaint:** "Chronic migraine, escalating frequency, on multiple preventive failures"
- **Notes available:**
  - Neurology progress note (today's): documents 18 headache days/month for the past 4 months, 10 of which are migraine-quality and last >4 hours; failed propranolol (4 months, worsening BP), failed topiramate (3 months, cognitive side effects), **trialed amitriptyline 6 weeks then discontinued for moderate sedation** (note language is intentionally soft on whether this clearly meets "intolerance"); plan "initiate Botox per chronic migraine protocol, 155 units across 31 sites every 12 weeks"
  - Headache diary attached as a separate scribe note: daily entries for the past 90 days, showing average headache duration 5–8 hours
  - Prior PCP note from 3 months ago: documents diagnosis of chronic migraine and prior triptan use for acute treatment
- **Order placed:** OnabotulinumtoxinA, **HCPCS J0585** (155 units total per protocol)

### Expected derived codes
- HCPCS: **J0585** (per unit)
- ICD-10: **G43.701** (Chronic migraine without aura, intractable, without status migrainosus) or **G43.711**

### Expected policy hit
- **Real policy in the dataset:** `UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf`. The actual UHC Botox criteria for chronic migraine prophylaxis (verified against the source PDF):
  1. **Diagnosis of chronic migraine** defined by ALL of: ≥15 headache days/month, ≥8 migraine days/month, headaches last ≥4 hours/day
  2. **History of failure (after a trial of at least two months), contraindication, or intolerance** to prophylactic therapy with one agent from **two of the following classes**: Antidepressant (amitriptyline, venlafaxine), Antiepileptic (divalproex, topiramate), Beta blocker (atenolol, propranolol, nadolol, timolol, metoprolol)
  3. **Botox dose does not exceed 155 units** administered intramuscularly divided over 31 injection sites across 7 head and neck muscles every 12 weeks

### Expected first evidence extraction pass
- Criterion 1 (diagnosis) — **passes** (citation: "18 headache days/month for past 4 months, 10 migraine-quality, lasting >4 hours" from today's note; reinforced by the headache diary's average-duration entries)
- Criterion 2 (failure of preventives from 2 classes) — **passes for propranolol** (4 months ≥ 2 months threshold, beta blocker class) and **topiramate** (3 months, antiepileptic class). **needs_info on amitriptyline** because the trial was only 6 weeks (clearly below the policy's "at least two months" threshold) and the discontinuation reason ("moderate sedation") is ambiguous as to whether it meets "intolerance" — the AI flags this for clarification.
- Criterion 3 (dose) — **passes** (citation: plan section "155 units across 31 sites every 12 weeks" matches the policy verbatim)

> **Note:** The policy actually only requires failure from TWO classes (not all three), and propranolol + topiramate already cover two classes. So the amitriptyline finding is a real-world coverage edge case: the AI flags it because the chart documents an apparent third class trial that's incomplete, but the policy's letter is already satisfied. This is a great teaching moment for the demo — the manual override path lets the provider acknowledge "amitriptyline trial is incomplete; we don't need it because criterion 2 is already met by propranolol + topiramate."

### First-pass UI state
- One yellow / needs_info item on amitriptyline duration. Provider can:
  - **Override manually** with a free-text rationale ("Amitriptyline trial was 6 weeks (subthreshold) — discontinued for moderate sedation. Criterion 2 is already met by failed trials of propranolol [beta blocker, 4 months] and topiramate [antiepileptic, 3 months]; amitriptyline is not required."), OR
  - **Add documentation** showing the amitriptyline intolerance more clearly.

For demo purposes, provider does the manual override (showcasing that affordance). Override is logged in audit trail.

### Submission and RFI
- All criteria green (after override), PA → Ready for Submission. Provider clicks Continue to review screen → submission packet auto-generates (includes the manual override rationale on page 2 alongside the cited evidence) → provider reviews → clicks Submit.
- Simulator: Pending → In Progress → **RFI** ("Please clarify amitriptyline trial duration — note indicates 6 weeks. Two-month minimum applies per policy.").
- Provider receives the RFI, the UI surfaces a "respond" affordance.
- Provider attaches a clarification note: "Amitriptyline trial does not need to satisfy criterion 2 because failed trials of propranolol (4 months) and topiramate (3 months) — both ≥ 2 month threshold, from two distinct therapeutic classes — already satisfy the requirement. See neurology note 2026-05-05."
- Simulator picks it up: RFI → In Progress → **Approved**.

### What this tests
- Multi-criterion evaluation with mixed pass/needs_info
- Manual override flow with audit
- Citations across multiple note types (today's note, headache diary, prior PCP note)
- RFI loop end-to-end
- The system's behavior when reality doesn't fit the criteria perfectly — the most important real-world case

---

## Scenario summary table

| | Head CT | Knee MRI | Botox |
|---|---|---|---|
| Specialty | PCP | Ortho | Neuro |
| Code | 70450 (CPT) | 73721 (CPT) | J0585 (HCPCS) |
| Payer | UHC Choice Plus | UHC Choice Plus (eviCore) | UHC Choice Plus |
| Policy source | Hand-curated (eviCore-style) | Hand-curated (eviCore-style) | **Real PDF**: `UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf` |
| Criteria complexity | Simple | Medium | Complex |
| First-pass outcome | All pass | One missing | One needs_info |
| Provider action mid-flow | None | Upload PT records | Manual override |
| Post-submission | Approved | Approved | RFI then Approved |
| Demonstrates | Happy path, full pipeline | Upload-and-recheck loop | Manual override + RFI |
| Demo time | ~2 min | ~3 min | ~4 min |

> **Payer note:** the original draft had Sam Rodriguez (Knee MRI) on traditional Medicare Part B with a CMS LCD as the policy source. After inspecting the dataset (CMS data is administrative-only for outpatient knee MRI; the actual coverage criteria for outpatient imaging live with UM vendors like eviCore), we moved Sam to UHC Choice Plus too, with the policy hand-curated in the eviCore style. The demo flow doesn't change — same upload-and-recheck arc — but the payer is consistent across all three scenarios. If we want true payer diversity later, the cleanest swap is to change Jordan Avery (Head CT) to a Medicare Advantage plan whose MA carrier uses eviCore.

## Seed data file layout

```
prisma/
  seed.ts                          # orchestrates all loads
  fixtures/
    patients.json                  # 3 synthetic patients above
    coverages.json
    encounters/
      head_ct.json                 # encounter + notes for scenario 1
      knee_mri.json                # encounter + notes for scenario 2
      botox.json                   # encounter + notes for scenario 3
    additional_uploads/
      pt_discharge_sam_rodriguez.txt   # used in scenario 2 upload step
      amitriptyline_intolerance_note.txt # optional, scenario 3
```

## Demo script (suggested)

For a stakeholder demo, run the scenarios in this order:

1. Head CT (~2 min) — establishes the basic loop
2. Knee MRI (~3 min) — shows the upload-and-recheck loop
3. Botox (~4 min) — shows complex evidence + RFI

Total: ~9-10 minutes with narration, or ~4 minutes with fast-forward enabled.

A "scenario launcher" page at `/demo` lists all three with a "Start" button each, which loads the relevant fixtures and routes the demo'er into the encounter intake screen.
