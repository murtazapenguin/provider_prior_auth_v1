# Provider PA — Expert Testing Guide

Thanks for helping us test. This is a **prior-authorization (PA) workflow tool for
providers**: it pulls clinical context, identifies procedure/drug codes, checks them
against payer policies, extracts supporting evidence with citations, walks the provider
through review, and submits to the payer.

We'd like your feedback on two things:

1. **The workflow** — does it match how prior auth actually works in practice?
2. **The policy extraction** — are the AI-extracted criteria and codes accurate?

---

## Accessing the app

Open **`<APP URL — provided separately>`**. You'll land on a launcher — pick a demo
provider/patient to enter the app.

Everything runs on **synthetic data — there is no real PHI.**

---

## What's real vs. simulated

So you can ignore anything that looks "mocked," here's the split:

| Real | Simulated |
|---|---|
| The AI — code derivation, evidence extraction, citations | EHR connection (4 fixed synthetic patients) |
| The policies — real UHC policy PDFs, AI-extracted | Insurance eligibility check |
| The PA state machine + audit log | Payer submission + decision (a timer-driven simulator) |
| The admin policy-review surface | Provider login |

---

## Part 1 — Walk the 4 built scenarios

These come with full clinical data preset. Open each from the queue:

1. **Head CT (Jordan Avery)** — *happy path.* Everything is already documented; criteria
   pass on the first check; submit → approved. Tests the basic loop.
2. **Knee MRI (Sam Rodriguez)** — *missing-evidence loop.* One criterion (conservative
   therapy) comes back needing documentation; upload the PT records; re-check; all green;
   submit. Tests the upload-and-recheck flow.
3. **Botox (Priya Shah)** — *the complex one.* A criterion returns `needs_info`; you
   manually override it with a rationale; submit; the payer returns an RFI; you respond;
   approved. Tests manual override + the RFI loop.
4. **Power Wheelchair** — a durable-medical-equipment PA scenario. Tests a non-imaging,
   non-drug policy.

For each, watch for: **do the derived codes look right? Are the criteria the right
criteria? Do the citations point to the correct evidence? Does the flow feel like real
prior auth?**

---

## Part 2 — Test against the full policy set

Beyond the 4 scenarios, the app holds **81 UHC policies auto-extracted from the real
policy PDFs.** To exercise any of them:

1. Go to **"Start Prior Authorization"** (`/pa/new`).
2. Enter a procedure code — e.g. `69930` (cochlear implant) or `64490` (facet joint
   injection) — and select the payer (UnitedHealthcare).
3. The app tells you whether PA is required and which policy applies.
4. Continue → pick or create a patient → start the PA.
5. On the PA page, upload a relevant clinical note (a synthetic/de-identified example of
   your own) and run the criteria check.

This is the real product path — it works for any policy that has procedure codes.

---

## Part 3 — Review policy extraction quality

To review the AI-extracted policies directly, go to **`/policies`** (the admin view).
Each policy shows its extracted criteria and applicable codes — compare them against the
source UHC policy.

**Tell us:** are the criteria complete and accurate? Are the codes correct? Anything
missing, or anything that looks invented?

---

## Known limitations — no need to report these

- **13 of the 81 policies have no codes yet** — they won't appear when you enter a code
  in `/pa/new`. Known; codes still need to be added.
- **Some policy titles are rough** (e.g. "Cosentyx Iex") — they're auto-derived from
  filenames and get cleaned up during review.
- **Power Wheelchair** — a 500 error there means the AI service is briefly down; retry.
- All patient and clinical data is synthetic.

---

## Giving feedback

`<Feedback channel — shared doc / form / etc., to be provided>`

For each item, please note: the scenario or policy, what you expected, and what you saw.
