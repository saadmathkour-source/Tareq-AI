# TAREQ Testing Strategy

## Runner

`npm test` runs `node --test --experimental-strip-types tests/*.test.ts`. No
external test framework, no mocks for the core paths — tests exercise real code.

## Suites

- `tests/security.test.ts` — password hashing, sessions, the permission engine,
  budget enforcement, untrusted-output wrapping.
- `tests/commercial.test.ts` — the decision engine, proof ladder, offer forging,
  competitor prediction, risk portfolio, causality.
- `tests/capabilities.test.ts` — the groups 64-100 engines.
- `tests/publicdata.test.ts` — the demand-signal aggregation (deterministic; the
  live connectors are covered by the end-to-end test so the suite needs no net).
- `tests/dashboard.test.ts` — the dashboard ships no embedded data, talks only to
  the API, supports AR/EN, escapes untrusted values and exposes owner controls.

## Measured results (2026-11-07)

```
tests 98
pass  98
fail  0
```

This is the count at the time of writing. It is a measurement, not a guarantee.

## Failure scenarios exercised

Unit level: unsupported claim rejection, budget cap refusal, permission denial
by mode, retry/backoff and dead-lettering, stale-task reclamation, duplicate
task dedupe by idempotency key, provider error classification.

Integration level (live): both AI providers called for real; the demand-scan
handler run through the durable queue end-to-end; the dashboard served and its
authenticated endpoints exercised with a real owner login.

## What is not covered yet

- Payment-provider webhook handling (no provider configured).
- Email/CRM connectors (not implemented).
- Load/soak testing under many concurrent workers.

## Commercial end-to-end acceptance test

`npm run acceptance` runs `tests/acceptance.ts`, which walks one opportunity
through the full lifecycle using real code and a real database, then removes
everything it created. It is self-contained and safe to run repeatedly.

Measured run (2026-11-07):

```
 1. DISCOVER          public signals volume=20 recent=5 (real, keyless)
 2. RESEARCH          evidence recorded
 3. VALIDATE          proof rung=budget_acknowledged demandProof=true
 4. BUYER             buyer + lead created, lawfulBasis=public
 5. ECONOMIC          profit/unit=$1670 breakeven=2
 6. PRIORITIZE/RISK   kill=false riskAdjusted=$12024.00
 7. DESIGN            offer=$136.36 unsupportedClaimBlocked=true
 8. BUILD/TEST        qualityPassed=true
 9. APPROVAL          approval status=APPROVED (owner)
10. GATE-CHECK        OUTREACH blocked without 2nd evidence+quality
11. MARKET/SELL       outreach draft approved; nothing sent
12. CONVERT/DELIVER   deal WON $136.36
13. COLLECT           verified revenue $136.36
14. ACCOUNT           Δrevenue=$136.36 Δcost=$0.05 ΔnetProfit=$136.31
15. VERIFY/LEARN      outcomeVerified=true
16. INTEGRITY         auditChain ok=true stageEvents=16 finalStage=LEARNING
```

Cleanup verified: zero `ACCEPT-` rows left behind afterwards.
