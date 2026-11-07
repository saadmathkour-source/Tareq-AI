# TAREQ Deployment Guide

## Prerequisites

- Node.js 22+ (the project uses `--experimental-strip-types`).
- A PostgreSQL database. A dedicated instance is preferred for full
  independence; a dedicated `tareq` schema on a shared instance is acceptable.
- An OpenAI and/or DeepSeek API key.

## Local run

```bash
cp .env.example .env      # fill in DATABASE_URL, owner creds, provider keys
npm install
npm run db:push           # create the schema
npm run db:generate       # generate the Prisma client
npm run build             # compile to dist/ (copies the dashboard asset)
npm run api               # owner API + dashboard on $PORT (default 3300)
npm run worker            # durable task loop (separate process)
```

The owner account is created from `TAREQ_OWNER_EMAIL` / `TAREQ_OWNER_PASSWORD`
by `npm run bootstrap` or `npm run seed:owner`.

Open `http://localhost:3300/` for the dashboard.

## Railway

`railway.toml` is included:

- Build: `npm run build`.
- Pre-deploy: `npm run db:push && npm run bootstrap` (idempotent schema sync + seed).
- Start: `npm run api`.
- Health check: `/health` (timeout 120s).
- Restart on failure, up to 5 retries.

Run the worker as a second Railway service using `railway.worker.toml`
(`startCommand = "npm run worker"`). Both services share the same environment
variables and database. The API service alone will not process the durable
queue; the worker service is required for autonomous operation.

### Environment variables

Set every variable from `.env.example` in the platform's variable store, not in
the repo. Never commit `.env`. Required names:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres (pooled) connection string, `?schema=tareq` |
| `DIRECT_URL` | Direct (non-pooled) connection for migrations |
| `TAREQ_OWNER_EMAIL` / `TAREQ_OWNER_PASSWORD` | Primary owner credentials |
| `TAREQ_SESSION_SECRET` | Session signing material (>= 16 chars) |
| `DEEPSEEK_API_KEY` | DeepSeek provider key |
| `OPENAI_API_KEY` | OpenAI provider key (optional if DeepSeek is used) |
| `TAREQ_DEFAULT_PROVIDER` | `openai` or `deepseek` |
| `TAREQ_BUDGET_CAP_USD` / `TAREQ_BUDGET_WARN_USD` | Hard spend cap and warning |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_OWNER_ID` | Optional owner notifications |

### Rollback

Railway keeps the previous deployment; use "Redeploy" on the prior successful
build. Because state lives in Postgres, a rollback of the app does not revert
data. `preDeployCommand` runs `db push` (additive); avoid destructive schema
changes without a backup.


## Release checklist

1. `npm run typecheck` clean.
2. `npm test` all passing.
3. `npm run build` succeeds.
4. `/health?deep=1` reports database and providers healthy.
5. A dashboard login works and shows real data.

Deployment and `git push` require explicit owner approval.
