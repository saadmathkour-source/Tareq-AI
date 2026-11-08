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
