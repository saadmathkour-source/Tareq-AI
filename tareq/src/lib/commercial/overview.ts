import { prisma } from '../core/db.ts';
import { summary as financeSummary } from '../finance/ledger.ts';

/**
 * Commercial overview (Phase 16, group 11).
 *
 * Aggregates the Command Center's commercial view from real persisted records
 * only — products, orders, deliveries, leads, approvals and the verified ledger.
 * Nothing here is estimated or projected.
 */

export interface CommercialOverview {
  products: Array<{ slug: string; name: string; status: string; priceUsd: number; marginPct: number; orders: number; published: boolean }>;
  orders: Record<string, number>;
  ordersTotal: number;
  deliveries: { artifacts: number; validated: number; delivered: number };
  leads: { total: number; qualified: number; converted: number };
  outreach: { drafts: number; pendingApproval: number; sent: number };
  approvalsPending: number;
  revenue: { grossUsd: number; netUsd: number; netProfitUsd: number; testUsd: number };
  opportunities: Record<string, number>;
}

export async function commercialOverview(): Promise<CommercialOverview> {
  const [products, orderGroups, artifactAgg, validatedAgg, leads, leadGroups, outreachGroups, approvalsPending, revenue, oppGroups] =
    await Promise.all([
      prisma.product.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { orders: true } } } }),
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.deliveryArtifact.count(),
      prisma.deliveryArtifact.count({ where: { validated: true } }),
      prisma.lead.count(),
      prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.outreachDraft.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.approval.count({ where: { status: 'PENDING' } }),
      financeSummary(),
      prisma.opportunity.groupBy({ by: ['stage'], _count: { _all: true } }),
    ]);

  const orders: Record<string, number> = {};
  for (const g of orderGroups) orders[g.status] = g._count._all;
  const ordersTotal = Object.values(orders).reduce((a, b) => a + b, 0);

  const leadByStatus: Record<string, number> = {};
  for (const g of leadGroups) leadByStatus[g.status] = g._count._all;

  const outreach: Record<string, number> = {};
  for (const g of outreachGroups) outreach[g.status] = g._count._all;

  const opportunities: Record<string, number> = {};
  for (const g of oppGroups) opportunities[g.stage] = g._count._all;

  return {
    products: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      priceUsd: Number(p.priceUsd),
      marginPct: p.marginPct,
      orders: p._count.orders,
      published: p.status === 'PUBLISHED',
    })),
    orders,
    ordersTotal,
    deliveries: { artifacts: artifactAgg, validated: validatedAgg, delivered: orders['DELIVERED'] ?? 0 },
    leads: { total: leads, qualified: leadByStatus['QUALIFIED'] ?? 0, converted: leadByStatus['CONVERTED'] ?? 0 },
    outreach: { drafts: outreach['DRAFT'] ?? 0, pendingApproval: outreach['PENDING_APPROVAL'] ?? 0, sent: outreach['SENT'] ?? 0 },
    approvalsPending,
    revenue: {
      grossUsd: revenue.grossRevenueUsd,
      netUsd: revenue.netRevenueUsd,
      netProfitUsd: revenue.netProfitUsd,
      testUsd: revenue.testTransactionsUsd,
    },
    opportunities,
  };
}
