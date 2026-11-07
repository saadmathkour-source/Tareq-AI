# TAREQ Agent Operations

## Operating modes

| Mode | Meaning | Acting tools |
|---|---|---|
| OBSERVE | Read-only. Analyse, never act. | none |
| PLAN | Build plans and memory. | planning only |
| SANDBOX | Build and test in isolation. | internal build/test |
| SUPERVISED | Act on approved work. | low-risk auto, sensitive needs approval |
| AUTONOMOUS | Act within configured limits. | low-risk auto, sensitive still needs approval |

Sensitive actions require an owner approval in every mode; no mode removes that.

## The orchestrator

`src/lib/core/orchestrator.ts` runs the loop:

1. `drain()` the event bus.
2. Every N ticks, `reclaimStale()` to recover tasks from a crashed worker.
3. `claimNext()` one durable task.
4. Dispatch to a registered handler (heartbeating every 15s).
5. `succeed()` or `fail()` — the queue applies bounded retry/backoff, then a
   dead letter.

Unknown task kinds fail immediately (a programming error is not retried).

## Specialised agents

`src/lib/core/subagents.ts` defines the subordinate agents (market research,
demand validation, buyer intelligence, competitor analysis, product builder,
service design, sales strategy, outreach assistant, customer success, finance
analyst, legal/policy reviewer, security reviewer, QA, performance analyst,
memory curator). Each has a role, a system prompt, an allow-list of tools and a
per-run cost cap. No sub-agent may bypass the central permission engine.

## Scheduled maintenance

`src/lib/queue/scheduler.ts` seeds recurring work: memory pruning, evidence
freshness checks and the maintenance cycle. These keep the agent healthy without
an open browser.

## Approval workflow

When a handler needs a sensitive action it calls `authorize()`. With no approval,
the engine creates an `Approval` row and the handler stops. The owner decides in
the dashboard (`/approvals/decide`); on the next run the handler proceeds with
the approval id.

## Emergency stop

`POST /emergency-stop` sets mode OBSERVE, cancels queued tasks and revokes
sessions. Recovery: sign in again, review the audit log, set a mode and resume.
