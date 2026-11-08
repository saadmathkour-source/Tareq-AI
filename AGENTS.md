# AGENTS.md

Repository-specific notes for agents working on **VoiceProxy AI**.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5.9 · Prisma 6 ·
Supabase (Postgres + Auth) · OpenAI SDK (also used for DeepSeek) · Stripe ·
Tailwind CSS 4. Deployed on Railway.

## Commands

```bash
npm install            # installs deps; postinstall runs `prisma generate`
npm run db:push        # push prisma/schema.prisma to the database
npm run dev            # dev server on :3000
npm run build          # prisma generate + next build
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
```

Always run `npm run typecheck` and `npm run build` before pushing.

## Environment / gotchas

- **Supabase Postgres user must be `postgres.<PROJECT_REF>`** with the *exact*
  project ref. A truncated ref fails with
  `FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found`.
  The ref is the `SUPABASE_URL` host prefix (`https://<ref>.supabase.co`).
- `DATABASE_URL` = pooled connection (port `6543`, `pgbouncer=true`).
  `DIRECT_URL` = direct connection (port `5432`), used by Prisma for schema pushes.
- Next.js does **not** let `.env` override an already-set process env var. When
  debugging local DB issues, confirm which value actually won via `/api/health`.
- `.env` is gitignored. Never commit secrets; keep `.env.example` in sync.
- `eslint-config-next` 16 ships flat config — import
  `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
  directly; do **not** wrap them with `FlatCompat` (it crashes on ESLint 9).

## Layout

- `src/app` — App Router pages and `api/*` route handlers.
- `src/lib` — `prisma`, `env` (zod-validated), `stripe`, `ai/provider`,
  `supabase/{client,server,admin}`.
- `prisma/schema.prisma` — `User`, `VoiceProfile`, `VoiceSession`,
  `Subscription`, `ApiKey`, `EventLog`.
- `GET /api/health` — liveness + DB/env probe; use it to verify deploys.

## TAREQ subproject (`tareq/`)

`tareq/` is a **separate, self-contained project** — an owner-controlled
autonomous commercial agent. It does not share VoiceProxy's `package.json`,
build, database or processes.

- Run its own tooling from inside `tareq/`: `npm install`, `npm test` (152 tests),
  `npm run db:push`, `npm run bootstrap`, `npm run api`, `npm run worker`,
  `npm run acceptance` (commercial end-to-end, 16 checks).
- **The API hosts the worker in-process** (`TAREQ_EMBEDDED_WORKER`, on by
  default). The worker is the durable orchestrator loop that executes queued
  tasks; without it, `/plan` and `/mission` enqueue work that never runs. Task
  handlers live in `tareq/src/lib/core/handlers.ts`, shared by the API and the
  standalone `npm run worker`, so the two entrypoints cannot drift. Every task
  kind a plan or schedule can emit MUST have a handler (guarded by
  `tests/plan-handlers.test.ts`) — a missing one dead-letters the task.
- Owner dashboard is served by the API at `/` (`tareq/src/app/dashboard.html`),
  bilingual AR/EN, data from persisted tables only. It exposes 16 sections
  including Leads, Research reports, API usage & cost, Errors and Config.
- **Database is a pooled Supabase connection with `connection_limit=1` and ~1.2s
  round-trips.** Keep code paths query-frugal: prefer `createMany` with
  client-generated ids, and do NOT `Promise.all` over multiple Prisma queries
  (it causes `P2024` pool timeouts). See `tareq/src/lib/sales/discovery.ts`.
- **Pitfall:** `/workspace/project/tareq` and `/workspace/project/Tareq-AI/tareq`
  are two *different* directories. Only `Tareq-AI/tareq` is git-tracked. Edit the
  tracked one (or sync with `tar`/`cp -r`); `rsync` is not installed here.
- It uses a **separate Postgres schema (`tareq`)** via
  `DATABASE_URL`/`DIRECT_URL` in `tareq/.env`, so it can share the Supabase
  instance without touching VoiceProxy's `public` tables.
- Read `tareq/README.md` before changing it. Governance (permissions, budget,
  stage gates, audit chain, evidence vault) is enforced in code, not by
  convention — keep it that way.
- Note: this repo's injected `GITHUB_TOKEN` is a **fine-grained** token without
  `Contents: write`, so git push returns `403`. Fix in GitHub: Settings ->
  Developer settings -> Fine-grained tokens -> Repository permissions ->
  Contents: Read and write. This is a scope issue, not a code issue.

## Deployment topology (verified 2026-11-08)

- The repo root is the **legacy VoiceProxy** Next.js app; TAREQ lives only in
  `tareq/`. Two Railway projects build this one repo (`precious-achievement`,
  `bountiful-forgiveness`). The host `tareq-ai-production.up.railway.app`
  currently serves **VoiceProxy**, not TAREQ — TAREQ's `/health` 404s there.
  The authoritative TAREQ service URL is only visible in the Railway dashboard;
  it is not discoverable from the repo. Treat "production TAREQ is up" as
  unproven until `/health` returns `{"service":"tareq"}` on the live host.
- The corrupted secret `$DATABASE_URL` has tenant `1jejjdvkgohknbyguzt`; the
  correct Supabase ref is `ljejjdvkgohknbnyguzt` (verified via
  `https://api.supabase.com/v1/projects`). The secret's password is valid — only
  the username is wrong. See `tareq/.env.example` for the expected URL shape.
- Stripe key in the environment is a **live** restricted key (`rk_live_...`),
  not test mode. Do NOT create live payment links or record revenue during
  audits. Webhook behaviour is verified via `tests/integrations.test.ts` and a
  signature-verified synthetic event posted to `/webhooks/stripe`.

## Testing gotchas

- The embedded worker (on by default in the API) **claims tasks concurrently**,
  so `tests/queue-deadlock.test.ts` can fail with "oldest ready task is claimed
  first" if the API is running. Stop the API (or set `TAREQ_EMBEDDED_WORKER=0`)
  before running the full suite; the suite is otherwise 152/152 green.
- Buyers link to an opportunity through `Lead.opportunityId`, NOT a
  `Buyer.opportunityId` field (that column does not exist). `StageEvent` sorts by
  `startedAt`, not `createdAt`.
- `scripts/deliverable-email-audit.ts` is the real, inspectable deliverable for
  the email-deliverability offer: it performs live DNS lookups (MX/SPF/DMARC/DKIM)
  and writes an HTML report to `tareq/deliverables/`.

## 2026-11-08 recovery session — key findings

- **The DB password has been rotated.** Both the `.env` password and the
  injected `$DATABASE_URL` password now fail with `password authentication
  failed for user "postgres"` against `postgres.ljejjdvkgohknbnyguzt`. The
  earlier "tenant not found" error is gone, which means the owner fixed the
  username but the password in the secret is stale. The owner must reset the
  database password in the Supabase dashboard and update the secret — do NOT
  guess. Repeated bad attempts trip a Supabase `(ECIRCUITBREAKER)` that blocks
  all new connections for a while, so test the password at most once.
- **The secret `DATABASE_URL` still has the wrong tenant** `postgres.1jejjdvkgohknbyguzt`
  (digit `1`, missing `n`) and no `?schema=tareq&pgbouncer=true&connection_limit=1`
  query, so even with a good password Prisma would target the wrong schema.
- Authoritative Supabase config (from `api.supabase.com`): ref
  `ljejjdvkgohknbnyguzt`, host `aws-0-ap-south-1.pooler.supabase.com`, port 5432
  (session) / 6543 (transaction), db `postgres`, user `postgres.ljejjdvkgohknbnyguzt`.
- **Railway still serves VoiceProxy** even though `main`'s root `railway.toml`
  builds `tareq/Dockerfile`. The pre-fix `railway.toml` (before commit 9e6e861)
  was `builder = "NIXPACKS"` + `startCommand = "npm run start"` = VoiceProxy.
  Conclusion: the public domain is attached to a **stale service/deployment**
  created before that commit, or a second service whose Root Directory is `/`.
  Owner action: in the Railway dashboard, confirm the service's Root Directory
  and Redeploy, and re-point the public domain at the TAREQ service.
- Ledger now distinguishes `TEST_TRANSACTION` and `PAYMENT_FAILED` from
  `REVENUE_CONFIRMED`, and `summary()` counts revenue only when `verifiedAt` is
  set. `handleWebhook` uses `event.livemode` (authoritative), never the key
  prefix, to decide revenue vs test.
- New: `src/lib/sandbox/exec.ts` (capability 13) — in-process V8 isolation,
  static screen, timeout, JSON-only output. New: `assessTrust` (capability 42).
  Gmail gained `createDraft`/`getDraft`; HubSpot gained get/update/find/company/
  associate/deal/delete.

## 2026-11-08 live production probe (post-push to main, commit 7190db4)

- **The public host now serves TAREQ, not VoiceProxy.** `GET /` on
  `https://tareq-ai-production.up.railway.app/` returns
  `<title>TAREQ — Owner Command Center</title>` and the bilingual dashboard.
  `GET /health` returns `{"service":"tareq",...}`. Phase 2's "wrong app" symptom
  is resolved on the live host; the earlier VoiceProxy serving was a stale
  deployment that has now been replaced by the `main` build.
- **The database is unreachable from production.** `/health` reports
  `Can't reach database server at db.ljejjdvkgohknbnyguzt.supabase.co:5432`.
  The Railway `DATABASE_URL` uses the **direct** connection host, which is
  IPv6-only and cannot be reached from Railway. Fix: set `DATABASE_URL` to the
  Supavisor pooler host `aws-0-ap-south-1.pooler.supabase.com` (port 5432
  session or 6543 transaction) with user `postgres.ljejjdvkgohknbnyguzt` and
  `?schema=tareq&pgbouncer=true&connection_limit=1`.
- **CRITICAL: `TAREQ_AUTH_BYPASS=1` is ON in production.** `GET /` carries
  `data-auth-bypass="1"`, and owner-only routes answer without a bearer token
  (`GET /capabilities` -> 200). The Owner Command Center is currently open to
  anyone with the URL. Remove/disable `TAREQ_AUTH_BYPASS` in Railway env before
  treating production as live.
- Routes that touch the DB (`/finance`, `/mode`, `/tasks`, `/auth/login`)
  return HTTP 500 while the DB is down; `/capabilities` and `/integrations`
  return 200 because they do not need the DB.
- Two Railway services build this repo (`precious-achievement`,
  `bountiful-forgiveness`); the `7190db4` deploy succeeded on one and failed on
  the other. The domain owner is the service that succeeded.
