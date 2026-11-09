# TAREQ Execution Log

Reverse-chronological. Every entry records what was actually run and observed.

## 2026-11-07 — Targeted production-readiness & real-world capability audit

### TASK 1 — real market research (live external calls)
- HN Algolia + Wikipedia fetched live; real URLs, dates and text returned.
- Finding: multi-term AND queries can return 0 hits while the capability works
  for other query shapes; confidence correctly capped at 0.5.

### TASK 2 — real buyer discovery (live external calls + persistence)
- Built `src/lib/sales/discovery.ts` + `src/lib/integrations/buyers.ts`.
- Live discovery from public HN comments produced 20 real candidate leads;
  re-running created 0 duplicates (idempotent). Public handles/permalinks only.

### TASK 3 — real service execution
- `npm run acceptance` -> PASSED 16/16; ledger deltas: revenue $136.36,
  cost $0.05, net $136.31. Runs are clearly marked sandbox/test transactions.

### TASK 4 — dashboard/API audit (16 required items)
- Fixed the finance-panel field bug; added `/leads /usage /errors /config
  /research` and the matching panels. All 16 items now present and working.

### TASK 5 — persistent autonomous execution
- Fixed `claimNext` (was leaking 19 stuck rows per claim).
- Verified: idempotency, retry, dead-letter, stale reclaim, and a real restart
  test (task persisted PENDING -> fresh worker -> SUCCEEDED).

### TASK 6 — AI providers
- DeepSeek: live chat, JSON mode, routing, cost recording — all verified.
- OpenAI: a real completion also succeeded during the audit.
- Failover: unsetting the OpenAI key routed the request to DeepSeek.

### TASK 7 — 100-capability matrix
- Generated `docs/CAPABILITY_VERIFICATION_MATRIX.md`: 98 VERIFIED_FUNCTIONAL,
  2 PARTIAL (13 product building, 27 integrations), 0 unverified.

### TASK 8 — GitHub + Railway readiness
- Push 403 diagnosed: the token is fine-grained and lacks **Contents: write**.
  Fix: grant Repository permissions -> Contents: Read and write.
- Hardened Railway config: `preDeployCommand`, worker service config, env table.

