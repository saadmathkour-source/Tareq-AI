/**
 * TAREQ worker entrypoint.
 *
 * Wires every task handler into the orchestrator and runs the loop. This is the
 * process that keeps TAREQ working when no browser is open. Start it with:
 *   npm run worker
 */
import { registerHandler, run, registeredKinds } from '../src/lib/core/orchestrator.ts';
import { logger } from '../src/lib/core/logger.ts';
import { env } from '../src/lib/env.ts';
import { ensureBudget } from '../src/lib/security/budget.ts';
import { seedSchedules, tickScheduler } from '../src/lib/queue/scheduler.ts';
import { pruneExpired } from '../src/lib/memory/index.ts';
import { staleClaims } from '../src/lib/memory/evidence.ts';
import { audit } from '../src/lib/core/audit.ts';
import { prisma } from '../src/lib/core/db.ts';
import { think, parseJson } from '../src/lib/providers/router.ts';
import { createLead } from '../src/lib/sales/leads.ts';
import { draft } from '../src/lib/sales/outreach.ts';
import { scanValueLeak, forgeMicroOffer, scoreIntent, type IntentSignal } from '../src/lib/commercial/engines.ts';
import { painToCash, opportunityDNA, killSwitch } from '../src/lib/capabilities/engines.ts';
import { remember } from '../src/lib/memory/index.ts';

/** Extract a strict JSON object from a model reply, or null. */
function tryJson<T>(text: string): T | null {
  try {
    return parseJson<T>(text);
  } catch {
    return null;
  }
}

