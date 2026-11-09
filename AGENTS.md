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

## 2026-11-08 DB recovery — RESOLVED locally

- Database connectivity is restored using the **Supavisor pooler**:
  `DATABASE_URL` = pooler host `aws-0-ap-south-1.pooler.supabase.com:6543` with
  `?pgbouncer=true&connection_limit=1`; `DIRECT_URL` = same pooler host on
  `:5432`. Both authenticate as `postgres.ljejjdvkgohknbnyguzt`.
- The owner-supplied `DIRECT_URL` password was wrong; the working password is
  the one in `DATABASE_URL`. Do not assume the two URLs share a password —
  verify each independently.
- `npx prisma db push` now succeeds (schema in sync, including the new
  `TEST_TRANSACTION` / `PAYMENT_FAILED` ledger kinds) and `prisma generate`
  completes. Full suite is **174/174 green** against the live database, and a
  local `node src/app/server.ts` returns `/health` `{ok:true, database:{ok:true}}`.
- STILL WRONG: the platform-injected `$DATABASE_URL` secret still carries the
  old tenant `postgres.1jejjdvkgohknbnyguzt` and no query params. The owner must
  re-save that secret with the pooler URL + correct tenant, or Railway will keep
  using the unreachable direct host `db.<ref>.supabase.co:5432`.
- Secrets live only in gitignored `.env` files. Nothing secret is committed; a
  `git grep` for the password/publishable-key substrings over tracked files and
  the pushed history is clean.

## 2026-11-08 RECON — "VoiceProxy AI" LIVE production topology (read-only)

The production directive targets a system that is **not this repository**. Verified
topology, so future sessions do not re-derive it:

- **voiceproxyai.com is a Vite + React SPA on Railway** (`server: railway-hikari`),
  title "VoiceProxy AI — Autonomous AI Agents for Bill Negotiation & Wealth
  Optimization". It serves the landing HTML for *every* path, including
  `/api/*`, so this repo's Next.js API routes are NOT what is live there.
- Its backend is a **different Supabase project** (`tfhtxfpaoqyssyuaexnn`,
  not in the accessible account) with Edge Functions. Tables seen in the bundle:
  `calls, call_transcripts, ai_personas, user_personas, ledger_entries,
  notification_outbox, locale_cache`. Edge fn: `telegram-webhook`.
- The live Stripe webhook is the Edge Function
  `.../functions/v1/stripe-billing/webhook`, NOT this repo's
  `src/app/api/stripe/webhook/route.ts`.
- Access gaps: the injected `GITHUB_TOKEN` authenticates as `saadmathkour-source`
  and can see only `saadmathkour-source/Tareq-AI`; the directive's repo
  `tariqmathkour5-ux/VoiceProxy-Ultimate-AI` does not exist (404) and the user
  `tariqmathkour5-ux` does not exist. `SUPABASE_ACCESS_TOKEN` sees only the
  "Tareq AI" project `ljejjdvkgohknbnyguzt`, not the live `tfhtx...` project.
- `tareq/` (TAREQ AI) is a **separate** app (own Dockerfile, own Supabase project
  `ljejj...`); it is not connected to voiceproxyai.com.
- This repo's root Next.js app is a **scaffold**: `src/app/api/stripe/webhook`
  verifies the signature but does nothing on `checkout.session.completed` (logs
  only), and `STRIPE_PRO_PRICE_ID` is unset so `/api/stripe/checkout` 400s.

## 2026-11-08 SESSION 2 — TAREQ engine verified; deployment regression found

Verified by running the real engine locally against the production Supabase DB
(`ljejjdvkgohknbnyguzt`) with the compiled build (`npm run build` → `node
dist/src/app/server.js`, 24 handlers, embedded worker ON):

- POST /plan with a commercial goal produced a real task graph and the worker
  **executed all 6 tasks successfully** (plan + market_research → genome →
  demand_validation → economic_analysis → risk_review) via OpenAI/DeepSeek.
  TAREQ is a genuine autonomous agent, not a chatbot.
- Tool execution is permission-gated (`tools/registry.ts` → `authorize()`);
  modes are OBSERVE/PLAN/SANDBOX/SUPERVISED/AUTONOMOUS with `requiresApproval`
  classes. Operating mode is live `SUPERVISED`.
- **Fixed (commit b5c73f0):** `/finance` reported $100 gross revenue that did
  not exist in Stripe. Cause: a legacy fixture ledger row
  (`externalId it_test_pi_1`, `evidence.webhook evt_1`) marked
  REVENUE_CONFIRMED. `summary()` now excludes any external id containing the
  Stripe `_test_` marker and surfaces it as test volume. Regression test:
  `tests/ledger-honesty.test.ts`. Revenue now correctly $0.

**LIVE DEPLOYMENT REGRESSION (Railway config, not repo):** during this session
`tareq-ai-production.up.railway.app` began serving the **root Next.js VoiceProxy
scaffold** instead of TAREQ: `/` → `<title>VoiceProxy AI</title>` with
`/_next/static`, `/health` → **404**, `/api/health` → **503**. The repo's root
`railway.toml` correctly sets `builder=DOCKERFILE`,
`dockerfilePath=tareq/Dockerfile`, so the repo is right — the Railway **service
settings** are wrong (Root Directory / Config File Path / a failing Docker
build caused a fallback). Fix in Railway: either point the service's Root
Directory at `tareq/` (uses `tareq/railway.toml`, Nixpacks) or clear Root
Directory and set Config File Path to `/railway.toml` (Dockerfile build). Do NOT
let it build the repo root with Nixpacks.

