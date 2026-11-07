import { prisma } from '../core/db.ts';
import { scoreIntent, rankBuyersNow, type IntentSignal } from '../commercial/engines.ts';

/**
 * Lead management.
 *
 * Scores are explainable: `scoreReason` stores the inputs, so a lead is never a
 * black-box number. Opt-out is honoured everywhere: an opted-out lead is never
 * returned by `forOutreach()`.
 */

export interface LeadInput {
  buyerId?: string;
  opportunityId?: string;
  intentSignals?: IntentSignal[];
  urgencyDays?: number;
  fit?: number;
}

export async function createLead(input: LeadInput): Promise<string> {
  const intent = input.intentSignals ? scoreIntent(input.intentSignals) : { score: 0, label: 'cold' as const };
  const readiness = rankBuyersNow([
    { buyerId: input.buyerId ?? 'unknown', intentScore: intent.score, urgencyDays: input.urgencyDays ?? 60, reachableNow: true },
  ])[0]!.readiness;
  const fit = input.fit ?? 0.5;
  const score = Math.round(100 * (readiness * 0.6 + fit * 0.4));
  return (
    await prisma.lead.create({
      data: {
        buyerId: input.buyerId ?? null,
        opportunityId: input.opportunityId ?? null,
        score,
        scoreReason: { intent, readiness, fit } as never,
      },
    })
  ).id;
}

export async function qualify(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { status: 'QUALIFIED' } });
}

export async function optOut(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { optedOut: true, status: 'DISQUALIFIED' } });
}

/** Leads eligible for outreach: qualified, not opted out, with a sourced buyer. */
export async function forOutreach(limit = 25) {
  return prisma.lead.findMany({
    where: { optedOut: false, status: { in: ['QUALIFIED', 'NEW'] }, buyerId: { not: null } },
    orderBy: { score: 'desc' },
    take: limit,
    include: { buyer: true },
  });
}