### TASK 9 — first-dollar path
- Trace: research -> demand -> offer -> approval -> outreach -> delivery ->
  collection. First missing link: **no payment provider configured**, so no real
  revenue can be collected yet (see KNOWN_LIMITATIONS #1).

### Verification totals
- `npm test` 107 pass / 0 fail; `tsc --noEmit` clean; `npm run build` OK;
  acceptance 16/16; buyer discovery 20 real leads, 0 duplicates on re-run.

## 2026-11-07 — Phase 1: adoption, audit, functional completion

### Baseline verification (Phase 0)
- `find`/`wc` — 37 TS files, 5,722 LOC.
- `npm test` — 88 pass, 0 fail (report had claimed 96).
- DB inspection — 26 tables in schema `tareq`; row counts non-trivial.
- SQLite grep — none; no SQLite fallback exists.
- Provider calls — OpenAI and DeepSeek both returned `content="OK"` with token
  counts and cost (openai $0.0000027, deepseek $0.0000041).
- Dashboard grep — no UI files existed.

### Work performed
1. Built `src/lib/integrations/publicdata.ts`; live-scanned
   "invoicing software for freelancers" -> volume 15, recent 5, confidence 0.27.
2. Wired the tool registry (`src/lib/tools/index.ts`); confirmed 2 tools
   registered and callable.
3. Built and served the dashboard; verified `GET /` -> 200 (20,310 bytes) and
   all seven authenticated endpoints it uses -> 200 with a real owner login.
4. Ran a real task through the durable queue: `commercial.demand_scan` ->
   SUCCEEDED with `{volume:9}` from live public data.
5. Added tests; suite went 88 -> 98, all passing.
6. Verified the production build copies and serves the dashboard asset.
7. Wrote the 15 required documentation files.

### Commands of record
```
npm test                      -> tests 98 / pass 98 / fail 0
npx tsc --noEmit              -> clean
npm run build                 -> success; copied dashboard asset
curl /                        -> HTTP 200, 20310 bytes
curl /health?deep=1 (auth)    -> HTTP 200
```

### Financial
- Spend this phase: model calls during verification, well under $0.001.
- Budget cap: USD 20. No paid service purchased.

### Blockers (require owner decision)
- New dedicated repository vs. the existing `tareq/` subproject location.
- Dedicated Postgres instance vs. the `tareq` schema on a shared instance.
- A payment provider for real collections.
- `git push` and deployment are prohibited without explicit approval.

### Commercial acceptance test (Phase 3)
- `npm run acceptance` — 16/16 checks passed; the opportunity reached LEARNING.
- Stage gates proved: an unsupported OUTREACH advance was blocked; the
  unsupported-claim gate blocked an unverified claim while the verified claim
  passed.
- Ledger deltas proved the run: Δrevenue $136.36, Δcost $0.05, ΔnetProfit $136.31.
- Cleanup verified: 0 residual rows.

---

## Phase 16 — Autonomous commercial operation (products, orders, delivery, revenue)

Built the commercial layer on top of the existing engine (no rebuild): a product
catalog + factory, honest landing pages, a purchase lifecycle, service delivery,
financial reporting and dashboard surfaces. Real, verifiable plumbing only.

### What was added
- `src/lib/commercial/products.ts` — catalog + idempotent factory. One product is
  published for the first launch (`market-opportunity-report`, $149); two more are
  seeded as DRAFT (not sellable) to avoid over-promising.
- `src/lib/commercial/landing.ts` — dependency-free landing generator. States price,
  deliverables, requirements, delivery steps and **honest limitations**. No
  testimonials, badges or certifications (we have none).
- `src/lib/commercial/orders.ts` — purchase lifecycle
  (`CREATED → AWAITING_PAYMENT → PAID → IN_DELIVERY → DELIVERED`, plus `FAILED`/`REFUNDED`).
  `markPaid()` is the only transition to PAID and is idempotent; it enqueues
  delivery exactly once (keyed by order id).
- `src/lib/commercial/delivery.ts` — delivery engine. Builds a source-cited
  opportunity report from real public research (Hacker News + Wikipedia via
  `publicdata`) and the deterministic commercial engines; a model drafts only the
  narrative. QA gate: a report with no sources is rejected and the order is FAILED,
  never DELIVERED.
- `src/lib/finance/report.ts` — daily/monthly report + product P&L from ledger rows.
- `src/lib/commercial/overview.ts` — Command Center commercial aggregates from real records.
- `src/app/storefront.ts` — public `/shop`, `/buy/:slug`, `/thanks`, `/legal/{terms,privacy,refunds}`, `/robots.txt`.
- Owner routes: `GET /commercial/overview`, `GET/POST /products*`, `GET/POST /orders`,
  `POST /orders/checkout`, `GET /orders/artifact`, `GET /finance/report`.
- Stripe webhook now activates the matching order from a **signature-verified**
  live payment (`client_reference_id` = order id); this is the only place an order
  becomes PAID. Test-mode completions never touch revenue or orders.
- Dashboard: new "Commercial operation" section (products, orders, deliveries,
  checkout creation, catalog seeding). EN/AR strings added.
- Schedules: `product.seed_catalog` (daily) and `finance.daily_report` (daily).

### Commands of record
```
npx prisma db push            -> "already in sync"; Prisma Client regenerated
npx tsc --noEmit              -> clean
npm run build                 -> success; dashboard asset copied
npm test                      -> tests 190 / pass 190 / fail 0 (was 179; +11 new)
curl /shop, /buy/:slug, /legal/terms, /thanks, /robots.txt -> HTTP 200
curl /commercial/overview, /products (unauth) -> HTTP 401
curl /commercial/overview, /orders, /finance/report (owner) -> HTTP 200
```

### Honesty
- Real collected revenue remains $0 until a live Stripe payment is verified.
- No revenue, customer or conversion is claimed or guaranteed anywhere.
- Draft products are not reachable from the storefront and cannot be ordered.

### Blockers (require owner action)
- A live Stripe webhook endpoint must be registered to the production URL.
- Outbound acquisition (sending) still requires per-item owner approval.

---

## Phase 16.1 — Live Stripe webhook verification & first-sale readiness

Verified the production Stripe integration end to end and fixed the defects the
verification exposed. No real charge, refund or secret change was made.

### Environment variable (exact name)
- **`STRIPE_WEBHOOK_SECRET`** — the endpoint signing secret (`whsec_…`). Read in
  `src/lib/integrations/stripe.ts`, declared in `src/lib/env.ts`, documented in
  `.env.example`. Without it the route refuses every request (400).

### Defects found and fixed
1. **Revenue would have failed to record for every real product sale.** The
   webhook passed the Checkout Session's `client_reference_id` (the **order id**)
   into the ledger's `dealId` column, which is a foreign key to the `Deal` table.
   Postgres rejected the insert, so a genuine $149 payment would not have been
   recorded as revenue. Fixed: the order reference is kept in the ledger
   `evidence` (`orderRef`) instead of the FK; the field was renamed to `orderRef`
   to stop the two ids being conflated again.
2. **`payment_status` was not required.** A `checkout.session.completed` with
   `payment_status != 'paid'` could have been recognised. Now any non-`paid`
   status is ignored (the payment stays outstanding).
3. **Refunds and disputes were not handled.** `charge.refunded` /
   `charge.dispute.*` were ignored, so refunded money stayed in gross revenue.
   Added: a `DISPUTE` ledger kind, refund/dispute classification, `REFUND`/
   `DISPUTE` rows reduce **net** revenue, refund exposure is surfaced, and the
   matching order is marked `REFUNDED`.
4. **Crash window between recording revenue and activating the order.**
   Order activation was skipped when a ledger row already existed. Now the
   activation step re-runs on every delivery attempt (idempotently), so a crash
   after the revenue row cannot strand a paying customer.
5. **Amount/currency consistency was not enforced before PAID.** Added: the
   order is activated only when currency matches and the amount matches to
   within one cent; a mismatch is logged + audited and the order stays unpaid
   (real collected money is still recorded).
6. **Test-isolation bug (Phase 16 tests).** `tests/commercial-ops.test.ts` tagged
   its tasks `QTEST16-`, which does not match the worker's exclusion prefix
   `QTEST-`, so the live production worker could claim a test's delivery task.
   Fixed to `QTEST-16-`; orphaned rows were deleted.

### Behaviour (verified)
- Signature: HMAC-SHA256 over `${t}.${rawBody}`, constant-time compare; missing,
  malformed or forged signatures are rejected and record nothing.
- `livemode` is authoritative: only live-mode events are revenue; test-mode
  completions are `TEST_TRANSACTION` (never revenue, never activate an order).
- Supported events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `payment_intent.payment_failed`, `charge.refunded`/`charge.refund.updated`/
  `refund.updated`, `charge.dispute.created`/`.updated`/`.closed`.
- Matching: `client_reference_id` (order id); refund/dispute matched by the
  stored PaymentIntent id.
- Idempotency: ledger unique `externalId`, `markPaid` status guard and the
  delivery task idempotency key — each independently prevents duplicates.

### Commands of record
```
npx tsc --noEmit     -> clean
npm run build        -> success; dashboard asset copied
npm test             -> tests 203 / pass 203 / fail 0 (was 190; +13)
```

### Honesty
- No real charge, refund or dispute was created; every test used a signed,
  live-mode fixture against an isolated per-test webhook secret.
- Real collected revenue remains $0. The first genuine LIVE payment is
  **NOT YET VERIFIED** until Stripe delivers a signed event to production and
  the matching order is processed.

### Blockers (require owner action)
- Register the production endpoint in Stripe → Developers → Webhooks:
  URL `https://tareq-ai-production.up.railway.app/webhooks/stripe`, events
  `checkout.session.completed` (and the refund/dispute/async events above), then
  put its signing secret in Railway as `STRIPE_WEBHOOK_SECRET`.

### Incident: test leakage into the production database (found & fixed)
While verifying the live financial report, `grossRevenueUsd` read **$746** against
8 orders — none of them real. The integration tests share the production
database, and two runs that were killed at the 180 s tool timeout never reached
their cleanup hook, leaving 6 `REVENUE_CONFIRMED` rows (and 8 orders, 4 tasks, 5
orphaned `DELIVERY_COST` rows) that the reporting layer counted as real revenue.

Fixed:
- Deleted the leaked rows; the ledger now contains only the single pre-existing
  `it_test_pi_1` fixture row (classified as test volume). Real collected revenue
  is **$0**.
- `tests/stripe-webhook.test.ts` now uses an external id that contains Stripe's
  `_test_` marker, so even a killed run cannot be counted as commercial revenue
  (`isTestExternalId` catches it), and it purges any prior run's residue in a
  `test.before` hook.
- Verified afterwards: 0 `QTEST-16.1` ledger rows, 0 tasks, 0 orders.

Lesson recorded in `AGENTS.md`: any test that can enqueue or record against the
shared database must (a) tag tasks with `QTEST-` and (b) mark revenue external
ids with `_test_`, so a crash cannot corrupt production reporting.

## Phase 16.2 — Final live-payment readiness verification

### Test isolation (was the root cause of the $746 phantom)
DB-writing tests shared the production database. Fixed structurally:
- Created an isolated database `tareq_test` in the same Supabase project.
- `src/lib/core/db.ts` now resolves its URL through `resolveDatabaseUrl()`:
  when `TAREQ_USE_TEST_DB=1` (set by `npm test`) it connects to
  `TEST_DATABASE_URL`; if that is missing or equals `DATABASE_URL` it THROWS and
  the tests do not run (fail-closed). The server/worker never set the flag.
- `scripts/test-db-setup.sh` (`npm run test:db:setup`) creates/syncs/seeds the
  test DB; `TEST_DATABASE_URL`/`TEST_DIRECT_URL` documented in `.env.example`.
- Proof: the full suite (213 tests) ran with production at ledger=0/orders=0 and
  production was byte-for-byte unchanged afterwards; all writes landed in
  `tareq_test`. The stripe-webhook purge prefix was narrowed from `QTEST-` to
  `QTEST-16.1` so it can no longer delete another file's parallel-run tasks.

### Stripe LIVE endpoint
- Account `acct_1UPjwFPjQIhnOPY0` (US, USD). Endpoint
  `we_1UZsqUPjQIhnOPY0sqmD2S3Q` → `https://tareq-ai-production.up.railway.app/webhooks/stripe`,
  status `enabled`, `livemode=true`, created 2026-11-09 13:42:50Z.
- Enabled events were aligned with the handler's supported set:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `payment_intent.payment_failed`,
  `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`,
  `charge.dispute.updated`, `charge.dispute.closed`.

### Refunds & disputes (hardened)
- Partial refunds: only the refunded portion reduces net; a partial refund no
  longer closes the order.
- Refund events are keyed by the underlying charge, so `charge.refunded` and
  `refund.updated` collapse to one row and a later higher cumulative amount
  updates it (no double reduction).
- Disputes are keyed by dispute id (created/updated/closed → one row). A dispute
  resolved in the merchant's favour (`status: won`) records a
  `DISPUTE_REVERSAL` that restores net revenue and clears refund exposure.

### Ledger vs Stripe LIVE reconciliation
- Stripe LIVE: 0 charges, 0 payment_intents, 0 refunds, 0 disputes, 0
  `checkout.session.completed` events — no LIVE payment has ever succeeded
  (only expired sessions exist).
- Production ledger: 0 rows; `summary()` reports gross $0, net $0. The last
  pre-existing test fixture (`it_test_pi_1`) and 2 stray `QTEST` delivery tasks
  from an earlier killed run were removed.

### Blocker found: production webhook signature verification
A correctly-signed `ping` event is rejected by production
(`signature verification failed`, HTTP 400) while the same secret verifies
against a local server running the same code. The running Railway process
started 2026-11-08 16:15Z, before the LIVE endpoint existed (created
2026-11-09 13:42Z). A fresh deploy of `733607f` (verified live) did NOT change
the result, so the `STRIPE_WEBHOOK_SECRET` value configured in Railway does not
match this endpoint's signing secret — the value itself must be corrected in the
Railway dashboard (Stripe → Webhooks → `we_1UZsqUPjQIhnOPY0sqmD2S3Q` → Reveal
signing secret), then the service restarted. Until a real Stripe LIVE delivery
is accepted with HTTP 200, first-sale readiness is NOT claimed.
