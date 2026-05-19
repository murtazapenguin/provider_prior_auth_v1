# Provider PA — Expert Testing Guide

Thanks for helping us test. This is a **prior-authorization (PA) workflow tool for
providers**: it identifies procedure / drug codes, checks them against payer policies,
extracts supporting evidence with citations, walks the provider through review, and
submits to the payer.

We'd like your feedback on two things:

1. **The workflow** — does it match how prior auth actually works in practice?
2. **The policy extraction** — are the AI-extracted criteria and codes accurate?

You're testing the actual product. There are no canned scenarios — you'll use it the way
a provider would.

---

## Accessing the app

Open **https://provider-prior-auth-v1.vercel.app** and click **"Sign in to test"** →
**"Continue"**. You'll land in an empty queue. Use the app from there as a real provider
would.

Everything runs on **synthetic data — there is no real PHI**. Anything you create is
visible to other testers (shared test environment).

---

## What's real vs. simulated

| Real | Simulated |
|---|---|
| The AI — code derivation, evidence extraction, citations | EHR connection (you create patients in-app instead of pulling from an EHR) |
| The policies — 87 UHC policies, AI-extracted from real PDFs | Insurance eligibility check |
| The PA state machine + audit log | Payer submission + decision (timer-driven simulator) |
| The admin policy-review surface | Provider login (a button signs you in as a generic tester) |

---

## Part 1 — Walk a prior-authorization workflow

The queue starts empty. To run a PA:

1. Go to **`/pa/new`** (the "Start Prior Authorization" wizard).
2. Enter a procedure or drug code — e.g. `69930` (cochlear implant), `64490` (facet joint injection), `J0585` (Botox), `73721` (Knee MRI), `95810` (sleep study). Choose the payer (**United Healthcare**).
3. The app checks the code against the 87 ingested policies and tells you whether PA is required (and which policy applies).
4. Continue → create a new patient (name, DOB, sex, member ID, plan). You can also pick an existing patient if other testers have already created any.
5. Start the PA. You'll land on the PA detail page.
6. **Upload a clinical note** — a synthetic / de-identified case of your choice (PDF or plain text). This is the evidence the AI will check against the policy criteria.
7. Run the **criteria check**. The AI evaluates each criterion against your uploaded note and cites the supporting passages.
8. Review the results. Override any incorrect AI findings with a rationale. Submit when ready.
9. Watch the payer simulator advance: *pending → in_progress → approved* (or *RFI*). If a PA seems stuck, use the in-app fast-forward control.

**For each run, watch for:**
- **Code matching** — does the right policy come up for the code you entered?
- **Criteria** — are the right criteria evaluated? Is the AI's reasoning sound?
- **Citations** — do the cited passages actually support the AI's conclusion?
- **Override + RFI flows** — do they feel right for real PA work?
- **Overall feel** — does this match how prior auth actually works in your practice?

---

## Part 2 — Review policy extraction quality

To review the AI-extracted policies directly, go to **`/policies`** (the admin view).
Each policy shows its extracted criteria and applicable codes — compare them against the
source UHC policy.

**Tell us:** are the criteria complete and accurate? Are the codes correct? Anything
missing, or anything that looks invented?

---

## Known limitations — no need to report these

- **13 of the 87 policies have no codes yet** — they won't appear when you enter a code in `/pa/new`. Known; codes still need to be added.
- **Some policy titles are auto-derived from filenames** and read roughly (e.g. "Cosentyx Iex") — they're cleaned up during human review before publishing.
- **Payer simulator runs on a manual fast-forward**, not a timer (the sub-daily cron requires a paid Vercel plan).
- **Shared test environment** — every tester sees every other tester's patients and PAs.
- **All clinical content is what testers upload** — there's no patient roster pre-loaded; you bring the cases (synthetic or de-identified).

---

## Giving feedback

Send your feedback async — email, Slack, or whatever channel you'd normally use to
reach us. For each item, please note: the procedure code or policy, what you expected,
and what you saw.
