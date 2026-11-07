# Changelog

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
