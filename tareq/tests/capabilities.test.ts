import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opportunityDNA,
  isRepeatable,
  wtpLab,
  ethicalPricingTestAllowed,
  publishableClaims,
  painToCash,
  demandCollisions,
  unservedNetwork,
  timingWindow,
  designPov,
  precursorDetector,
  sequenceLaunch,
  cannibalization,
  capacityForecast,
  marginLeakage,
  verifyOutcome,
  ethicalSimulation,
  dependencyBreaker,
  objectionEvidenceGraph,
  calibrate,
  recoveryInvestigator,
  assetYield,
  killSwitch,
  stressTest,
  switchingCost,
  crossBorderRoutes,
  collectionReliability,
  trustRepair,
  modelLab,
  ExperimentBudgetGovernor,
  attributeDeals,
  compensationPlan,
  hiddenWorkload,
  freshnessReport,
  productize,
  capabilityFeedback,
  collisions,
  firstDollarNavigator,
  govern,
} from '../src/lib/capabilities/engines.ts';
import type { OpportunityGenome, Evidence } from '../src/lib/commercial/types.ts';

const g = (over: Partial<OpportunityGenome> = {}): OpportunityGenome => ({
  problem: 'manual invoicing', painSeverity: 7, affectedBuyer: 'small agencies', costOfProblemUsd: 12000,
  currentSolutions: ['spreadsheets'], willingnessToPayUsd: 3000, buyingCycleDays: 30, competitionIntensity: 5,
  costToReachBuyerUsd: 200, potentialMarginPct: 60, confidence: 0.7, evidence: [], ...over,
});

// --- 64 DNA mapper -----------------------------------------------------------
test('64: identical genomes are repeatable, different ones are not', () => {
  const a = opportunityDNA(g());
  const b = opportunityDNA(g());
  const c = opportunityDNA(g({ affectedBuyer: 'enterprise logistics', painSeverity: 2, buyingCycleDays: 200 }));
  assert.ok(isRepeatable(a, b));
  assert.ok(!isRepeatable(a, c));
});

// --- 65 WTP lab --------------------------------------------------------------
test('65: WTP lab reports zero purchase rate when there are no purchases', () => {
  const out = wtpLab([{ priceUsd: 100, impressions: 100, trials: 10, purchases: 0 }]);
  assert.equal(out[0]!.purchaseRate, 0);
  assert.match(out[0]!.verdict, /no purchase yet/);
});

test('65: fabricated pricing tests are refused', () => {
  assert.equal(ethicalPricingTestAllowed('fake_purchase'), false);
  assert.equal(ethicalPricingTestAllowed('real_pilot'), true);
});

// --- 66 publishable claims ---------------------------------------------------
test('66: only verified, published, unexpired claims may be used', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const ids = publishableClaims(
    [
      { id: 'ok', publishable: true, verifiedAt: '2026-05-01T00:00:00Z', validUntil: '2026-12-01T00:00:00Z' },
      { id: 'unverified', publishable: true, verifiedAt: null },
      { id: 'expired', publishable: true, verifiedAt: '2026-01-01T00:00:00Z', validUntil: '2026-02-01T00:00:00Z' },
      { id: 'draft', publishable: false, verifiedAt: '2026-05-01T00:00:00Z' },
    ],
    now,
  );
  assert.deepEqual(ids, ['ok']);
});

// --- 67 Pain to cash ---------------------------------------------------------
test('67: pain-to-cash flags estimated value as needing measurement', () => {
  const r = painToCash({ problem: 'p', measured: {}, estimated: { saved: 1000 }, assumptions: ['assume 10h saved'], targetMarginPct: 40 });
  assert.match(r.valueProof, /estimated/);
  assert.equal(r.proposedPriceUsd, 600);
});

