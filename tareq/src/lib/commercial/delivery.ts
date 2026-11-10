import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';
import { ValidationError } from '../core/errors.ts';
import { scanDemand, type DemandScan } from '../integrations/publicdata.ts';
import { scanValueLeak, forgeMicroOffer } from './engines.ts';
import { think } from '../providers/router.ts';
import { record } from '../finance/ledger.ts';
import * as email from '../integrations/email.ts';

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
      'This report does not include competitor analysis or a verified pricing benchmark.',
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
  const validSources = report.demand.sources.length > 0 && report.demand.sources.every((source) => {
    try {
      const url = new URL(source.url);
      return Boolean(source.title.trim()) && (url.protocol === 'http:' || url.protocol === 'https:');
    } catch {
      return false;
    }
  });
  const checks = [
    { check: 'names the niche', ok: report.topic.trim().length > 0 },
    { check: 'has titled sources with valid HTTP(S) URLs', ok: validSources },
    { check: 'states public discussion does not prove willingness to pay', ok: report.notProven.some((item) => /public discussion.*not confirmed willingness to pay/i.test(item)) },
    { check: 'labels default value-leak assumptions as illustrative', ok: report.notProven.some((item) => /value-leak figures are illustrative defaults/i.test(item)) },
    { check: 'labels estimates', ok: report.scoring.basis.length > 0 && report.disclaimer.length > 0 },
    { check: 'has an executive summary', ok: report.executiveSummary.trim().length > 0 },
  ];
  const productChecks: Record<string, boolean> = {
    'Report names the requested topic.': checks[0]!.ok,
    'Every listed public signal has a title and a valid HTTP(S) source URL.': checks[1]!.ok,
    'Report states that discussion is not proof of willingness to pay.': checks[2]!.ok,
    'Report labels the default value-leak assumptions as illustrative.': checks[3]!.ok,
  };
  const declaredChecks = qaChecklist.map((check) => ({
    check,
    ok: productChecks[check] ?? false,
  }));
  const allChecks = [...checks, ...declaredChecks];
  return { ok: allChecks.every((check) => check.ok), checks: allChecks };
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

/** Default lifetime of a download link, in hours. */
export function downloadTtlMs(): number {
  const hours = Number(process.env.TAREQ_DOWNLOAD_TTL_HOURS ?? 168) || 168;
  return hours * 60 * 60 * 1000;
}

/** SHA-256 of a raw download token. Only the hash is ever stored. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A strong, URL-safe download token (256 bits of entropy). */
export function mintDownloadToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Absolute base URL for customer-facing links (no trailing slash).
 *
 * Preference order: explicit `TAREQ_PUBLIC_URL`, then Railway's injected
 * `RAILWAY_PUBLIC_DOMAIN` (so links work in production without extra config),
 * then the caller's fallback (e.g. the request's own origin).
 */
export function publicBaseUrl(fallback = ''): string {
  const explicit = process.env.TAREQ_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (domain) return `https://${domain.replace(/\/+$/, '')}`;
  return fallback.replace(/\/+$/, '');
}

function emailBody(order: { id: string; customerEmail: string | null }, productName: string, downloadUrl: string): { subject: string; text: string } {
  return {
    subject: `Your ${productName} is ready`,
    text: [
      `Thank you for your purchase.`,
      ``,
      `Your ${productName} has been generated and is ready to download:`,
      downloadUrl,
      ``,
      `The link is unique to your order and is valid for a limited time. Keep this email so you can retrieve your report again.`,
      ``,
      `If the link has expired or you have any problem, reply to this email and we will help.`,
      ``,
      `Order reference: ${order.id}`,
      ``,
      `— TAREQ AI`,
    ].join('\n'),
  };
}

/**
 * Deliver a paid order end to end (Phase 17):
 *   1. only a verified PAID order can start;
 *   2. generate + QA the artifact;
 *   3. store it with a hashed, expiring download token;
 *   4. email the buyer a link to `/download/<token>`;
 *   5. mark DELIVERED only when the artifact is valid and the buyer can reach
 *      it. An email failure never discards the artifact — it leaves the order in
 *      EMAIL_FAILED and is retried later without regenerating anything.
 *
 * Idempotent: a validated artifact for the order is reused, and a retry only
 * re-attempts the email. `deps` injects deterministic research, summarisation
 * and email so tests need no network.
 */
