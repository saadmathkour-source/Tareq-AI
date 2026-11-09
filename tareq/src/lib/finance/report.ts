import { prisma } from '../core/db.ts';
import { summary as ledgerSummary, type FinancialSummary } from './ledger.ts';

/**
 * Financial intelligence (Phase 16, group 8).
 *
 * Daily/monthly reporting and product-level P&L, derived entirely from ledger
 * rows and orders. Every figure traces to source records; projected revenue is
 * never mixed with collected revenue (the ledger enforces that split).
 */

export interface ProductPnl {
  slug: string;
  name: string;
  priceUsd: number;
  costUsd: number;
  orders: number;
  delivered: number;
}

export interface FinancialReport {
  period: { from: string; to: string; label: 'daily' | 'monthly' | 'all' };
  summary: FinancialSummary;
  products: ProductPnl[];
  ordersByStatus: Record<string, number>;
  aiSpendUsd: number;
  deliveryCostUsd: number;
  note: string;
}

function sinceMs(label: 'daily' | 'monthly' | 'all'): number {
  if (label === 'daily') return Date.now() - 24 * 3600_000;
  if (label === 'monthly') return Date.now() - 30 * 24 * 3600_000;
  return 0;
}

export async function financialReport(label: 'daily' | 'monthly' | 'all' = 'all'): Promise<FinancialReport> {
  const from = new Date(sinceMs(label));

  const [summary, products, orderGroups, aiAgg, deliveryAgg] = await Promise.all([
    ledgerSummary(),
    prisma.product.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { orders: true } } } }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ledgerEntry.aggregate({ where: { kind: 'AI_COST', occurredAt: { gte: from } }, _sum: { amountUsd: true } }),
    prisma.ledgerEntry.aggregate({ where: { kind: 'DELIVERY_COST', occurredAt: { gte: from } }, _sum: { amountUsd: true } }),
  ]);

  const ordersByStatus: Record<string, number> = {};
  for (const g of orderGroups) ordersByStatus[g.status] = g._count._all;

  const deliveredByProduct = await prisma.order.groupBy({
    by: ['productId'],
    where: { status: 'DELIVERED' },
    _count: { _all: true },
  });
  const deliveredMap = new Map(deliveredByProduct.map((d) => [d.productId, d._count._all]));

  return {
    period: { from: from.toISOString(), to: new Date().toISOString(), label },
    summary,
    products: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      priceUsd: Number(p.priceUsd),
      costUsd: Number(p.costUsd),
      orders: p._count.orders,
      delivered: deliveredMap.get(p.id) ?? 0,
    })),
    ordersByStatus,
    aiSpendUsd: Number(aiAgg._sum.amountUsd ?? 0),
    deliveryCostUsd: Number(deliveryAgg._sum.amountUsd ?? 0),
    note:
      'Collected revenue counts only signature-verified Stripe payments. Pending, failed, refunded and ' +
      'test-mode transactions are excluded by the ledger. Costs are recorded as they occur.',
  };
}
