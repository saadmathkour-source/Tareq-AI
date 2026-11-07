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
