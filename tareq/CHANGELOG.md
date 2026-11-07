# Changelog

## Unreleased — Autonomous Agent Activation & Complete Owner Command Center (2026-11-07)

### Added
- Owner-auth bypass (`TAREQ_AUTH_BYPASS=1`, default off) — a temporary
  lockout-recovery switch. When enabled it drops the dashboard sign-in screen
  and treats every owner-only route as owned, so a broken login can never lock
  the owner out of the command center. It is logged loudly at startup and the
  dashboard shell is marked `data-auth-bypass="1"`. It removes the last barrier
  between a public URL and owner powers (spend, outreach, publish), so it must
  be unset again as soon as access is restored.
- `src/lib/planner/intent.ts` — natural-language command interpreter. The owner
  can now type a goal in Arabic or English ("Research profitable problems in the
  US software market", "ابحث عن مشاكل مربحة في سوق البرمجيات") and it is routed to
  a plan template by deterministic keyword matching, with a topic extracted and
  threaded into research/lead steps. `/plan` no longer rejects free text.
- `src/lib/commercial/mission.ts` + `POST /mission` + `commercial.mission` worker
  handler — a real, bounded autonomous mission: DISCOVER → RESEARCH (live public
  sources) → EVIDENCE_COLLECTION → DEMAND_VALIDATION → BUYER_DISCOVERY →
  IDENTIFICATION → ECONOMIC_ANALYSIS → RISK_REVIEW → OFFER_DESIGN → PROTOTYPE →
  QUALITY_VERIFICATION. It stops before any owner-gated step (approval, outreach,
  conversion, payment) and never fabricates a number. Verified live: 20 HN
  signals → 3 evidence records → 15 buyers → offer priced → all gates passed.
- `src/lib/integrations/gmail.ts`, `hubspot.ts`, `stripe.ts` — real adapters that
  report honest configured/unconfigured status and refuse to act without
  credentials. Stripe includes signature-verified, idempotent webhook handling
  (`POST /webhooks/stripe`) that records revenue only after the HMAC checks out.
- `GET /integrations` and a dashboard Integrations panel.
- `POST /payments/link` — owner-authenticated endpoint that creates a real,
  payable Stripe Checkout link (live or test by key prefix). Verified live: a
  link was created and immediately expired, so nothing is left dangling. No
  revenue is recorded here; only the signature-verified webhook does that.
- Capability index upgraded to the five-value status vocabulary with
  description, dependencies and evidence per group; `/capabilities` summary and
  the dashboard gained status filtering and search.
- `tests/intent.test.ts`, `tests/integrations.test.ts`,
  `tests/capability-index.test.ts` (132 tests total, was 107).
- `tests/api-errors.test.ts` — the API maps typed errors to honest status codes
  (136 tests total).

### Fixed
- `src/lib/core/db.ts` — the owner dashboard fires ~13 parallel reads on load
  (`Promise.all` in `dashboard.html`), but the Supabase connection string ships
  `connection_limit=1`, so twelve queries queued on one connection and died with
  "Timed out fetching a new connection from the connection pool". The API had
  already authenticated, so the UI reported it as a **failed sign-in**. The pool
  is now raised to a floor of 10 (never lowered) with a 20s pool timeout, so a
  low configured limit can no longer deadlock the dashboard. Verified: 13/13
  parallel queries succeed (was 9/13).
- `src/app/server.ts` — the top-level catch block turned every thrown error into
  `500 internal error`, so a rejected login (wrong password or unknown email)
  looked like a server crash and returned 500 instead of 401. Errors are now
  mapped by type: `ForbiddenError` → 401 (uniform, never reveals whether the
  email exists), `ValidationError` → 400, other `TareqError` → 422, and only
  genuinely unexpected errors → 500. Extracted as a pure `statusForError()`
  helper so the mapping is unit-tested.
- `src/lib/core/audit.ts` — the hash-chained audit log hashed `metadata` with a
  raw `JSON.stringify`, but `metadata` is a Postgres `jsonb` column that does not
  preserve key order. Any entry with two or more metadata keys produced a hash
  that no longer matched on read-back, silently breaking the chain. Now uses a
  key-sorted canonical form; added `repairChain()` to re-derive existing rows.

## Unreleased — Targeted Production Readiness & Real-World Capability Audit (2026-11-07)

Ran a real-world capability audit (tasks 1-9) against the live database,
providers and public data sources. Every claim below was measured.

### Fixed
- `src/lib/queue/tasks.ts` — `claimNext` marked up to 20 rows `RUNNING` with
  `FOR UPDATE SKIP LOCKED` but returned only the first, leaking 19 stuck rows on
  every claim. Now claims exactly one row (`LIMIT 1`). High severity.
- `src/app/dashboard.html` — the finance panel read non-existent ledger fields
  (`collectedUsd/expensesUsd/netUsd`) and always rendered $0.00. Now uses the
  real `summary()` field names.
- `src/lib/sales/discovery.ts` — persisting discovered buyers/leads issued ~40
  sequential round-trips to the pooled database (measured 53s for 20 rows, and
  P2024 pool timeouts under concurrency). Rewritten to generate ids client-side
  and use `createMany`: ~4 queries, 6.8s for 20 rows, idempotent on re-run.

### Added
- `src/lib/integrations/buyers.ts`, `src/lib/sales/discovery.ts` — real buyer
  discovery from public Hacker News comments (public handles + permalinks only,
  no invented contacts), explainable scoring, duplicate detection by source URL.
- `tests/buyers.test.ts`; registered buyer-discovery tools and worker handlers.
- API endpoints `/leads /usage /errors /config /research` and matching dashboard
  panels (Leads, Research & opportunity reports, API usage & cost, Errors,
  Agent configuration) — completing the 16-item required dashboard surface.
- `scripts/gen-matrix.ts` and `docs/CAPABILITY_VERIFICATION_MATRIX.md` — the
  100-group verification matrix generated from the live capability index.
- `tareq/railway.worker.toml` and a `preDeployCommand` in `tareq/railway.toml`.

### Verified (measured, not claimed)
- Tests 105 -> 107 pass / 0 fail; typecheck clean; production build succeeds.
- Commercial acceptance test: 16/16, opportunity reaches `LEARNING`.
- DeepSeek live chat, JSON mode, routing and cost recording verified; automatic
  failover openai -> deepseek verified; OpenAI itself also returns real content.
- Buyer discovery produced 20 real candidate leads from live HN data, and a
  re-run created 0 duplicates.
- Capability matrix: 98 `VERIFIED_FUNCTIONAL`, 2 `PARTIAL`, 0 unverified.

## Unreleased — Phase 1 (2026-11-07)

Adopted the master directive; audited the existing implementation and corrected
inaccurate claims before extending it.

### Added
- `src/lib/integrations/publicdata.ts` — keyless public-data demand scan
  (Hacker News Algolia + Wikipedia). Free, no account, no API key.
- `src/lib/tools/index.ts` — registers the built-in tools. The registry was
  previously empty at runtime, so actions bypassed schema validation and audit.
- `src/app/dashboard.html` — a bilingual (AR/EN), responsive owner dashboard
  served at `/` by the API. All metrics come from persisted data.
- `worker/main.ts` — `commercial.demand_scan` handler; the market-research
  handler is now grounded in real public signals.
- `scripts/copy-assets.mjs` — copies the dashboard asset into `dist/` on build.
- `tests/publicdata.test.ts`, `tests/dashboard.test.ts`.
- The required documentation suite under `docs/`.

### Changed
- `commercial.market_research` records a confidence capped by the real public
  signal strength instead of trusting the model's self-reported confidence.
- Capability statuses: 9 (research) and 26 (dashboard) moved partial ->
  implemented, with the evidence recorded.

### Verified (measured, not claimed)
- 5,722 LOC across 37 TypeScript files; 26 database tables in the `tareq` schema.
- No SQLite fallback exists anywhere in the codebase.
- Both AI providers called for real and returned content, tokens and cost.
- 98 tests pass, 0 fail.

### Fixed
- Dashboard finance cards read the wrong ledger field names; corrected to
  `cashCollectedUsd`, `operatingCostsUsd`, `netProfitUsd`.

### Corrections to the previous report
- The prior report claimed "96 passing tests"; the measured count was 88 before
  this phase and is 98 after.
- The prior report implied a complete owner dashboard; no UI existed. It does
  now.

### Added — acceptance test
- `tests/acceptance.ts` + `npm run acceptance`: a self-contained commercial
  end-to-end test across the full lifecycle (16 checks, cleanup-verified).
