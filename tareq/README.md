# TAREQ

An independent, owner-controlled autonomous commercial agent. It plans work,
executes it through a durable queue, verifies outcomes against evidence, and
learns from results — all inside explicit permissions and a hard budget cap.

TAREQ runs standalone. It does not read another project's database or servers;
it uses its own Postgres schema (`tareq`) and its own process.

## Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Runtime    | Node.js ≥ 20.9 (TypeScript, run via `node`)  |
| Database   | PostgreSQL (Supabase) via Prisma 6           |
| AI         | OpenAI + DeepSeek (OpenAI-compatible API)    |
| HTTP       | `node:http` (no web framework)               |
| Deploy     | Railway (`railway.toml`)                     |

## How it is governed

TAREQ is designed so that the safety rules are mechanisms, not promises:

- **Operating mode** — `OBSERVE → PLAN → SANDBOX → SUPERVISED → AUTONOMOUS`.
  Raising the mode requires an owner action; `OBSERVE` forbids any acting tool.
- **Permissions** — sensitive actions (outreach, payments, publishing) are
  blocked until an owner approval exists. The block creates the approval request.
- **Budget governor** — a hard USD cap. Every model call is priced and recorded;
  spending stops at the cap.
- **Stage gates** — an opportunity cannot skip stages (e.g. it cannot reach
  `OUTREACH` without evidence and a quality check).
- **Evidence vault** — an offer cannot be published while it references a claim
  that is unverified, unpublished or expired.
- **Hash-chained audit** — every consequential action is appended to a tamper-
  evident chain (`verifyChain()`).
- **Kill switch** — the owner can stop an opportunity or the whole agent.

## Layout

```
src/app/server.ts            Owner API + serves the dashboard at /
src/app/dashboard.html       Bilingual (AR/EN) owner dashboard
src/lib/core/                logger, db, errors, audit, events, orchestrator, subagents
src/lib/queue/               durable task queue + scheduler
src/lib/security/            permissions, budget governor, owner auth
src/lib/providers/           model router with cost tracking and fallback
src/lib/memory/              memory + evidence vault
src/lib/commercial/          decision engine and commercial capabilities
src/lib/capabilities/        capabilities 64–100 + acceptance registry
src/lib/tools/               tool registry, research tools, built-in registration
src/lib/integrations/        optional connectors (Telegram, public data)
src/lib/finance/             ledger and acquisition metrics
worker/main.ts               worker: claims tasks, dispatches handlers
prisma/schema.prisma         the `tareq` schema
tests/                       98 tests (commercial, capabilities, security, publicdata, dashboard)
docs/                        architecture, security, deployment, 100-feature matrix
```

## Getting started

```bash
cp .env.example .env          # fill in real values; never commit .env
npm install
npm run db:push               # create the `tareq` schema in Postgres
npm run bootstrap             # seed sub-agents, schedules and the owner account
npm test                      # 98 tests
npm run api                   # start the owner API + dashboard on PORT (default 3300)
npm run worker                # start a worker
```

Open `http://localhost:3300/` for the dashboard. `GET /health` is public. Every
other route needs an owner session obtained from `POST /auth/login`.

## Deploying to Railway

`railway.toml` builds with `npm run build` and starts with `npm run api`. Set the
variables from `.env.example` in the Railway service, and run `npm run db:push`
once against the production database.
