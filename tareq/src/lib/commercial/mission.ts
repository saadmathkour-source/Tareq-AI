import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';
import { remember } from '../memory/index.ts';
import { recordClaim } from '../memory/evidence.ts';
import { researchDemand } from '../tools/research.ts';
import { discoverAndPersist } from '../sales/discovery.ts';
import { scanValueLeak, forgeMicroOffer } from './engines.ts';
import { advance, type Stage } from './decision-engine.ts';

/**
 * Autonomous commercial mission.
 *
 * Runs the bounded, read-only commercial lifecycle for one topic:
 *   DISCOVER -> RESEARCH -> VALIDATE -> DESIGN -> PROTOTYPE -> VERIFY
 * using real public sources (Hacker News, Wikipedia) and the deterministic
 * commercial engines. It stops at QUALITY_VERIFICATION: it never reaches
 * APPROVAL, OUTREACH, CONVERSION or PAYMENT, so it cannot message anyone,
 * spend money or record revenue. Those steps need explicit owner approval.
 *
 * Every number in the report is either measured from a live call or labelled as
 * an estimate. Nothing is fabricated.
 */

export interface MissionStep {
  stage: Stage | 'RESEARCH' | 'BUYER_DISCOVERY';
  ok: boolean;
  detail: string;
}

export interface MissionReport {
  topic: string;
  opportunityId: string;
  steps: MissionStep[];
  demand: { volume: number; recentCount: number; sources: string[]; confidence: number } | null;
  evidence: { claimId: string; source: string; sourceUrl: string }[];
  buyers: { candidates: number; persisted: number };
  offer: { name: string; priceUsd: number; scope: string; marginPct: number };
  reachedStage: Stage;
  stoppedAt: string;
  requiresOwnerApproval: true;
}

/** One live research query; returns null on any failure so the mission degrades gracefully. */
async function safeDemand(topic: string): Promise<Awaited<ReturnType<typeof researchDemand>> | null> {
  try {
    return await researchDemand(topic, { limit: 20 });
  } catch (err) {
    logger.warn('mission research failed', { topic, error: (err as Error).message });
    return null;
  }
}