export async function deliverOrder(
  orderId: string,
  deps: {
    scan?: (topic: string) => Promise<DemandScan>;
    summarize?: (topic: string, d: DemandScan) => Promise<string>;
    sendEmail?: (input: { to: string; subject: string; text: string }) => Promise<{ sent: boolean; reason?: string }>;
    baseUrl?: string;
  } = {},
): Promise<{ orderId: string; artifactId: string; ok: boolean; emailSent: boolean; status: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true, artifacts: true } });
  if (!order) throw new ValidationError(`Order not found: ${orderId}`);

  const deliverableStates = ['PAID', 'IN_DELIVERY', 'DELIVERY_PENDING', 'EMAIL_FAILED', 'DELIVERED'];
  if (!deliverableStates.includes(order.status)) {
    throw new ValidationError(`Order ${orderId} is ${order.status}; only a PAID order can be delivered`);
  }

  // Reuse an existing validated artifact (a retry must not regenerate).
  let artifact = order.artifacts.find((a) => a.validated) ?? null;
  let rawToken: string | null = null;

  if (!artifact) {
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

    if (!qa.ok) {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'FAILED' } });
      await audit({ actorType: 'system', action: 'order.delivery_failed', target: orderId, severity: 'warn', metadata: { checks: qa.checks } });
      throw new ValidationError(`Delivery QA failed for order ${orderId}`);
    }

    rawToken = mintDownloadToken();
    artifact = await prisma.deliveryArtifact.create({
      data: {
        orderId,
        kind: 'opportunity_report',
        name: `${order.product.slug}-${orderId.slice(0, 8)}.json`,
        ref,
        bytes: Buffer.byteLength(ref),
        validated: true,
        validation: qa as never,
        downloadTokenHash: hashToken(rawToken),
        downloadExpiresAt: new Date(Date.now() + downloadTtlMs()),
        emailStatus: 'PENDING',
      },
    });

    // Record the delivery cost (a real AI + infra estimate) against the order.
    const estCost = Number(order.product.costUsd);
    if (estCost > 0) {
      await record({ kind: 'DELIVERY_COST', amountUsd: estCost, provider: 'tareq', evidence: { orderId, artifactId: artifact.id } });
    }
    logger.info('artifact generated', { orderId, artifactId: artifact.id, topic });
  }

  // The artifact exists and is valid: from here the buyer can reach it. Email is
  // the last mile; a failure is recorded, not fatal.
  const base = publicBaseUrl(deps.baseUrl ?? '');

  let emailSent = false;
  let emailReason: string | undefined;
  const to = order.customerEmail;
  if (!to) {
    emailReason = 'order has no customer email';
  } else if (artifact.emailSentAt) {
    // Already emailed on a previous attempt — a retry is a no-op, not a resend.
    emailSent = true;
  } else {
    // First attempt, or a retry after a failed send. The raw token is only held
    // in memory on the first pass, so a retry mints a fresh one and rotates the
    // stored hash — the previous link (never delivered) becomes invalid.
    let token = rawToken;
    if (token === null) {
      token = mintDownloadToken();
      await prisma.deliveryArtifact.update({
        where: { id: artifact.id },
        data: { downloadTokenHash: hashToken(token), downloadExpiresAt: new Date(Date.now() + downloadTtlMs()) },
      });
    }
    const downloadUrl = base ? `${base}/download/${token}` : `/download/${token}`;
    const sender = deps.sendEmail ?? ((input) => email.send(input));
    const body = emailBody({ id: order.id, customerEmail: to }, order.product.name, downloadUrl);
    const res = await sender({ to, subject: body.subject, text: body.text });
    emailSent = res.sent;
    emailReason = res.reason;
  }

  const nextEmailAttempts = artifact.emailAttempts + 1;
  await prisma.deliveryArtifact.update({
    where: { id: artifact.id },
    data: {
      emailAttempts: nextEmailAttempts,
      emailStatus: emailSent ? 'SENT' : 'FAILED',
      emailSentAt: emailSent ? new Date() : artifact.emailSentAt,
      emailLastError: emailSent ? null : (emailReason ?? 'send failed').slice(0, 500),
    },
  });

  const status = emailSent ? 'DELIVERED' : 'EMAIL_FAILED';
  await prisma.order.update({
    where: { id: orderId },
    data: { status, ...(emailSent ? { deliveredAt: new Date() } : {}) },
  });

  if (emailSent) {
    await audit({ actorType: 'system', action: 'order.delivered', target: orderId, severity: 'warn', metadata: { artifactId: artifact.id, bytes: artifact.bytes } });
    logger.info('order delivered', { orderId, artifactId: artifact.id });
  } else {
    await audit({ actorType: 'system', action: 'order.email_failed', target: orderId, severity: 'error', metadata: { artifactId: artifact.id, reason: emailReason } });
    logger.warn('order artifact ready but email not sent', { orderId, reason: emailReason });
  }

  return { orderId, artifactId: artifact.id, ok: true, emailSent, status };
}

export async function getArtifact(artifactId: string) {
  return prisma.deliveryArtifact.findUnique({ where: { id: artifactId } });
}

/**
 * Redeem a raw download token. Returns the artifact for its own order only, and
 * refuses an unknown or expired token. The token is compared by hash, so the
 * stored value never reveals a usable link.
 */
export async function redeemDownloadToken(rawToken: string): Promise<{ artifactId: string; orderId: string; name: string; ref: string | null } | null> {
  const token = String(rawToken ?? '').trim();
  if (token.length < 20) return null;
  const artifact = await prisma.deliveryArtifact.findUnique({ where: { downloadTokenHash: hashToken(token) } });
  if (!artifact) return null;
  if (artifact.downloadExpiresAt && artifact.downloadExpiresAt.getTime() < Date.now()) return null;
  await audit({ actorType: 'system', action: 'order.download', target: artifact.orderId, metadata: { artifactId: artifact.id } });
  return { artifactId: artifact.id, orderId: artifact.orderId, name: artifact.name, ref: artifact.ref };
}
