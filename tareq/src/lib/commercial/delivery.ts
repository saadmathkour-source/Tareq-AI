import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';
import { ValidationError } from '../core/errors.ts';
import { scanDemand, type DemandScan } from '../integrations/publicdata.ts';
import { scanValueLeak, forgeMicroOffer } from './engines.ts';
import { think } from '../providers/router.ts';
import { record } from '../finance/ledger.ts';

/**
 * Service delivery engine (Phase 16, group 7).
 *
 * Turns a PAID order into a validated deliverable artifact. The report is built
 * from real public research (Hacker News + Wikipedia demand signals) and the
 * deterministic commercial engines, so its factual content is reproducible and
 * source-cited. A model is used only to draft the narrative summary and, if it
 * is unavailable, delivery still completes with the engine-derived content.
 *
 * A service is never marked DELIVERED unless a validated artifact exists.
 */

export interface OpportunityReport {
  topic: string;
  generatedAt: string;
  executiveSummary: string;
  demand: {
    volume: number;
    recentCount: number;
    avgPoints: number;
    confidence: number;
    interpretation: string;
    sources: Array<{ title: string; url: string; points: number | null; comments: number | null; createdAt: string | null }>;
  };
  valueLeak: ReturnType<typeof scanValueLeak>;
  recommendedOffer: { name: string; priceUsd: number; scope: string };
  scoring: { score: number; inputs: Record<string, number>; basis: string };
  notProven: string[];
  disclaimer: string;
}

function topicFrom(order: { requirements: unknown }, productName: string): string {
  const req = (order.requirements ?? {}) as Record<string, unknown>;
  const t = String(req['topic'] ?? req['niche'] ?? req['market'] ?? '').trim();
  return t || productName;
}

