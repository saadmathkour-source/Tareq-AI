# TAREQ Recovery Guide

## Design for recovery

- Every unit of work is a durable row in `tasks` with a status, attempt count and
  idempotency key. A restart never loses queued work.
- A worker heartbeats long tasks. If a worker dies, `reclaimStale()` returns its
  tasks to the queue after the stale window.
- Retries are bounded with backoff; a task that exhausts them moves to
  `dead_letters` with its last error instead of looping forever.
- `idempotencyKey` prevents a duplicate task from doing the same external action
  twice.

## Recovering from a crash

1. Restart the worker (`npm run worker`). It reclaims stale tasks automatically.
2. Inspect `GET /tasks` for `RETRYING` or `FAILED` rows.
3. Inspect `GET /audit` — the hash chain shows what happened last.
4. Re-drive a dead letter by re-enqueuing its kind with the same payload.

## Emergency stop and resume

`POST /emergency-stop` sets mode OBSERVE, cancels queued tasks and revokes
sessions. To resume: sign in, review the audit log, set a mode
(`POST /mode`) and restart or keep the worker running.

## Database recovery

- Prisma migrations/db push are the schema source of truth (`prisma/schema.prisma`).
- Backups are the database provider's responsibility; enable them in the
  provider console.
- Never run a destructive migration or delete production data without explicit
  owner approval.

## Provider outage

If one model provider is down, `routeChat` falls back to the other configured
provider. If both are down, tasks fail retryably and stay in the queue until a
provider returns.
