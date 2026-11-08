import { prisma } from '../core/db.ts';
import { ValidationError } from '../core/errors.ts';

/**
 * Finance ledger.
 *
 * The single most important rule here: revenue is recorded ONLY after a payment
 * provider confirms collection. `recordRevenue` requires an `externalId` and a
 * verification reference, so a checkout page or an invoice can never be counted
 * as income. Everything else (fees, refunds, costs, tax estimates) is a
 * separate ledger kind, keeping gross/net/contribution numbers honest.
 */

export type LedgerKind =
  | 'REVENUE_CONFIRMED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'TEST_TRANSACTION'
  | 'REFUND'
  | 'FEE'
  | 'TAX_ESTIMATE'
  | 'AI_COST'
  | 'HOSTING_COST'
  | 'TOOL_COST'
  | 'MARKETING_COST'
  | 'DELIVERY_COST';

export interface EntryInput {
  kind: LedgerKind;
  amountUsd: number;
  provider?: string;
  externalId?: string;
  dealId?: string;
  evidence?: Record<string, unknown>;
  occurredAt?: Date;
}

/** Record any non-revenue movement (costs, fees, refunds, pending). */
export async function record(input: EntryInput): Promise<string> {
  const row = await prisma.ledgerEntry.create({
    data: {
      kind: input.kind,
      amountUsd: input.amountUsd,
      provider: input.provider ?? null,
      externalId: input.externalId ?? null,
      dealId: input.dealId ?? null,
      evidence: (input.evidence ?? {}) as never,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
  return row.id;
}

/**
 * Record confirmed revenue. Rejects unless an external payment id and a
 * verification reference are supplied — this is the "webhook-verified" gate.
 */
export async function recordRevenue(input: {
  amountUsd: number;
  externalId: string;
  provider: string;
  dealId?: string;
  evidence: Record<string, unknown>;
}): Promise<string> {
  if (!input.externalId) throw new ValidationError('Revenue requires a payment provider externalId');
  if (!input.evidence || Object.keys(input.evidence).length === 0) {
    throw new ValidationError('Revenue requires verification evidence (webhook payload reference)');
  }
  const row = await prisma.ledgerEntry.create({
    data: {
      kind: 'REVENUE_CONFIRMED',
      amountUsd: input.amountUsd,
      provider: input.provider,
      externalId: input.externalId,
      dealId: input.dealId ?? null,
      evidence: input.evidence as never,
      verifiedAt: new Date(),
    },
  });
  return row.id;
}

export interface FinancialSummary {
  grossRevenueUsd: number;
  netRevenueUsd: number;
  operatingCostsUsd: number;
  contributionMarginUsd: number;
  netProfitUsd: number;
  cashCollectedUsd: number;
  outstandingUsd: number;
  refundExposureUsd: number;
  taxEstimateUsd: number;
  /** Stripe test-mode payments. Never counted as commercial revenue. */
  testTransactionsUsd: number;
  /** Confirmed payments that later failed to settle. */
  failedPaymentsUsd: number;
  byKind: Record<string, number>;
}

const COST_KINDS: LedgerKind[] = ['AI_COST', 'HOSTING_COST', 'TOOL_COST', 'MARKETING_COST', 'DELIVERY_COST', 'FEE'];

/** Roll the ledger up into the numbers the dashboard and group 59/60 report. */
export async function summary(): Promise<FinancialSummary> {
  const grouped = await prisma.ledgerEntry.groupBy({ by: ['kind'], _sum: { amountUsd: true } });
  const byKind: Record<string, number> = {};
  for (const g of grouped) byKind[g.kind] = Number(g._sum.amountUsd ?? 0);

  // Revenue requires BOTH kind = REVENUE_CONFIRMED AND a verifiedAt stamp. A row
  // without verification is not income, no matter how it was labelled.
  const confirmed = await prisma.ledgerEntry.aggregate({
    where: { kind: 'REVENUE_CONFIRMED', verifiedAt: { not: null } },
    _sum: { amountUsd: true },
  });
  const grossRevenueUsd = Number(confirmed._sum.amountUsd ?? 0);
  const refunds = byKind['REFUND'] ?? 0;
  const fees = byKind['FEE'] ?? 0;
  const taxEstimateUsd = byKind['TAX_ESTIMATE'] ?? 0;
  const operatingCostsUsd = COST_KINDS.reduce((acc, k) => acc + (byKind[k] ?? 0), 0);

  const netRevenueUsd = grossRevenueUsd - refunds - fees;
  const contributionMarginUsd = netRevenueUsd - operatingCostsUsd;
  const netProfitUsd = contributionMarginUsd - taxEstimateUsd;

  return {
    grossRevenueUsd,
    netRevenueUsd,
    operatingCostsUsd,
    contributionMarginUsd,
    netProfitUsd,
    cashCollectedUsd: grossRevenueUsd, // only confirmed revenue is counted as collected
    outstandingUsd: byKind['PAYMENT_PENDING'] ?? 0,
    refundExposureUsd: refunds,
    taxEstimateUsd,
    testTransactionsUsd: byKind['TEST_TRANSACTION'] ?? 0,
    failedPaymentsUsd: byKind['PAYMENT_FAILED'] ?? 0,
    byKind,
  };
}

/** Cost per acquisition inputs (groups 59/88) from real ledger rows only. */
export async function acquisitionMetrics(): Promise<{ leads: number; costUsd: number; cacUsd: number | null }> {
  const leads = await prisma.lead.count();
  const marketing = await prisma.ledgerEntry.aggregate({
    where: { kind: { in: ['MARKETING_COST'] } },
    _sum: { amountUsd: true },
  });
  const costUsd = Number(marketing._sum.amountUsd ?? 0);
  return { leads, costUsd, cacUsd: leads > 0 ? costUsd / leads : null };
}