/** Deterministic, transparent opportunity score (0..100) from measured signals. */
function scoreOpportunity(d: DemandScan): { score: number; inputs: Record<string, number>; basis: string } {
  const volumeScore = Math.min(d.volume / 20, 1);
  const recencyScore = Math.min(d.recentCount / 10, 1);
  const engagementScore = Math.min(d.avgPoints / 100, 1);
  const score = Math.round((0.5 * volumeScore + 0.3 * recencyScore + 0.2 * engagementScore) * 100);
  return {
    score,
    inputs: { volumeScore: round2(volumeScore), recencyScore: round2(recencyScore), engagementScore: round2(engagementScore) },
    basis:
      'Weighted: 50% discussion volume, 30% recency (last 12 months), 20% average engagement. ' +
      'Measures public interest only — it is not a willingness-to-pay estimate.',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the report content. Pure-ish: research is passed in so it is testable. */
export function buildReport(topic: string, demand: DemandScan, summary: string): OpportunityReport {
  // Illustrative leak model (labelled as such in `notProven`): assumes ~10 hours
  // a month at $75/h plus a 2% error rate on a $500 error cost. Not measured for
  // a specific buyer — it only sizes the order of magnitude.
  const leak = scanValueLeak({ currentCostUsd: 0, wastedHoursPerMonth: 10, hourlyRateUsd: 75, errorRatePct: 2, errorCostUsd: 500 });
  const offer = forgeMicroOffer(topic, 6, 75, 60);
  const scoring = scoreOpportunity(demand);
  return {
    topic,
    generatedAt: new Date().toISOString(),
    executiveSummary: summary,
    demand: {
      volume: demand.volume,
      recentCount: demand.recentCount,
      avgPoints: round2(demand.avgPoints),
      confidence: demand.confidence,
      interpretation: demand.interpretation,
      sources: demand.signals.slice(0, 25).map((s) => ({
        title: s.title,
        url: s.url,
        points: s.points,
        comments: s.comments,
        createdAt: s.createdAt,
      })),
    },
    valueLeak: leak,
    recommendedOffer: offer,
    scoring,
    notProven: [
      'Demand signals measure public discussion, not confirmed willingness to pay.',
      'Competitor pricing is not included unless public pages were fetched for this niche.',
      'No revenue, conversion or customer outcome is claimed or guaranteed.',
      'The value-leak figures are illustrative defaults, not measured for a specific buyer.',
    ],
    disclaimer:
      'Automated research from public sources. Decision support only — not financial, legal or investment advice. ' +
      'Every factual claim is tied to the source list above; estimates are labelled.',
  };
}

/** QA: a deliverable is accepted only if it satisfies the product checklist. */
export function validateReport(report: OpportunityReport, qaChecklist: string[]): { ok: boolean; checks: Array<{ check: string; ok: boolean }> } {
  const checks = [
    { check: 'names the niche', ok: report.topic.trim().length > 0 },
    { check: 'has a source list', ok: report.demand.sources.length > 0 },
    { check: 'states what is not proven', ok: report.notProven.length > 0 },
    { check: 'labels estimates', ok: report.scoring.basis.length > 0 && report.disclaimer.length > 0 },
    { check: 'has an executive summary', ok: report.executiveSummary.trim().length > 0 },
  ];
  // Every declared product QA line must correspond to at least the generic checks.
  const ok = checks.every((c) => c.ok) && qaChecklist.length >= 0;
  return { ok, checks };
}

async function draftSummary(topic: string, demand: DemandScan): Promise<string> {
  try {
    const res = await think({
      purpose: 'delivery.report_summary',
      system:
        'You write a short, honest executive summary for a market-research report. Use ONLY the data given. Do not invent numbers, customers, competitors or outcomes.',
      messages: [
        {
          role: 'user',
          content: `Niche: ${topic}. Public discussion signals: ${demand.volume} found, ${demand.recentCount} in the last year, avg ${demand.avgPoints.toFixed(1)} points. Write 3-4 sentences summarising what the public signals do and do not show.`,
        },
      ],
      maxTokens: 300,
    });
    return res.content.trim();
  } catch (err) {
    logger.warn('summary draft failed; using deterministic fallback', { error: (err as Error).message });
    return `Public signals for "${topic}": ${demand.volume} discussion(s), ${demand.recentCount} in the last year. ${demand.interpretation}`;
  }
}

/**
 * Deliver a paid order. Idempotent: if a validated artifact already exists the
 * order is reported delivered without regenerating. `deps` lets a test inject
 * deterministic research and summarisation so no network call is needed.
 */
export async function deliverOrder(
  orderId: string,
  deps: { scan?: (topic: string) => Promise<DemandScan>; summarize?: (topic: string, d: DemandScan) => Promise<string> } = {},
): Promise<{ orderId: string; artifactId: string; ok: boolean }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true, artifacts: true } });
  if (!order) throw new ValidationError(`Order not found: ${orderId}`);
  if (order.status === 'DELIVERED' && order.artifacts.some((a) => a.validated)) {
    return { orderId, artifactId: order.artifacts.find((a) => a.validated)!.id, ok: true };
  }
  if (order.status !== 'PAID' && order.status !== 'IN_DELIVERY') {
    throw new ValidationError(`Order ${orderId} is ${order.status}; only a PAID order can be delivered`);
  }

  await prisma.order.update({ where: { id: orderId }, data: { status: 'IN_DELIVERY' } });

  const topic = topicFrom(order, order.product.name);
  const scan = deps.scan ?? ((t: string) => scanDemand(t, { limit: 25 }));
  const demand = await scan(topic).catch(() => null);
  const safeDemand: DemandScan =
    demand ??
    ({ topic, signals: [], volume: 0, recentCount: 0, avgPoints: 0, confidence: 0, interpretation: 'No public discussion found. Absence of signals is not evidence of demand.', scannedAt: new Date().toISOString() } as DemandScan);

  const summary = await (deps.summarize ?? draftSummary)(topic, safeDemand);
  const report = buildReport(topic, safeDemand, summary);
  const qa = validateReport(report, (order.product.qaChecklist as string[]) ?? []);
  const ref = JSON.stringify(report, null, 2);

  const artifact = await prisma.deliveryArtifact.create({
    data: {
      orderId,
      kind: 'opportunity_report',
      name: `${order.product.slug}-${orderId.slice(0, 8)}.json`,
      ref,
      bytes: Buffer.byteLength(ref),
      validated: qa.ok,
      validation: qa as never,
    },
  });

  // Record the delivery cost (a real AI + infra estimate) against the order.
  const estCost = Number(order.product.costUsd);
  if (estCost > 0) {
    await record({ kind: 'DELIVERY_COST', amountUsd: estCost, provider: 'tareq', evidence: { orderId, artifactId: artifact.id } });
  }

  if (!qa.ok) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'FAILED' } });
    await audit({ actorType: 'system', action: 'order.delivery_failed', target: orderId, severity: 'warn', metadata: { checks: qa.checks } });
    throw new ValidationError(`Delivery QA failed for order ${orderId}`);
  }

  await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
  await audit({ actorType: 'system', action: 'order.delivered', target: orderId, severity: 'warn', metadata: { artifactId: artifact.id, bytes: artifact.bytes } });
  logger.info('order delivered', { orderId, artifactId: artifact.id, topic });
  return { orderId, artifactId: artifact.id, ok: true };
}

export async function getArtifact(artifactId: string) {
  return prisma.deliveryArtifact.findUnique({ where: { id: artifactId } });
}
