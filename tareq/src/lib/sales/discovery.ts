/**
 * Buyer discovery persistence (capability 11 + 43 lead shield).
 *
 * Bridges the public-source connector to the CRM tables. It enforces the rules
 * the directive sets:
 *  - duplicate detection: one Buyer per public source URL, one Lead per buyer.
 *  - lawful basis is recorded and required; a candidate with no public source
 *    is rejected.
 *  - no contact details are invented; only a public handle and permalink.
 *  - intent scoring is explainable and stored, never a black box.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../core/db.ts';
import { ValidationError } from '../core/errors.ts';
import { scoreIntent, rankBuyersNow } from '../commercial/engines.ts';
import { discoverBuyersFromHN, type BuyerDiscoveryResult, type CandidateLead } from '../integrations/buyers.ts';

export interface PersistResult {
  topic: string;
  discovered: number;
  buyersCreated: number;
  buyersMatched: number;
  leadsCreated: number;
  duplicatesSkipped: number;
  buyerIds: string[];
  leadIds: string[];
}

/**
 * Persist discovered candidates as Buyers + Leads with duplicate detection.
 * Idempotent per source URL: re-running discovery does not create duplicates.
 *
 * Query-minimal by design: ids are generated client-side so each insert can be
 * done with `createMany` (one round-trip for all new buyers, one for all new
 * leads) instead of a per-row create. This matters on a pooled database where a
 * single round-trip can cost a second. Duplicate detection uses two SELECTs.
 */
export async function persistCandidates(
  topic: string,
  candidates: CandidateLead[],
  opts: { opportunityId?: string } = {},
): Promise<PersistResult> {
  const result: PersistResult = {
    topic, discovered: candidates.length, buyersCreated: 0, buyersMatched: 0,
    leadsCreated: 0, duplicatesSkipped: 0, buyerIds: [], leadIds: [],
  };

  // Collapse duplicates inside this batch (same public post seen twice).
  const byUrl = new Map<string, CandidateLead>();
  for (const c of candidates) if (c.sourceUrl && !byUrl.has(c.sourceUrl)) byUrl.set(c.sourceUrl, c);
  const unique = [...byUrl.values()];
  if (unique.length === 0) return result;
  const urls = unique.map((c) => c.sourceUrl);

  // SELECT 1 — existing buyers by public source URL.
  const existingBuyers = await prisma.buyer.findMany({ where: { sourceUrl: { in: urls } } });
  const buyerByUrl = new Map(existingBuyers.map((b) => [b.sourceUrl!, b]));
  result.buyersMatched = existingBuyers.length;

  // INSERT 1 — all new buyers in a single statement.
  const toCreate = unique.filter((c) => !buyerByUrl.has(c.sourceUrl));
  const newBuyers = toCreate.map((c) => ({
    id: randomUUID(),
    name: c.handle, // public pseudonymous handle, clearly not a legal name
    sourceUrl: c.sourceUrl,
    lawfulBasis: c.lawfulBasis,
    notes: `Discovered from public discussion: ${c.storyTitle ?? 'unknown thread'}`,
  }));
  if (newBuyers.length > 0) await prisma.buyer.createMany({ data: newBuyers });
  result.buyersCreated = newBuyers.length;

  // Resolve every candidate to a buyer id (existing or just created).
  const newByUrl = new Map(newBuyers.map((b) => [b.sourceUrl, b]));
  const buyerIdFor = (url: string): string => (buyerByUrl.get(url)?.id ?? newByUrl.get(url)!.id);
  const buyerIds = unique.map((c) => buyerIdFor(c.sourceUrl));
  result.buyerIds = buyerIds;

  // SELECT 2 — which of those buyers already have a lead.
  const existingLeads = await prisma.lead.findMany({ where: { buyerId: { in: buyerIds } }, select: { buyerId: true } });
  const buyersWithLead = new Set(existingLeads.map((l) => l.buyerId));
  result.duplicatesSkipped = buyersWithLead.size;

  // INSERT 2 — all new leads in a single statement, using the same scoring the
  // single-lead path uses so the result is identical.
  const leadsToCreate = unique.filter((c) => !buyersWithLead.has(buyerIdFor(c.sourceUrl)));
  const now = new Date();
  const leadRows = leadsToCreate.map((c) => {
    const intent = scoreIntent([{ kind: 'integration_question', weight: c.relevance * 0.4, observedAt: c.postedAt ?? now.toISOString() }]);
    const readiness = rankBuyersNow([{ buyerId: buyerIdFor(c.sourceUrl), intentScore: intent.score, urgencyDays: 90, reachableNow: true }])[0]!.readiness;
    const fit = c.relevance * 0.5;
    return {
      id: randomUUID(),
      buyerId: buyerIdFor(c.sourceUrl),
      opportunityId: opts.opportunityId ?? null,
      score: Math.round(100 * (readiness * 0.6 + fit * 0.4)),
      scoreReason: { intent, readiness, fit } as never,
    };
  });
  if (leadRows.length > 0) await prisma.lead.createMany({ data: leadRows });
  result.leadsCreated = leadRows.length;
  result.leadIds = leadRows.map((l) => l.id);

  return result;
}

/** Discover from public sources and persist in one call. */
export async function discoverAndPersist(topic: string, opts: { limit?: number; opportunityId?: string } = {}): Promise<{ discovery: BuyerDiscoveryResult; persisted: PersistResult }> {
  const discovery = await discoverBuyersFromHN(topic, { limit: opts.limit });
  const persisted = await persistCandidates(topic, discovery.candidates, { opportunityId: opts.opportunityId });
  return { discovery, persisted };
}

export interface FollowUpStep {
  step: number;
  channel: 'email' | 'message';
  afterDays: number;
  purpose: string;
  requiresOwnerApproval: true;
}

/**
 * A follow-up plan for a lead. Every step is draft-only and approval-gated; the
 * agent never sends. Cadence scales with the lead score, and an opted-out lead
 * gets no plan at all.
 */
export async function followUpPlan(leadId: string): Promise<{ leadId: string; plan: FollowUpStep[]; note: string }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { buyer: true } });
  if (!lead) throw new ValidationError('Lead not found');
  if (lead.optedOut) return { leadId, plan: [], note: 'Lead opted out; no follow-up is permitted.' };

  const score = lead.score;
  const plan: FollowUpStep[] = [];
  if (score >= 60) {
    plan.push({ step: 1, channel: 'email', afterDays: 2, purpose: 'Share the concrete micro-offer with acceptance criteria', requiresOwnerApproval: true });
    plan.push({ step: 2, channel: 'email', afterDays: 6, purpose: 'Offer a short paid pilot', requiresOwnerApproval: true });
  } else if (score >= 30) {
    plan.push({ step: 1, channel: 'email', afterDays: 4, purpose: 'Share a relevant, sourced proof point', requiresOwnerApproval: true });
  } else {
    plan.push({ step: 1, channel: 'email', afterDays: 10, purpose: 'Low-priority nurture with a useful, no-ask resource', requiresOwnerApproval: true });
  }
  return {
    leadId,
    plan,
    note: 'Draft-only. Each step needs owner approval before anything is sent, and every message must include an opt-out line.',
  };
}
