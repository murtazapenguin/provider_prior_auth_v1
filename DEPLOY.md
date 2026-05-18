# Deploying Provider PA — expert-testing instance

A test deployment for expert feedback: synthetic data, mock FHIR. **Not** a
production / HIPAA-hardened setup.

Three services:

| Piece | Host |
|---|---|
| Next.js app | Vercel |
| FastAPI AI sidecar | Render (or Railway) |
| Postgres | Vercel Postgres |

Deploy order matters: **DB → sidecar → app** (the app needs the sidecar's URL).

---

## Prerequisites

- A **GitHub repo** for this project. It isn't a Git repo yet — Render builds the
  sidecar from Git, so push it to a private GitHub repo first. (Vercel can deploy the
  app from the same repo.)
- A **Vercel** account.
- A **Render** account (render.com).
- An **AWS IAM user** with a long-lived access key — see below.

### IAM user

Don't use the temporary SSO credentials — they expire in hours and the sidecar would
start failing mid-test. Create a dedicated IAM user with a policy allowing:

```
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
textract:AnalyzeDocument
textract:DetectDocumentText
textract:StartDocumentAnalysis
textract:GetDocumentAnalysis
```

Generate an access key; you'll need the key id + secret for the sidecar.

---

## Step 1 — Postgres (Vercel Postgres)

In your Vercel project → **Storage → Create → Postgres**. Copy both connection
strings it gives you: the **pooled** URL and the **direct** (non-pooled) URL.

## Step 2 — Seed the prod DB (from your laptop, once)

The seed loads reference codes + all 87 policies and **wipes every table** — run it
once, before experts touch the app. It reads the repo's data folders, so run it from
this checkout:

```
DATABASE_URL="<direct-url>" pnpm prisma migrate deploy
DATABASE_URL="<direct-url>" pnpm db:seed
```

Use the **direct** URL here. Takes a few minutes (ICD-10 is ~98K rows).

## Step 3 — Deploy the sidecar (Render)

1. **New → Web Service**, connect the GitHub repo.
2. Runtime: **Docker**. Dockerfile path: `services/ai/Dockerfile`. Root directory: repo root (leave blank).
3. Set the sidecar env vars (table below).
4. Deploy. Note the service URL (e.g. `https://pa-sidecar.onrender.com`).
5. Verify: `curl https://<sidecar-url>/health` → `{"status":"healthy"}`.

## Step 4 — Deploy the Next.js app (Vercel)

1. Import the GitHub repo as a Vercel project (framework: Next.js — auto-detected).
2. Set the app env vars (table below) — including `AI_SERVICE_URL` = the Step 3 URL.
3. Deploy. Note the app URL (e.g. `https://provider-pa.vercel.app`).

## Step 5 — Verify

Open `https://<app-url>/launch/standalone`, pick a demo patient, and confirm you land
in the queue. Walk the Head CT scenario end to end (it should reach **Approved**).

Then fill the URL + feedback-channel placeholders in `EXPERT_TESTING_GUIDE.md` and
send that to the experts.

---

## Environment variables

### Sidecar (Render)

| Variable | Value |
|---|---|
| `AI_SERVICE_TOKEN` | a shared secret — must match the app's value |
| `AWS_REGION` | `us-east-2` |
| `AWS_ACCESS_KEY_ID` | IAM user key id |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `PENGUIN_LLM_PROVIDER` | `bedrock` |
| `PENGUIN_LLM_MODEL` | `claude-sonnet-4-5` |
| `PENGUIN_GUARD_MODEL` | `claude-haiku-4-5` |
| `DATABASE_URL` | Vercel Postgres **pooled** URL |
| `LOG_LEVEL` | `INFO` |

### Next.js app (Vercel)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Vercel Postgres **pooled** URL |
| `AI_SERVICE_URL` | the sidecar URL from Step 3 |
| `AI_SERVICE_TOKEN` | the same shared secret as the sidecar |
| `FHIR_MODE` | `mock` |
| `POLICY_SOURCE` | `demo` (surfaces all 87 policies, incl. the 81 ingested drafts) |
| `APP_TOKEN_ENCRYPTION_KEY` | generate with `openssl rand -base64 32` |
| `EPIC_SANDBOX_FHIR_BASE` | any placeholder URL — unused in mock mode, but the launcher requires it set, e.g. `https://fhir.epic.example/api/FHIR/R4` |
| `EPIC_SANDBOX_AUTH_BASE` | any placeholder URL |

---

## Notes / gotchas

- **Payer-simulator cron.** `vercel.json` schedules `/api/cron/sweep` every 5 min — it
  advances submitted PAs (pending → approved). Sub-daily crons require **Vercel Pro**.
  On the Hobby plan, testers advance a PA with the in-app "fast-forward" control instead.
- **Re-seeding is destructive.** `pnpm db:seed` wipes all tables. Don't re-run it
  against a DB experts are actively using.
- **The sidecar needs the IAM user's permanent key**, not temp SSO creds.
- **Mock auth works in production** because the standalone launcher gates on
  `FHIR_MODE=mock`, not `NODE_ENV` — so setting `FHIR_MODE=mock` is what keeps
  `/launch/standalone` functional on the deployed instance.