function registerAll(): void {
  // --- maintenance ---------------------------------------------------------
  registerHandler('maintenance.cycle', async () => {
    const pruned = await pruneExpired();
    const stale = await staleClaims();
    await audit({ actorType: 'system', action: 'maintenance.cycle', metadata: { pruned, staleClaims: stale.length } });
    return { pruned, staleClaims: stale.length };
  });

  registerHandler('maintenance.evidence_freshness', async () => {
    const stale = await staleClaims();
    if (stale.length > 0) {
      await remember({
        kind: 'FAILURE',
        key: `stale-claims:${new Date().toISOString().slice(0, 10)}`,
        content: `${stale.length} claims need re-verification: ${stale.map((c) => c.id).join(', ')}`,
        source: 'system',
        epistemic: 'fact',
        confidence: 1,
      });
    }
    return { stale: stale.length };
  });

  registerHandler('maintenance.scheduler', async () => {
    const fired = await tickScheduler();
    return { fired };
  });

  // --- commercial ----------------------------------------------------------
  registerHandler('commercial.market_research', async (task) => {
    const topic = String(task.payload['topic'] ?? 'unspecified problem');
    const res = await think({
      purpose: 'commercial.market_research',
      system:
        'You research markets. Output ONLY JSON. Do not invent sources or numbers. If you are unsure, lower the confidence and say so in "basis".',
      messages: [
        {
          role: 'user',
          content: `Research the market for: ${topic}. Return JSON: {"problem":string,"affectedBuyer":string,"currentSolutions":string[],"confidence":0..1,"basis":string}`,
        },
      ],
      json: true,
      maxTokens: 800,
      taskId: task.id,
    });
    const parsed = tryJson<{ problem: string; affectedBuyer: string; currentSolutions: string[]; confidence: number; basis: string }>(res.content);
    if (parsed) {
      await remember({
        kind: 'MARKET_EVIDENCE',
        key: `research:${topic}`,
        content: JSON.stringify(parsed),
        source: 'model',
        epistemic: 'hypothesis',
        confidence: parsed.confidence ?? 0.3,
      });
    }
    return { topic, parsed: parsed ?? null, model: res.model, costUsd: res.costUsd };
  });

  registerHandler('commercial.opportunity_genome', async (task) => {
    const opportunityId = task.payload['opportunityId'] ? String(task.payload['opportunityId']) : null;
    const topic = String(task.payload['topic'] ?? '');
    const res = await think({
      purpose: 'commercial.opportunity_genome',
      system:
        'Build an opportunity genome. Output ONLY JSON matching the requested keys. Use conservative estimates and mark them as estimates in "basis". Never fabricate measured numbers.',
      messages: [
        {
          role: 'user',
          content: `For "${topic}", return JSON: {"problem":string,"painSeverity":0..10,"affectedBuyer":string,"costOfProblemUsd":number,"currentSolutions":string[],"willingnessToPayUsd":number,"buyingCycleDays":number,"competitionIntensity":0..10,"costToReachBuyerUsd":number,"potentialMarginPct":0..100,"confidence":0..1,"basis":string}`,
        },
      ],
      json: true,
      maxTokens: 900,
      taskId: task.id,
    });
    const genome = tryJson<Record<string, unknown>>(res.content);
    if (opportunityId && genome) {
      await prisma.opportunity.update({ where: { id: opportunityId }, data: { genome: genome as never } });
    }
    return { genome, costUsd: res.costUsd };
  });

  registerHandler('commercial.demand_validation', async (task) => {
    const topic = String(task.payload['topic'] ?? '');
    const res = await think({
      purpose: 'commercial.demand_validation',
      system:
        'Assess whether real, payable demand is likely. Output ONLY JSON. Distinguish interest from willingness to pay. If evidence is missing, set demandProof to false.',
      messages: [
        {
          role: 'user',
          content: `Topic: ${topic}. Return JSON: {"demandProof":boolean,"reasoning":string,"confidence":0..1,"nextEvidenceToCollect":string[]}`,
        },
      ],
      json: true,
      maxTokens: 700,
      taskId: task.id,
    });
    return { result: tryJson<Record<string, unknown>>(res.content), costUsd: res.costUsd };
  });

  registerHandler('commercial.economic_analysis', async (task) => {
    const leak = scanValueLeak({
      currentCostUsd: Number(task.payload['currentCostUsd'] ?? 0),
      wastedHoursPerMonth: Number(task.payload['wastedHoursPerMonth'] ?? 0),
      hourlyRateUsd: Number(task.payload['hourlyRateUsd'] ?? 30),
      errorRatePct: Number(task.payload['errorRatePct'] ?? 0),
      errorCostUsd: Number(task.payload['errorCostUsd'] ?? 0),
    });
    const micro = forgeMicroOffer(String(task.payload['outcome'] ?? 'quick win'), Number(task.payload['estHours'] ?? 4), Number(task.payload['hourlyRateUsd'] ?? 30));
    return { leak, microOffer: micro };
  });

  registerHandler('commercial.risk_review', async (task) => {
    const topic = String(task.payload['topic'] ?? '');
    const res = await think({
      purpose: 'commercial.risk_review',
      system:
        'List legal, security, privacy and platform-terms risks. Output ONLY JSON. Never give binding legal advice; flag when a lawyer is needed.',
      messages: [{ role: 'user', content: `Topic: ${topic}. Return JSON: {"risks":[{"kind":string,"severity":"low"|"medium"|"high","mitigation":string}],"needsLawyer":boolean}` }],
      json: true,
      maxTokens: 600,
      taskId: task.id,
    });
    return { result: tryJson<Record<string, unknown>>(res.content), costUsd: res.costUsd };
  });

  registerHandler('commercial.offer_design', async (task) => {
    const opportunityId = task.payload['opportunityId'] ? String(task.payload['opportunityId']) : null;
    const outcome = String(task.payload['outcome'] ?? '');
    const pain = painToCash({
      problem: outcome,
      measured: (task.payload['measured'] as Record<string, number>) ?? {},
      estimated: (task.payload['estimated'] as Record<string, number>) ?? {},
      assumptions: (task.payload['assumptions'] as string[]) ?? [],
      targetMarginPct: Number(task.payload['targetMarginPct'] ?? 40),
    });
    if (opportunityId) {
      await prisma.offer.create({
        data: {
          opportunityId,
          name: `Offer: ${outcome}`,
          description: pain.valueProof,
          priceUsd: pain.proposedPriceUsd,
          costUsd: 0,
        },
      });
    }
    return { offer: pain };
  });

  registerHandler('commercial.evidence_gate', async (task) => {
    const offerId = task.payload['offerId'] ? String(task.payload['offerId']) : null;
    if (!offerId) return { skipped: 'no offerId' };
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) return { skipped: 'offer not found' };
    const claimRefs = (offer.claimRefs as string[]) ?? [];
    const bad: string[] = [];
    for (const id of claimRefs) {
      const c = await prisma.claim.findUnique({ where: { id } });
      if (!c || !c.publishable || !c.verifiedAt) bad.push(id);
    }
    return { offerId, unsupportedClaims: bad, publishable: bad.length === 0 };
  });

  registerHandler('commercial.quality_verification', async (task) => {
    const checks = (task.payload['checks'] as string[]) ?? [];
    const artefact = String(task.payload['artefact'] ?? '');
    if (checks.length === 0) return { qualityPassed: false, reason: 'no acceptance checks defined' };
    const res = await think({
      purpose: 'commercial.quality_verification',
      system: 'You are a strict QA reviewer. Output ONLY JSON. If you cannot verify a check from the artefact, mark it failed. Never pass something unverified.',
      messages: [{ role: 'user', content: `Artefact:\n${artefact}\n\nChecks:\n- ${checks.join('\n- ')}\n\nReturn JSON: {"results":[{"check":string,"passed":boolean,"reason":string}],"qualityPassed":boolean}` }],
      json: true,
      maxTokens: 800,
      taskId: task.id,
    });
    return { result: tryJson<Record<string, unknown>>(res.content), costUsd: res.costUsd };
  });

  registerHandler('commercial.asset_yield', async () => {
    const assets = await prisma.asset.findMany();
    return { count: assets.length };
  });

  registerHandler('commercial.risk_portfolio', async () => {
    const opps = await prisma.opportunity.findMany({ where: { stage: { notIn: ['KILLED'] } } });
    return { count: opps.length };
  });

  // --- sales ---------------------------------------------------------------
  registerHandler('sales.lead_discovery', async (task) => {
    const signals = (task.payload['intentSignals'] as IntentSignal[]) ?? [];
    const intent = scoreIntent(signals);
    const leadId = await createLead({
      buyerId: task.payload['buyerId'] ? String(task.payload['buyerId']) : undefined,
      opportunityId: task.payload['opportunityId'] ? String(task.payload['opportunityId']) : undefined,
      intentSignals: signals,
      urgencyDays: Number(task.payload['urgencyDays'] ?? 60),
      fit: Number(task.payload['fit'] ?? 0.5),
    });
    return { leadId, intent };
  });

  registerHandler('sales.lead_score', async (task) => {
    const leadId = String(task.payload['leadId'] ?? '');
    if (!leadId) return { skipped: 'no leadId' };
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    return { leadId, score: lead?.score ?? null };
  });

  registerHandler('sales.outreach_draft', async (task) => {
    const leadId = String(task.payload['leadId'] ?? '');
    if (!leadId) return { skipped: 'no leadId' };
    const draftId = await draft({
      leadId,
      offerName: String(task.payload['offerName'] ?? 'Our offer'),
      valueSummary: String(task.payload['valueSummary'] ?? 'We can remove a measurable cost.'),
    });
    return { draftId };
  });

  registerHandler('sales.outreach_send', async () => {
    // Sending is approval-gated: this handler only reports that a decision is needed.
    return { status: 'requires_owner_approval', action: 'outreach.send' };
  });

  // --- generic kill-switch evaluation --------------------------------------
  registerHandler('opportunity.kill_check', async (task) => {
    const opportunityId = String(task.payload['opportunityId'] ?? '');
    if (!opportunityId) return { skipped: 'no opportunityId' };
    const opp = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
    if (!opp) return { skipped: 'not found' };
    const criteria = (opp.killCriteria as { maxCostUsd?: number; minDemandScore?: number; maxFailures?: number; maxNegativeMarginDays?: number }) ?? {};
    const result = killSwitch(
      {
        maxCostUsd: criteria.maxCostUsd ?? 20,
        minDemandScore: criteria.minDemandScore ?? 0.2,
        maxFailures: criteria.maxFailures ?? 3,
        maxNegativeMarginDays: criteria.maxNegativeMarginDays ?? 30,
      },
      {
        spentUsd: Number(opp.estCostUsd ?? 0),
        demandScore: Number(opp.confidence ?? 0),
        failures: 0,
        negativeMarginDays: 0,
        legalOrSecurityRisk: false,
      },
    );
    return { opportunityId, ...result };
  });

  // --- DNA mapper ----------------------------------------------------------
  registerHandler('capability.dna_map', async (task) => {
    const genome = task.payload['genome'] as Parameters<typeof opportunityDNA>[0] | undefined;
    if (!genome) return { skipped: 'no genome' };
    return { dna: opportunityDNA(genome) };
  });
}

async function main(): Promise<void> {
  env();
  await ensureBudget();
  await seedSchedules();
  registerAll();
  logger.info('worker boot', { handlers: registeredKinds().length });

  // A tiny internal schedule so maintenance runs even before cron data exists.
  await tickScheduler();

  const maxTasks = process.env.TAREQ_WORKER_MAX_TASKS ? Number(process.env.TAREQ_WORKER_MAX_TASKS) : 0;
  await run({ maxTasks, pollIntervalMs: 2_000 });
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('worker crashed', { error: (err as Error).message });
  process.exit(1);
});