## 2026-11-09 SESSION 3 — Phase 15.1 production runtime repair

Railway auto-deploys `main` (GitHub deployment events confirm). Fixes pushed and
verified live:

- **Auth bypass (Issue 1):** the live deployment was fully open — unauthenticated
  `/tasks` and `/finance` returned 200 with `data-auth-bypass="1"`. Root cause: a
  forgotten `TAREQ_AUTH_BYPASS=1`. Fix (`477b1a7`): startup refuses the bypass
  when an owner exists (and fails closed if owner state is unreadable). Owner
  login verified working first, so no lockout. **Live now: unauth routes 401, no
  bypass marker.** Owner action still recommended: set `TAREQ_AUTH_BYPASS=0`.
- **Prisma/OpenSSL (Issue 2):** pinned `binaryTargets = ["native",
  "debian-openssl-3.0.x"]` in the schema and installed `openssl` +
  `ca-certificates` in both Docker stages (and `nixpacks.toml`). `node:22-slim`
  is Debian 12 (OpenSSL 3); the earlier "defaulting to openssl-1.1.x" warning is
  gone and only the 3.0.x engine is generated. `prisma validate` passes; the
  live DB is reachable (`/health` database ok:true).
- **Worker (Issue 3):** `maxTasks: 0` means **unlimited** (run forever), NOT
  disabled — confirmed by reading `orchestrator.run`. Added an opt-in
  `TAREQ_WORKER_CONCURRENCY` (default 1) plus graceful SIGTERM/SIGINT stop.
  Duplicate execution is impossible: `claimNext` uses `FOR UPDATE SKIP LOCKED`.
- **Engine (Issue 4):** ran a real non-financial goal live
  (`POST /plan` → parent + 5 tasks). The production worker (worker-382123aa)
  claimed each in dependency order and all 6 reached `SUCCEEDED`; OpenAI
  `gpt-4o-mini-2024-07-18` was called (proves a real provider call). Results
  persisted and are visible via `/tasks` (stats SUCCEEDED:53+).
- **Queue test isolation:** queue tests run against the shared prod DB, so the
  live worker used to steal their rows. Rows are now tagged `QTEST-`; the worker
  excludes that prefix and the tests include only their own prefix. Suite is
  green (179/179) even with the live worker running.
- Added `GET /api/health` (alias of `/health`).

Operator actions that need Railway dashboard access (no API token available):
set `TAREQ_AUTH_BYPASS=0`; optionally `TAREQ_WORKER_CONCURRENCY=2..4`.

## Phase 16 — commercial operation (products → orders → delivery → revenue)

- **Products:** `src/lib/commercial/products.ts` (`seedProducts`, `listProducts`,
  `getPublishedProduct`). Only products with status `PUBLISHED` are sellable and
  reachable at `/buy/:slug`; DRAFT ones are invisible. Seeding is idempotent.
- **Landing pages:** `src/lib/commercial/landing.ts` (`generateLanding`,
  `generateAllLandings`, `renderLandingHtml`). Persisted to `Product.landingHtml`.
  Claims are limited to what we can prove — no testimonials/badges.
- **Orders:** `src/lib/commercial/orders.ts`. `createOrder` (published only),
  `attachCheckout`, `markPaid` (the only → PAID transition; idempotent; enqueues
  `order.deliver` once, keyed by order id), `listOrders`, `orderStats`.
- **Delivery:** `src/lib/commercial/delivery.ts` (`deliverOrder`, `buildReport`,
  `validateReport`). Report is source-cited from `publicdata` research; a report
  with no sources fails QA → order `FAILED`, never `DELIVERED`. `deliverOrder`
  accepts injectable `{scan, summarize}` for deterministic tests.
- **Money:** the ONLY place an order becomes PAID is the signature-verified Stripe
  webhook (`handleWebhook` → `markPaid`), matched by `client_reference_id` = order
  id. Test-mode completions never touch revenue or orders.
- **Routes (owner):** `/commercial/overview`, `/products` (+`/seed`,`/publish`,
  `/landing`), `/orders` (+`/checkout`, `/artifact`), `/finance/report?period=`.
  **Public:** `/shop`, `/buy/:slug`, `/thanks`, `/legal/{terms,privacy,refunds}`,
  `/robots.txt`.
- **Stripe caveat:** `createTestPaymentLink` is the only helper; it uses the
  configured key's mode (LIVE key ⇒ real payable links). Do not record revenue
  from it — only the webhook records money.
- **Test hygiene:** commercial tests tag rows `QTEST16-` and inject fake research;
  the live worker excludes the `QTEST` prefix.
- **Commands:** `npx prisma db push` (additive; DB already in sync), `npx tsc
  --noEmit`, `npm run build`, `npm test` (190/190).
