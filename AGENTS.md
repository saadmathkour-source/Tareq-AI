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