// --- 68 Collisions -----------------------------------------------------------
test('68: the same problem across two industries is a collision', () => {
  const out = demandCollisions([
    { industry: 'retail', problem: 'manual invoice processing' },
    { industry: 'logistics', problem: 'manual invoice processing' },
    { industry: 'retail', problem: 'shelf layout' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.industries.length, 2);
});

// --- 69 Unserved -------------------------------------------------------------
test('69: only economically servable and reachable segments are returned', () => {
  const out = unservedNetwork([
    { segment: 'good', whyUnserved: 'x', currentWorkaround: 'y', blocker: 'z', servableEconomically: true, reachable: true },
    { segment: 'bad', whyUnserved: 'x', currentWorkaround: 'y', blocker: 'z', servableEconomically: false, reachable: true },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.segment, 'good');
});

// --- 70 Timing ---------------------------------------------------------------
test('70: timing window opens only above the strength threshold', () => {
  assert.equal(timingWindow([{ name: 'fiscal year end', active: true, weight: 0.6 }]).open, true);
  assert.equal(timingWindow([{ name: 'quiet season', active: true, weight: 0.2 }]).open, false);
});

// --- 71 POV contract ---------------------------------------------------------
test('71: proof-of-value contract always needs owner review', () => {
  const c = designPov({ outcome: 'cut processing time', durationDays: 14, metrics: ['time < 2h'], priceUsd: 500, liabilityLimitUsd: 500 });
  assert.equal(c.requiresOwnerReview, true);
  assert.equal(c.acceptance.length, 1);
});

// --- 72 Precursor ------------------------------------------------------------
test('72: precursor detector never labels interest as revenue', () => {
  const r = precursorDetector([{ kind: 'quote_request', atMinutes: 0 }]);
  assert.equal(r.isRevenue, false);
});

// --- 73 Launch sequencer -----------------------------------------------------
test('73: launch plan stays inside the budget and has stop/scale rules', () => {
  const p = sequenceLaunch({ segment: 'agencies', budgetUsd: 50, maxDays: 30 });
  assert.ok(p.costUsd <= 20, 'must not exceed the default cap');
  assert.ok(p.stopRule.length > 0 && p.scaleRule.length > 0);
});

// --- 74 Cannibalization ------------------------------------------------------
test('74: an offer that only shifts revenue is harmful', () => {
  const r = cannibalization({ name: 'base', revenueUsd: 1000, marginPct: 50 }, { name: 'new', expectedShiftRevenueUsd: 300, expectedNewRevenueUsd: 100, marginPct: 50 });
  assert.equal(r.verdict, 'harmful');
});

// --- 75 Capacity -------------------------------------------------------------
test('75: capacity forecast refuses over-commitment', () => {
  const r = capacityForecast({ availableHoursPerWeek: 10, hoursPerUnit: 5, currentLoadHours: 100, weeks: 2 });
  assert.equal(r.maxUnits, 0);
  assert.equal(r.canAccept, false);
});

// --- 76 Margin leakage -------------------------------------------------------
test('76: leakage reports the worst leak and a fix', () => {
  const r = marginLeakage(
    [
      { kind: 'api', amountUsd: 30 },
      { kind: 'rework', amountUsd: 200 },
    ],
    1000,
  );
  assert.equal(r.worst!.kind, 'rework');
  assert.equal(r.leakagePct, 23);
  assert.ok(r.fixes.length > 0);
});

// --- 77 Outcome verification -------------------------------------------------
test('77: an outcome without evidence opens a review rather than claiming success', () => {
  const noEvidence = verifyOutcome({ metric: 'time', target: 2, actual: 1, direction: 'lower' });
  assert.equal(noEvidence.status, 'review');
  const noResult = verifyOutcome({ metric: 'time', target: 2, actual: null });
  assert.equal(noResult.status, 'review');
  const ok = verifyOutcome({ metric: 'time', target: 2, actual: 1, evidence: 'report-1', direction: 'lower' });
  assert.equal(ok.verified, true);
  const failed = verifyOutcome({ metric: 'time', target: 2, actual: 5, evidence: 'report-1', direction: 'lower' });
  assert.equal(failed.status, 'failed');
});

// --- 78 Ethical simulation ---------------------------------------------------
test('78: simulation refuses fabrication and requires documented data', () => {
  assert.equal(ethicalSimulation({ documentedDataPoints: 0, assumptions: [], scenario: {} }).allowed, false);
  assert.equal(ethicalSimulation({ documentedDataPoints: 3, assumptions: ['fabricate demand'], scenario: {} }).allowed, false);
  assert.equal(ethicalSimulation({ documentedDataPoints: 3, assumptions: ['assume 10% growth'], scenario: { revenue: 100 } }).allowed, true);
});

// --- 79 Dependency breaker ---------------------------------------------------
test('79: a 50%+ dependency is flagged', () => {
  const r = dependencyBreaker([{ kind: 'ai_provider', name: 'openai', sharePct: 90 }]);
  assert.equal(r.concentration.length, 1);
});

// --- 80 Objection graph ------------------------------------------------------
test('80: objections link to a cause and an evidence-backed answer', () => {
  const out = objectionEvidenceGraph([{ objection: 'too expensive', evidenceIds: ['c1'] }]);
  assert.equal(out[0]!.cause, 'value not yet proven');
  assert.deepEqual(out[0]!.evidenceIds, ['c1']);
});

// --- 81 Calibration ----------------------------------------------------------
test('81: systematic optimism is corrected', () => {
  const preds = Array.from({ length: 10 }, () => ({ predicted: 0.8, actual: false }));
  const { bias, calibrated } = calibrate(preds);
  assert.ok(bias > 0.5);
  assert.ok(calibrated(0.8) < 0.8);
});

// --- 82 Recovery -------------------------------------------------------------
test('82: recovery actions always require approval', () => {
  const out = recoveryInvestigator([{ kind: 'failed_payment', amountUsd: 100, daysOpen: 3 }]);
  assert.equal(out[0]!.requiresApproval, true);
});

// --- 83 Asset yield ----------------------------------------------------------
test('83: negative-yield assets are marked stop', () => {
  const out = assetYield([{ id: 'a', name: 'x', revenueAttributedUsd: 10, costUsd: 50 }]);
  assert.equal(out[0]!.verdict, 'stop');
});

// --- 84 Kill switch ----------------------------------------------------------
test('84: kill switch triggers on any breached criterion', () => {
  const criteria = { maxCostUsd: 20, minDemandScore: 0.2, maxFailures: 3, maxNegativeMarginDays: 30 };
  assert.equal(killSwitch(criteria, { spentUsd: 25, demandScore: 0.5, failures: 0, negativeMarginDays: 0, legalOrSecurityRisk: false }).kill, true);
  assert.equal(killSwitch(criteria, { spentUsd: 5, demandScore: 0.5, failures: 0, negativeMarginDays: 0, legalOrSecurityRisk: false }).kill, false);
  assert.equal(killSwitch(criteria, { spentUsd: 5, demandScore: 0.5, failures: 0, negativeMarginDays: 0, legalOrSecurityRisk: true }).kill, true);
});

// --- 85 Stress test ----------------------------------------------------------
test('85: stress test stays viable above cost', () => {
  const out = stressTest({ ourCostUsd: 10, ourPriceUsd: 50, competitorPriceUsd: 50 });
  assert.ok(out.every((s) => s.survivalPriceUsd > 10));
});

// --- 86 Switching cost -------------------------------------------------------
test('86: switching cost includes time and perceived risk, and offers a plan', () => {
  const r = switchingCost({ integrationHours: 5, trainingHours: 3, dataMigrationHours: 2, hourlyRateUsd: 50, perceivedRisk: 2 });
  assert.equal(r.costUsd, 5 * 50 + 3 * 50 + 2 * 50 + 200);
  assert.ok(r.plan.length >= 4);
});

// --- 87 Cross-border ---------------------------------------------------------
test('87: routes with legal restrictions are not allowed', () => {
  const out = crossBorderRoutes([
    { market: 'ok', reachable: true, paymentMethods: ['card'], legalRestrictions: [], taxPct: 5, collectionCostPct: 3, platformTermsOk: true },
    { market: 'restricted', reachable: true, paymentMethods: ['card'], legalRestrictions: ['sanctioned'], taxPct: 0, collectionCostPct: 0, platformTermsOk: true },
  ]);
  assert.equal(out[0]!.allowed, true);
  assert.equal(out.find((m) => m.market === 'restricted')!.allowed, false);
});

// --- 88 Collection reliability ----------------------------------------------
test('88: only net-collected counts at full value', () => {
  const r = collectionReliability([
    { stage: 'quote', amountUsd: 1000 },
    { stage: 'net_collected', amountUsd: 1000 },
  ]);
  assert.equal(r.expectedUsd, 1150);
});

// --- 89 Trust repair ---------------------------------------------------------
test('89: trust repair returns real, non-fabricated remedies', () => {
  const out = trustRepair('delivery_risk');
  assert.ok(out.some((s) => /pilot/.test(s)));
  assert.ok(!out.some((s) => /fake|review|testimonial/i.test(s)));
});

// --- 90 Model lab ------------------------------------------------------------
test('90: model lab ranks by lifetime value', () => {
  const out = modelLab([
    { model: 'subscription', monthlyRevenueUsd: 100, monthlyCostUsd: 20, retentionMonths: 24 },
    { model: 'service_fee', monthlyRevenueUsd: 500, monthlyCostUsd: 450, retentionMonths: 3 },
  ]);
  assert.equal(out[0]!.model, 'subscription');
});

// --- 91 Experiment governor --------------------------------------------------
test('91: experiment governor stops at the cap and refuses silent reinvestment', () => {
  const gov = new ExperimentBudgetGovernor(10);
  gov.commit(6);
  assert.equal(gov.canSpend(5), false);
  assert.throws(() => gov.commit(5), /budget exceeded/);
  assert.throws(() => gov.reinvest(), /owner approval/);
  assert.equal(gov.remaining(), 4);
});

// --- 92 Attribution ----------------------------------------------------------
test('92: each deal is attributed once under the chosen model', () => {
  const { attributed, duplicates } = attributeDeals(
    [
      { id: 'd1', touches: [{ channel: 'ads', at: '2026-01-01' }, { channel: 'email', at: '2026-02-01' }] },
      { id: 'd1', touches: [{ channel: 'ads', at: '2026-01-01' }] },
    ],
    'last',
  );
  assert.equal(attributed.length, 1);
  assert.equal(attributed[0]!.channel, 'email');
  assert.deepEqual(duplicates, ['d1']);
});

// --- 93 Compensation ---------------------------------------------------------
test('93: compensation plan always requires approval and picks the cheapest option', () => {
  const r = compensationPlan({ failureCostUsd: 100, cause: 'late delivery', options: [{ kind: 'redo', costUsd: 80 }, { kind: 'full_refund', costUsd: 200 }] });
  assert.equal(r.requiresApproval, true);
  assert.equal(r.recommended, 'redo');
});

// --- 94 Hidden workload ------------------------------------------------------
test('94: hidden workload is added to the offer price', () => {
  const r = hiddenWorkload({ supportHours: 2, revisionHours: 2, meetingHours: 1, reviewHours: 1, reworkHours: 2, hourlyRateUsd: 50 });
  assert.equal(r.hiddenHours, 8);
  assert.equal(r.hiddenCostUsd, 400);
  assert.ok(r.addToOfferUsd > 400);
});

// --- 95 Freshness ------------------------------------------------------------
test('95: freshness separates fresh from stale evidence', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const ev = (id: string, daysAgo: number): Evidence => ({ id, statement: 's', source: 'x', confidence: 0.5, collectedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), validForDays: 30 });
  const r = freshnessReport([ev('fresh', 5), ev('stale', 60)], now);
  assert.deepEqual(r.fresh, ['fresh']);
  assert.deepEqual(r.stale, ['stale']);
});

// --- 96 Productize -----------------------------------------------------------
test('96: productised service carries steps, checks and acceptance', () => {
  const t = productize({ name: 'Audit', steps: ['collect', 'analyse', 'report'], inputs: ['access'], qualityChecks: ['no PII leaked'], deliveryDays: 5, priceUsd: 500 });
  assert.equal(t.acceptance.length, 1);
  assert.equal(t.templates.length, 3);
});

// --- 97 Capability feedback --------------------------------------------------
test('97: feedback loop improves the assets used in won deals and records losses', () => {
  const r = capabilityFeedback([
    { id: 's1', outcome: 'won', reason: '', usedAssets: ['audit-template'] },
    { id: 's2', outcome: 'won', reason: '', usedAssets: ['audit-template'] },
    { id: 's3', outcome: 'lost', reason: 'price', usedAssets: [] },
  ]);
  assert.deepEqual(r.improve, ['audit-template']);
  assert.ok(r.lessons.some((l) => /price/.test(l)));
});

// --- 98 Collisions -----------------------------------------------------------
test('98: same buyer with overlapping commitments is a collision', () => {
  const out = collisions([
    { opportunityId: 'a', buyerId: 'B1', startDay: 1, endDay: 10, exclusive: false },
    { opportunityId: 'b', buyerId: 'B1', startDay: 5, endDay: 15, exclusive: false },
  ]);
  assert.equal(out.length, 1);
});

// --- 99 First dollar ---------------------------------------------------------
test('99: first-dollar navigator gates on evidence and never guarantees a sale', () => {
  const r = firstDollarNavigator({ problemChosen: true, demandEvidence: 0, offerReady: false, proofReady: false, buyersIdentified: 0, outreachApproved: false, closed: false, delivered: false, paid: false });
  assert.equal(r.nextStep, 'collect demand evidence');
  assert.ok(!/guarantee|ضمان/.test(JSON.stringify(r)));
});

// --- 100 Governance ----------------------------------------------------------
test('100: governance refuses over-budget, unapproved high-risk and unsupported actions', () => {
  const base = { mode: 'AUTONOMOUS', budgetRemainingUsd: 10, proposedCostUsd: 1, riskLevel: 'low' as const, hasApproval: false, evidenceCount: 2, dataSafe: true, marginPct: 30 };
  assert.equal(govern(base).allow, true);
  assert.equal(govern({ ...base, proposedCostUsd: 50 }).allow, false);
  assert.equal(govern({ ...base, riskLevel: 'critical' }).allow, false);
  assert.equal(govern({ ...base, riskLevel: 'critical', hasApproval: true }).allow, true);
  assert.equal(govern({ ...base, evidenceCount: 0 }).allow, false);
  assert.equal(govern({ ...base, marginPct: -5 }).allow, false);
  assert.equal(govern({ ...base, mode: 'OBSERVE' }).allow, false);
  assert.equal(govern({ ...base, dataSafe: false }).allow, false);
});
