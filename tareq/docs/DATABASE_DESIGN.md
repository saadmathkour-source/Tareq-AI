# TAREQ Database Design

- Engine: PostgreSQL. ORM: Prisma 6 (`prisma/schema.prisma`).
- Schema: `tareq` (dedicated, isolated from any other application).
- No SQLite fallback exists. The connection URL is parsed by Prisma from
  `DATABASE_URL`; a missing or invalid URL fails loudly at first query.

## Tables (28)

Identity and control
- `owners` — the single owner identity (email + password hash).
- `sessions` — hashed session tokens with expiry.
- `settings` — key/value config, including the current operating mode.
- `budgets` — the global spend cap, spend-to-date and warn threshold.
- `control_settings` — the owner's autonomy and cost controls (daily/monthly
  budget, per-task cost cap, ad-spend cap, max discount, permission toggles and
  the emergency stop), read at the point of spend.

Work execution
- `tasks` — durable queue rows: kind, payload, status, priority, attempts,
  idempotency key, dependencies, cost, result, error.
- `task_attempts` — per-attempt history for a task.
- `dead_letters` — tasks that exhausted retries, with the last error.
- `schedules` — cron-like recurring triggers.
- `events` — the durable event bus backlog.
- `sub_agents` / `sub_agent_runs` — specialised agent definitions and their runs.
- `watchdog_alerts` — findings raised by the supervisor (stalled task, orphan
  dependency, dead letter, degraded agent, engaged kill switch), with severity,
  status, the action taken and the resolution time.

Memory and evidence
- `memory_records` — working/long-term/market/experiment/strategy/failure memory
  with `epistemic` (fact | estimate | hypothesis), source, confidence, expiry.
- `claims` — the pre-sale evidence vault; `publishable` + `verified_at` gate
  what may be used externally.

Commercial
- `opportunities` — discovered problems with a `genome` JSON fingerprint and
  stage; `stage_events` records stage transitions.
- `buyers`, `leads`, `outreach_drafts` — buyer intelligence and outreach that
  stays a draft until approved.
- `offers`, `deals` — offers and the sales pipeline.
- `experiments` — controlled experiments and their measured results.
- `assets` — reusable commercial assets and their yield.

Finance
- `ledger_entries` — every money movement by `kind`; revenue rows require an
  external payment id and verification evidence.
- `provider_calls` — model calls with tokens and cost for accounting.
- `approvals` — owner decisions required before sensitive actions.
- `audit_logs` — the hash-chained audit trail.

## Integrity

- Unique constraints: `settings.key`, `budgets.scope`, `tasks.idempotencyKey`,
  `memory_records (kind, scope, key)`, `owners.email`.
- Foreign keys link attempts to tasks, runs to sub-agents, and stage events to
  opportunities.
- Deletes are soft where they matter: tasks move to terminal statuses rather
  than being removed, so history survives.
