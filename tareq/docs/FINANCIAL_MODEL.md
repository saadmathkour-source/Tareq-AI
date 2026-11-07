# TAREQ Financial Model

## Hard budget ceiling

The additional project and operating budget is capped at **USD 20 total**. This
is a ceiling, not a target. `src/lib/security/budget.ts` holds a single global
`Budget` row with `capUsd` (default 20) and `warnUsd` (default 15).

- `assertCanSpend(projected, what)` refuses a spend that would cross the cap.
- `recordSpend(amount, what)` records actual spend and warns once at the
  threshold.
- Raising the cap is an approval-gated action (`budget.raise`).

## What counts as revenue

Only a payment provider's verified confirmation counts. `recordRevenue()` in
`src/lib/finance/ledger.ts` requires both an `externalId` and non-empty
verification `evidence`, otherwise it throws. Therefore:

- An invoice is not a payment.
- A payment link is not a payment.
- A pending transaction is not collected revenue.
- A simulated transaction is not real revenue.

## Ledger kinds

`REVENUE_CONFIRMED`, `PAYMENT_PENDING`, `REFUND`, `FEE`, `TAX_ESTIMATE`,
`AI_COST`, `HOSTING_COST`, `TOOL_COST`, `MARKETING_COST`, `DELIVERY_COST`.

## Roll-up (`summary()`)

- `grossRevenueUsd` = confirmed revenue.
- `netRevenueUsd` = gross - refunds - fees.
- `operatingCostsUsd` = sum of all cost kinds including fees.
- `contributionMarginUsd` = net revenue - operating costs.
- `netProfitUsd` = contribution margin - tax estimate.
- `cashCollectedUsd` = confirmed revenue only.
- `outstandingUsd` = pending payments.
- `refundExposureUsd` = refunds to date.

## Cost sources

- AI calls: per-call tokens and cost recorded by the provider layer.
- Hosting and tools: recorded explicitly as ledger entries when they occur.
- Marketing: recorded as `MARKETING_COST`; `acquisitionMetrics()` derives CAC
  from real ledger rows and the lead count.

## Honesty rules

- The dashboard shows only persisted ledger values; nothing is synthesised.
- Test data is labelled `TEST DATA`.
- No revenue is projected as guaranteed; the goal is the shortest realistic path
  to the first legitimate paying customer.
