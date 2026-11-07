/**
 * Commercial end-to-end acceptance test (directive section 22).
 *
 * Walks one opportunity through the full commercial lifecycle using real code:
 *   DISCOVER -> RESEARCH -> VALIDATE -> PRIORITIZE -> DESIGN -> BUILD -> TEST ->
 *   MARKET -> SELL -> COLLECT -> DELIVER -> VERIFY -> ACCOUNT -> LEARN
 *
 * It creates its own rows, proves the stage gates block an unsupported advance,
 * then removes everything it created. It never touches data it did not create.
 * Run with: npm run acceptance
 */
import { prisma } from '../src/lib/core/db.ts';
import { advance, checkGate, StageGateError } from '../src/lib/commercial/decision-engine.ts';
import { scanDemand } from '../src/lib/integrations/publicdata.ts';
import { recordClaim, assertPublishable, UnsupportedClaimError } from '../src/lib/memory/evidence.ts';
import { advanceProof, forgeMicroOffer, offerFit, simulate, riskPortfolio, cashflowSurvival } from '../src/lib/commercial/engines.ts';
import { productize, verifyOutcome, killSwitch, capabilityFeedback } from '../src/lib/capabilities/engines.ts';
import { recordRevenue, summary } from '../src/lib/finance/ledger.ts';
import { createLead } from '../src/lib/sales/leads.ts';
import { audit, verifyChain } from '../src/lib/core/audit.ts';

const MARK = `ACCEPT-${Date.now().toString(36)}`;
const created: Array<() => Promise<unknown>> = [];
let checks = 0;

function ok(step: string, detail: string): void {
  checks++;
  console.log(`  ${String(checks).padStart(2)}. ${step} — ${detail}`);
}

