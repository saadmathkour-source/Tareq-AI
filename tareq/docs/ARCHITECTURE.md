# TAREQ Architecture

TAREQ is a standalone autonomous commercial agent. It has its own database,
authentication, memory, orchestrator, workers, API and dashboard. It does not
read or write VoiceProxy AI's data and continues to function when every optional
external integration is disconnected.

## Runtime shape

```
                    +-----------------------------+
   owner browser -> |  src/app/server.ts (HTTP)   |  owner API + dashboard
                    |  - auth (owner sessions)    |
                    |  - mode / approvals / tasks |
                    |  - finance / audit / health |
                    +--------------+--------------+
                                   | same process model
                                   v
                    +-----------------------------+
                    | src/lib/core/orchestrator   |  claim -> dispatch -> ack
                    | worker/main.ts (process)    |  durable, resumable loop
                    +--------------+--------------+
                                   v
        +--------------------------+---------------------------+
        |            src/lib/* (domain libraries, no I/O glue) |
        | queue | planner | providers | memory | commercial     |
        | capabilities | finance | sales | security | tools     |
        +--------------------------+---------------------------+
                                   v
                    +-----------------------------+
                    |  PostgreSQL (schema: tareq) |  Prisma 6
                    +-----------------------------+
```

Two processes, one codebase:

- **API** (`npm run api`) — the owner control surface and dashboard.
- **Worker** (`npm run worker`) — the durable task loop that runs without a
  browser. It also runs scheduled maintenance and reclaims stale tasks.

Both share the same libraries and the same database, so state is consistent.

## Layers

- `src/lib/env.ts` — lazy, zod-validated environment access. Importing it never
  throws; `env()` throws only where a value is actually needed.
- `src/lib/core/` — orchestrator, task queue, audit (hash-chained), event bus,
  logger, typed errors, Prisma client.
- `src/lib/security/` — permission engine, owner auth/sessions, budget cap.
- `src/lib/providers/` — provider-independent model routing (OpenAI, DeepSeek).
- `src/lib/memory/` — working/long-term memory and the evidence vault.
- `src/lib/commercial/` — the decision engine and groups 29-63 engines.
- `src/lib/capabilities/` — groups 64-100 engines and the 100-group index.
- `src/lib/sales/` — leads and outreach (draft-only until approved).
- `src/lib/finance/` — the ledger; revenue only on verified collection.
- `src/lib/tools/` — tool registry, research tools and built-in registration.
- `src/lib/integrations/` — optional connectors (Telegram, public data).
- `src/lib/observability/` — health/readiness and the capability table.

## Data flow for one opportunity

`DISCOVER -> RESEARCH -> VALIDATE -> PRIORITIZE -> DESIGN -> BUILD -> TEST ->
MARKET -> SELL -> COLLECT -> DELIVER -> VERIFY -> ACCOUNT -> LEARN -> IMPROVE`

Each step is a durable task kind handled in `worker/main.ts`. Evidence,
assumptions, confidence and cost are persisted with the opportunity so a later
step can be re-derived and audited.

## Independence guarantees

- No import in `src/` or `worker/` references another project.
- The database schema is `tareq`; no foreign tables are read.
- Optional integrations fail closed: if unconfigured, the feature is skipped and
  the rest of the agent keeps running.
