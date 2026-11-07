# TAREQ Security Model

## Principles

- Least privilege: every acting tool maps to an action class with a minimum mode.
- Owner-only control: there is exactly one owner identity. No route lets a
  non-owner issue admin commands, and the agent's own credentials cannot call
  the owner API.
- Fail closed: an unconfigured integration is skipped, never silently bypassed.
- External content is data, never instructions.

## Authentication

- Owner login: `POST /auth/login` (email + password).
- Passwords are stored as salted scrypt hashes (`src/lib/security/owner-auth.ts`).
- Sessions are opaque tokens stored hashed in the `sessions` table with an
  expiry; `POST /auth/logout` revokes one, `POST /auth/revoke-all` revokes all.
- Every route except `/health` and `/auth/login` requires a valid session.

## Permission engine (`src/lib/security/permissions.ts`)

Two independent gates on every action:

1. **Operating mode** — `OBSERVE < PLAN < SANDBOX < SUPERVISED < AUTONOMOUS`.
   A mode forbids any action whose `minMode` it does not reach.
2. **Action class** — some classes always require an explicit owner approval,
   in every mode. The agent can never grant these to itself.

Always-approval classes: `outreach.send`, `offer.publish`, `contract.propose`,
`spend.commit`, `payment.refund`, `payment.transfer`, `budget.raise`,
`production.change`, `data.delete`, `permission.change`, `secrets.access`,
`revenue.reinvest`.

When approval is required and none exists, an `Approval` row is created and an
`ApprovalRequiredError` is raised. The action cannot proceed until the owner
decides it in the dashboard.

## Budget enforcement (`src/lib/security/budget.ts`)

A single global `Budget` row holds the hard cap (default USD 20). Every spend
path calls `assertCanSpend()` before and `recordSpend()` after, so a run that
would cross the cap is refused before it costs anything. Raising the cap is an
approval-gated action.

## Prompt-injection defence

- Tool output is validated with zod before use.
- Untrusted tool output is wrapped by `wrapUntrusted()` so a model treats it as
  data. The research connectors label fetched content as untrusted in the prompt.
- Models are instructed to output JSON only, and output is parsed strictly.

## Audit

`src/lib/core/audit.ts` writes a hash-chained log: each entry's hash covers the
previous entry's hash, so tampering is detectable. `GET /audit` returns the
chain verification result and the recent entries.

## Emergency stop

`POST /emergency-stop` drops the mode to `OBSERVE`, cancels all queued work and
revokes all sessions. It is available only to an authenticated owner.

## Secrets

- Secrets live only in environment variables, never in the repo.
- Health output reports presence as booleans only (`openai:true`), never values.
- `.env` is git-ignored; `.env.example` documents the required keys.