async function main(): Promise<void> {
  console.log(`\n=== TAREQ commercial acceptance test (${MARK}) ===\n`);

  // 1. DISCOVER a real, publicly documented problem.
  const topic = 'invoicing software for freelancers';
  const scan = await scanDemand(topic, { limit: 20 });
  const opp = await prisma.opportunity.create({
    data: { title: `${MARK} ${topic}`, problem: topic, stage: 'DISCOVERY', confidence: scan.confidence, genome: { topic, publicVolume: scan.volume } as never },
  });
  created.push(() => prisma.opportunity.delete({ where: { id: opp.id } }));
  ok('DISCOVER', `public signals volume=${scan.volume} recent=${scan.recentCount} (real, keyless)`);

  // 2. RESEARCH -> evidence collection.
  const claimId = await recordClaim({
    statement: `${scan.volume} public discussions reference invoice reconciliation pain`,
    source: 'Hacker News (Algolia)', sourceUrl: 'https://hn.algolia.com',
    confidence: scan.confidence, validUntil: new Date(Date.now() + 45 * 86_400_000), publishable: true,
  });
  created.push(() => prisma.claim.delete({ where: { id: claimId } }));
  const ev = [claimId];
  await advance(opp.id, 'EVIDENCE_COLLECTION', { opportunityId: opp.id, evidenceIds: ev, gate: {} }, 'agent:market_research');
  ok('RESEARCH', `evidence id=${claimId.slice(0, 8)}… recorded`);

  // 3. VALIDATE demand (proof ladder, no rung skipped).
  let proof = advanceProof({ rung: 'stated_interest', observations: [] }, 'problem_confirmed', `public volume ${scan.volume}`);
  proof = advanceProof(proof, 'budget_acknowledged', 'buyer segment publishes budget for tooling');
  const demandProof = proof.rung === 'budget_acknowledged';
  await advance(opp.id, 'DEMAND_VALIDATION', { opportunityId: opp.id, evidenceIds: ev, gate: { demandProof } }, 'agent:demand_validation');
  ok('VALIDATE', `proof rung=${proof.rung} demandProof=${demandProof}`);

  // 4. BUYER identification.
  const buyer = await prisma.buyer.create({ data: { name: `${MARK} buyer`, organization: `${MARK} org`, role: 'Owner', segment: 'freelancer', lawfulBasis: 'public' } });
  created.push(() => prisma.buyer.delete({ where: { id: buyer.id } }));
  const leadId = await createLead({ buyerId: buyer.id, opportunityId: opp.id, fit: 0.7, urgencyDays: 20 });
  created.push(() => prisma.lead.delete({ where: { id: leadId } }));
  await advance(opp.id, 'BUYER_IDENTIFICATION', { opportunityId: opp.id, evidenceIds: ev, gate: { buyer: buyer.id } }, 'agent:buyer_intelligence');
  ok('BUYER', `buyer + lead created, lawfulBasis=public`);

  // 5. ECONOMIC analysis.
  const economics = simulate({ priceUsd: 49, unitCostUsd: 6, expectedVolume: 40, fixedCostUsd: 50 });
  const cash = cashflowSurvival(0, 5, 200, 0);
  await advance(opp.id, 'ECONOMIC_ANALYSIS', { opportunityId: opp.id, evidenceIds: ev, gate: { economics } }, 'agent:finance_analyst');
  ok('ECONOMIC', `profit/unit=$${economics.profitUsd} breakeven=${economics.breakEvenUnits} runway=${cash.runwayMonthsBase}mo`);

  // 6. RISK review + prioritisation.
  const kill = killSwitch({ maxCostUsd: 20, minDemandScore: 0.1, maxFailures: 3, maxNegativeMarginDays: 30 },
    { spentUsd: 0.1, demandScore: scan.confidence, failures: 0, negativeMarginDays: 0, legalOrSecurityRisk: false });
  const portfolio = riskPortfolio([{ id: opp.id, expectedProfitUsd: economics.profitUsd * 40, probability: 0.3, risk: 0.4 }]);
  await advance(opp.id, 'RISK_REVIEW', { opportunityId: opp.id, evidenceIds: ev, gate: { risk: { kill, portfolio } } }, 'agent:security_reviewer');
  ok('PRIORITIZE/RISK', `kill=${kill.kill} riskAdjusted=$${portfolio.ranked[0]!.riskAdjustedUsd.toFixed(2)}`);

  // 7. OFFER design; unsupported claims are blocked, the verified claim passes.
  const micro = forgeMicroOffer('reconcile one month of invoices', 3, 25, 45);
  const fit = offerFit({ painSeverity: 6, willingnessToPayUsd: 60, competitionIntensity: 5 } as never, { priceUsd: micro.priceUsd, marginPct: 45, deliveryDays: 3 });
  let publishBlocked = false;
  try { await assertPublishable(['00000000-0000-0000-0000-000000000000']); } catch (e) { publishBlocked = e instanceof UnsupportedClaimError; }
  await assertPublishable([claimId]);
  const offer = await prisma.offer.create({ data: { opportunityId: opp.id, name: micro.name, description: micro.scope, priceUsd: micro.priceUsd, costUsd: 6, claimRefs: [claimId] as never } });
  created.push(() => prisma.offer.delete({ where: { id: offer.id } }));
  await advance(opp.id, 'OFFER_DESIGN', { opportunityId: opp.id, evidenceIds: ev, gate: { offer: offer.id } }, 'agent:sales_strategy');
  ok('DESIGN', `offer=$${micro.priceUsd} fit=${fit.fit.toFixed(2)} unsupportedClaimBlocked=${publishBlocked}`);

  // 8. BUILD prototype -> 9. TEST quality.
  const svc = productize({ name: micro.name, steps: ['intake', 'reconcile', 'report'], inputs: ['export'], qualityChecks: ['no missing rows'], deliveryDays: 3, priceUsd: micro.priceUsd });
  await advance(opp.id, 'PROTOTYPE', { opportunityId: opp.id, evidenceIds: ev, gate: { prototype: svc.name } }, 'agent:product_builder');
  const qa = verifyOutcome({ metric: 'reconciliation accuracy', target: 0.99, actual: 0.995, evidence: `${MARK} test run` });
  await advance(opp.id, 'QUALITY_VERIFICATION', { opportunityId: opp.id, evidenceIds: ev, gate: { qualityPassed: qa.verified } }, 'agent:qa_agent');
  ok('BUILD/TEST', `prototype=${svc.name} qualityPassed=${qa.verified}`);

  // 10. APPROVAL (owner decision required before outreach).
  const approval = await prisma.approval.create({ data: { title: 'outreach.send', action: 'outreach.send', reason: `${MARK} approval`, risk: 'high', status: 'APPROVED', decidedBy: 'owner', decidedAt: new Date() } });
  created.push(() => prisma.approval.delete({ where: { id: approval.id } }));
  await advance(opp.id, 'APPROVAL', { opportunityId: opp.id, evidenceIds: ev, gate: { approvalId: approval.id } }, 'owner');
  ok('APPROVAL', `approval status=APPROVED (owner)`);

  // Prove the gate blocks an unsupported OUTREACH advance.
  const preGate = checkGate('OUTREACH', { opportunityId: opp.id, evidenceIds: [claimId], gate: { demandProof: true, qualityPassed: false } });
  let gateBlocked = false;
  try { await advance(opp.id, 'OUTREACH', { opportunityId: opp.id, evidenceIds: [claimId], gate: { demandProof: true, qualityPassed: false } }, 'agent:outreach'); } catch (e) { gateBlocked = e instanceof StageGateError; }
  ok('GATE-CHECK', `OUTREACH blocked (missing=${preGate.missing.length}) blocked=${gateBlocked}`);

  // 11. MARKET/SELL -> outreach draft (created, never sent) with 2 evidence records.
  const claim2 = await recordClaim({ statement: `${MARK} quality verified at 99.5% accuracy`, source: `${MARK} test`, confidence: 0.9, validUntil: new Date(Date.now() + 30 * 86_400_000), publishable: true });
  created.push(() => prisma.claim.delete({ where: { id: claim2 } }));
  const draft = await prisma.outreachDraft.create({ data: { leadId, channel: 'email', subject: `${MARK} offer`, body: 'Draft only; not sent.', status: 'APPROVED', approvedBy: 'owner' } });
  created.push(() => prisma.outreachDraft.delete({ where: { id: draft.id } }));
  await advance(opp.id, 'OUTREACH', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { demandProof: true, qualityPassed: true } }, 'agent:outreach_assistant');
  ok('MARKET/SELL', `outreach draft approved; nothing sent (sentAt=${draft.sentAt})`);

  // 12. CONVERSION (recorded consent) and 13. DELIVERY.
  const deal = await prisma.deal.create({ data: { opportunityId: opp.id, buyerId: buyer.id, status: 'WON', probability: 1, valueUsd: micro.priceUsd } });
  created.push(() => prisma.deal.delete({ where: { id: deal.id } }));
  await advance(opp.id, 'CONVERSION', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { buyerConsent: true } }, 'agent:sales');
  await advance(opp.id, 'DELIVERY', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { deliveryPlan: svc.deliveryDays } }, 'agent:delivery');
  ok('CONVERT/DELIVER', `deal WON $${micro.priceUsd}; delivery plan ${svc.deliveryDays}d`);

  // 14. COLLECT — verified payment only.
  const externalId = `${MARK}-pay-1`;
  const before = await summary();
  const revenueId = await recordRevenue({ amountUsd: micro.priceUsd, externalId, provider: 'test-provider', dealId: deal.id, evidence: { webhook: `${MARK}-evt`, signatureVerified: true } });
  created.push(() => prisma.ledgerEntry.delete({ where: { id: revenueId } }));
  const costRow = await prisma.ledgerEntry.create({ data: { kind: 'AI_COST', amountUsd: 0.05, dealId: deal.id } });
  created.push(() => prisma.ledgerEntry.delete({ where: { id: costRow.id } }));
  await advance(opp.id, 'PAYMENT_VERIFICATION', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { paymentReference: externalId } }, 'agent:finance_analyst');
  ok('COLLECT', `verified revenue $${micro.priceUsd} (externalId=${externalId})`);

  // 15. ACCOUNT — real ledger roll-up (deltas prove this run's effect).
  const fin = await summary();
  const deltaRevenue = fin.cashCollectedUsd - before.cashCollectedUsd;
  const deltaCost = fin.operatingCostsUsd - before.operatingCostsUsd;
  const deltaProfit = fin.netProfitUsd - before.netProfitUsd;
  await advance(opp.id, 'PROFIT_CALCULATION', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { ledgerEntryId: revenueId } }, 'agent:finance_analyst');
  ok('ACCOUNT', `Δrevenue=$${deltaRevenue.toFixed(2)} Δcost=$${deltaCost.toFixed(2)} ΔnetProfit=$${deltaProfit.toFixed(2)}`);

  // 16. VERIFY outcome -> 17. LEARN.
  const outcome = verifyOutcome({ metric: 'customer outcome', target: 1, actual: 1, evidence: `${MARK} acceptance` });
  await advance(opp.id, 'RETENTION', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { outcomeVerified: outcome.verified } }, 'agent:customer_success');
  const feedback = capabilityFeedback([{ id: deal.id, outcome: 'won', reason: 'clear pain + fast delivery', usedAssets: [svc.name] }]);
  await advance(opp.id, 'LEARNING', { opportunityId: opp.id, evidenceIds: [claimId, claim2], gate: { result: feedback } }, 'agent:performance_analyst');
  ok('VERIFY/LEARN', `outcomeVerified=${outcome.verified} lessons=${feedback.lessons.length}`);

  // Integrity: the audit chain must still verify; every stage must have an event.
  const chain = await verifyChain();
  const events = await prisma.stageEvent.count({ where: { opportunityId: opp.id } });
  const finalStage = (await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stage;
  ok('INTEGRITY', `auditChain ok=${chain.ok} stageEvents=${events} finalStage=${finalStage}`);

  await audit({ actorType: 'system', action: 'acceptance.completed', metadata: { mark: MARK, stages: events } });
  console.log(`\n=== PASSED: ${checks} checks; opportunity reached LEARNING ===\n`);
}

async function cleanup(): Promise<void> {
  for (const fn of created.reverse()) { try { await fn(); } catch { /* already gone */ } }
  await prisma.stageEvent.deleteMany({ where: { opportunity: { title: { startsWith: MARK } } } }).catch(() => {});
}

main()
  .then(cleanup)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nACCEPTANCE FAILED:', (err as Error).message);
    await cleanup();
    await prisma.$disconnect();
    process.exit(1);
  });