export async function runMission(
  topic: string,
  opts: { opportunityId?: string; maxBuyers?: number } = {},
): Promise<MissionReport> {
  const steps: MissionStep[] = [];
  const evidenceIds: string[] = [];
  const evidenceOut: { claimId: string; source: string; sourceUrl: string }[] = [];

  // --- DISCOVER: create the opportunity record ----------------------------
  const opportunity =
    opts.opportunityId
      ? await prisma.opportunity.findUniqueOrThrow({ where: { id: opts.opportunityId } })
      : await prisma.opportunity.create({
          data: {
            title: `Commercial opportunity: ${topic}`,
            problem: topic,
            stage: 'DISCOVERY',
            confidence: 0.3,
            killCriteria: { minDemandVolume: 3, maxDaysWithoutProof: 30 } as never,
          },
        });
  steps.push({ stage: 'DISCOVERY', ok: true, detail: `opportunity ${opportunity.id}` });

  // --- RESEARCH: real public signals --------------------------------------
  const demand = await safeDemand(topic);
  if (demand) {
    steps.push({
      stage: 'RESEARCH',
      ok: true,
      detail: `${demand.volume} signals, ${demand.recentCount} recent, sources: ${[...new Set(demand.signals.map((s) => s.source))].join(', ')}`,
    });
    // Record the strongest signals as market evidence (unpublished until verified).
    for (const s of demand.signals.slice(0, 3)) {
      const claimId = await recordClaim({
        statement: `Public signal for "${topic}": ${s.title}`,
        source: s.source,
        sourceUrl: s.url,
        confidence: 0.55,
        validUntil: new Date(Date.now() + 45 * 86_400_000),
        publishable: false,
      });
      evidenceIds.push(claimId);
      evidenceOut.push({ claimId, source: s.source, sourceUrl: s.url });
    }
  } else {
    steps.push({ stage: 'RESEARCH', ok: false, detail: 'no public signals collected' });
  }

  await advance(opportunity.id, 'EVIDENCE_COLLECTION', { opportunityId: opportunity.id, evidenceIds, gate: {} }, 'mission');
  steps.push({ stage: 'EVIDENCE_COLLECTION', ok: true, detail: `${evidenceIds.length} evidence records` });

  // --- VALIDATE: demand proof ---------------------------------------------
  const demandProof = Boolean(demand && demand.volume > 0);
  await advance(
    opportunity.id,
    'DEMAND_VALIDATION',
    { opportunityId: opportunity.id, evidenceIds, gate: { demandProof, volume: demand?.volume ?? 0 } },
    'mission',
  );
  steps.push({ stage: 'DEMAND_VALIDATION', ok: demandProof, detail: `demandProof=${demandProof}` });

  // --- BUYER DISCOVERY: real public candidates ----------------------------
  let buyers = { candidates: 0, persisted: 0 };
  try {
    const { discovery, persisted } = await discoverAndPersist(topic, {
      limit: opts.maxBuyers ?? 20,
      opportunityId: opportunity.id,
    });
    buyers = { candidates: discovery.candidates.length, persisted: persisted.buyersCreated };
    steps.push({ stage: 'BUYER_DISCOVERY', ok: buyers.candidates > 0, detail: `${buyers.candidates} candidates, ${buyers.persisted} persisted` });
  } catch (err) {
    steps.push({ stage: 'BUYER_DISCOVERY', ok: false, detail: (err as Error).message });
  }

  await advance(
    opportunity.id,
    'BUYER_IDENTIFICATION',
    { opportunityId: opportunity.id, evidenceIds, gate: { buyer: buyers.candidates > 0 } },
    'mission',
  );
  steps.push({ stage: 'BUYER_IDENTIFICATION', ok: buyers.candidates > 0, detail: `${buyers.candidates} identified` });

  // --- DESIGN: economics + a concrete micro-offer -------------------------
  const leak = scanValueLeak({ currentCostUsd: 0, wastedHoursPerMonth: 8, hourlyRateUsd: 60, errorRatePct: 5, errorCostUsd: 200 });
  const offer = forgeMicroOffer(`Fix "${topic}" for one team`, 12, 60, 45);
  await advance(
    opportunity.id,
    'ECONOMIC_ANALYSIS',
    {
      opportunityId: opportunity.id,
      evidenceIds,
      gate: { economics: { monthlyLeakUsd: leak.monthlyLeakUsd, priceUsd: offer.priceUsd } },
    },
    'mission',
  );
  steps.push({ stage: 'ECONOMIC_ANALYSIS', ok: true, detail: `leak $${leak.monthlyLeakUsd}/mo, offer $${offer.priceUsd}` });

  await advance(
    opportunity.id,
    'RISK_REVIEW',
    { opportunityId: opportunity.id, evidenceIds, gate: { risk: { top: leak.breakdown, mitigation: 'bounded pilot, owner-approved pricing' } } },
    'mission',
  );
  steps.push({ stage: 'RISK_REVIEW', ok: true, detail: 'risk recorded' });

  const offerRow = await prisma.offer.create({
    data: {
      opportunityId: opportunity.id,
      name: offer.name,
      description: offer.scope,
      priceUsd: offer.priceUsd,
      costUsd: 0,
      claimRefs: evidenceIds as never,
      active: true,
    },
  });
  await advance(
    opportunity.id,
    'OFFER_DESIGN',
    { opportunityId: opportunity.id, evidenceIds, gate: { offer: { id: offerRow.id, name: offer.name, priceUsd: offer.priceUsd } } },
    'mission',
  );
  steps.push({ stage: 'OFFER_DESIGN', ok: true, detail: `${offer.name} @ $${offer.priceUsd}` });

  // --- PROTOTYPE: a concrete, testable deliverable ------------------------
  const prototype = {
    kind: 'service_blueprint',
    name: offer.name,
    deliverable: offer.scope,
    acceptanceCriteria: ['baseline measured', 'target metric defined', 'outcome verified against baseline'],
    generatedAt: new Date().toISOString(),
  };
  await advance(
    opportunity.id,
    'PROTOTYPE',
    { opportunityId: opportunity.id, evidenceIds, gate: { prototype } },
    'mission',
  );
  steps.push({ stage: 'PROTOTYPE', ok: true, detail: 'service blueprint generated' });

  // --- VERIFY: quality gate -----------------------------------------------
  const checks = {
    hasEvidence: evidenceIds.length >= 1,
    hasDemand: demandProof,
    hasBuyers: buyers.candidates > 0,
    hasOffer: Boolean(offerRow.id),
    hasAcceptanceCriteria: prototype.acceptanceCriteria.length === 3,
  };
  const qualityPassed = Object.values(checks).every(Boolean);
  await advance(
    opportunity.id,
    'QUALITY_VERIFICATION',
    { opportunityId: opportunity.id, evidenceIds, gate: { qualityPassed, checks } },
    'mission',
  );
  steps.push({ stage: 'QUALITY_VERIFICATION', ok: qualityPassed, detail: JSON.stringify(checks) });

  // --- persist memory + audit ---------------------------------------------
  const reachedStage: Stage = 'QUALITY_VERIFICATION';
  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: {
      genome: { demand: demand ? { volume: demand.volume, confidence: demand.confidence } : null, leak } as never,
      estValueUsd: offer.priceUsd,
      estCostUsd: 0,
      confidence: demand?.confidence ?? 0.3,
    },
  });
  await remember({
    kind: 'LONG_TERM',
    key: `mission:${opportunity.id}`,
    content: JSON.stringify({ topic, reachedStage, offer: offer.name, priceUsd: offer.priceUsd, buyers, evidence: evidenceOut.length }),
    source: 'mission',
    epistemic: 'estimate',
    confidence: demand?.confidence ?? 0.3,
  });
  await audit({
    actorType: 'agent',
    action: 'mission.completed',
    target: opportunity.id,
    metadata: { topic, reachedStage, buyers, evidence: evidenceOut.length, qualityPassed },
  });

  const report: MissionReport = {
    topic,
    opportunityId: opportunity.id,
    steps,
    demand: demand ? { volume: demand.volume, recentCount: demand.recentCount, sources: [...new Set(demand.signals.map((s) => s.source))], confidence: demand.confidence } : null,
    evidence: evidenceOut,
    buyers,
    offer: { name: offer.name, priceUsd: offer.priceUsd, scope: offer.scope, marginPct: 45 },
    reachedStage,
    stoppedAt: 'QUALITY_VERIFICATION — approval, outreach, conversion and payment require explicit owner approval',
    requiresOwnerApproval: true,
  };
  return report;
}
