import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenomeGraph,
  scoreIntent,
  advanceProof,
  demandProofPassed,
  compileRevenuePath,
  mapWhiteSpace,
  rankBuyersNow,
  lockDecisionMaker,
  scanValueLeak,
  ninetySecondProof,
  responsePriority,
  revivalCandidates,
  oneClickCashPath,
  forgeMicroOffer,
  shieldLeads,
  detectAnomalies,
  fusePainClusters,
  predictCompetitorMoves,
  expiryClock,
  demandMigration,
  autopsyFriction,
  offerFit,
  preemptObjections,
  frictionlessCheckout,
  conversationMomentum,
  criticalPath,
  arbitrageModel,
  mineAssets,
  CircuitBreaker,
  simulate,
  marginalProfit,
  cashflowSurvival,
  expansionGraph,
  riskPortfolio,
  causalityLab,
  type ProofState,
} from '../src/lib/commercial/engines.ts';
import { scoreGenome, type OpportunityGenome, type Evidence } from '../src/lib/commercial/types.ts';

// --- 29 Opportunity Genome ---------------------------------------------------
test('29: genome graph links problem, buyer, solutions and outcome', () => {
  const g: OpportunityGenome = {
    problem: 'manual invoicing', painSeverity: 7, affectedBuyer: 'small agencies', costOfProblemUsd: 12000,
    currentSolutions: ['spreadsheets'], willingnessToPayUsd: 3000, buyingCycleDays: 30, competitionIntensity: 5,
    costToReachBuyerUsd: 200, potentialMarginPct: 60, confidence: 0.7, evidence: [],
  };
  const graph = buildGenomeGraph(g);
  assert.ok(graph.nodes.some((n) => n.kind === 'problem'));
  assert.ok(graph.nodes.some((n) => n.kind === 'buyer'));
  assert.ok(graph.edges.some((e) => e.relation === 'affects'));
});

test('scoreGenome is bounded and confidence-weighted', () => {
  const base: OpportunityGenome = {
    problem: 'p', painSeverity: 10, affectedBuyer: 'b', costOfProblemUsd: 1000, currentSolutions: [],
    willingnessToPayUsd: 1000, buyingCycleDays: 1, competitionIntensity: 0, costToReachBuyerUsd: 1,
    potentialMarginPct: 100, confidence: 1, evidence: [],
  };
  const high = scoreGenome(base);
  const low = scoreGenome({ ...base, confidence: 0.1 });
  assert.ok(high > low, 'higher confidence must not lower the score');
  assert.ok(high <= 100 && high >= 0);
});

// --- 30 Buyer Intent ---------------------------------------------------------
test('30: intent score never reaches certainty and rises with stronger signals', () => {
  const weak = scoreIntent([{ kind: 'case_study_read', weight: 1, observedAt: new Date().toISOString() }]);
  const strong = scoreIntent([
    { kind: 'quote_request', weight: 1, observedAt: new Date().toISOString() },
    { kind: 'trial_request', weight: 1, observedAt: new Date().toISOString() },
  ]);
  assert.ok(strong.score > weak.score);
  assert.ok(strong.score <= 0.95, 'intent must never be 1.0');
});

// --- 31 Demand Proof Ladder --------------------------------------------------
test('31: proof ladder forbids skipping rungs and requires a payment ref for paid', () => {
  let s: ProofState = { rung: 'stated_interest', observations: ['asked about it'] };
  assert.throws(() => advanceProof(s, 'price_agreed', 'x'), /Cannot skip rungs/);
  s = advanceProof(s, 'problem_confirmed', 'confirmed the pain');
  s = advanceProof(s, 'budget_acknowledged', 'has budget');
  assert.ok(demandProofPassed(s));
  s = advanceProof(s, 'price_agreed', 'agreed price');
  assert.throws(() => advanceProof(s, 'paid', 'paid'), /payment reference/);
  s = advanceProof(s, 'paid', 'paid', 'stripe:pi_123');
  assert.equal(s.rung, 'paid');
});

// --- 32 Revenue Path Compiler ------------------------------------------------
test('32: revenue path respects the budget and reports profit', () => {
  const path = compileRevenuePath(
    [
      { action: 'pilot', costUsd: 5, days: 5, risk: 0.2, expectedRevenueUsd: 100 },
      { action: 'ads', costUsd: 500, days: 1, risk: 0.8, expectedRevenueUsd: 1000 },
    ],
    20,
  );
  assert.ok(path.totalCostUsd <= 20, 'must not exceed budget');
  assert.ok(path.steps.every((s) => s.action !== 'ads'));
  assert.equal(path.expectedProfitUsd, 100 - 5);
});

// --- 33 White space ----------------------------------------------------------
test('33: white-space ranks high-need low-coverage segments first', () => {
  const ranked = mapWhiteSpace([
    { segment: 'A', needIntensity: 9, solutionCoverage: 2 },
    { segment: 'B', needIntensity: 3, solutionCoverage: 8 },
  ]);
  assert.equal(ranked[0]!.segment, 'A');
});

// --- 34 Buyer-now radar ------------------------------------------------------
test('34: unreachable buyers are discounted', () => {
  const ranked = rankBuyersNow([
    { buyerId: 'reachable', intentScore: 0.8, urgencyDays: 5, reachableNow: true },
    { buyerId: 'unreachable', intentScore: 0.8, urgencyDays: 5, reachableNow: false },
  ]);
  assert.equal(ranked[0]!.buyerId, 'reachable');
});

// --- 35 Decision-maker lock --------------------------------------------------
test('35: only a sourced decision maker is locked', () => {
  assert.equal(lockDecisionMaker([{ name: 'X', role: 'CEO', isDecisionMaker: true }]), null);
  const locked = lockDecisionMaker([{ name: 'Y', role: 'CTO', isDecisionMaker: true, sourceUrl: 'https://example.com/y' }]);
  assert.equal(locked?.name, 'Y');
});

// --- 36 Value leak -----------------------------------------------------------
test('36: value leak sums base, wasted time and errors', () => {
  const leak = scanValueLeak({ currentCostUsd: 100, wastedHoursPerMonth: 10, hourlyRateUsd: 30, errorRatePct: 10, errorCostUsd: 1000 });
  assert.equal(leak.monthlyLeakUsd, 100 + 300 + 100);
  assert.equal(leak.annualLeakUsd, 6000);
});

// --- 37 90-second proof ------------------------------------------------------
test('37: proof script states estimates as estimates', () => {
  const p = ninetySecondProof('slow invoicing', 500, ['connect', 'automate', 'report']);
  assert.match(p.script, /estimated/);
  assert.equal(p.durationSec, 90);
});

// --- 38 Response time --------------------------------------------------------
test('38: priority decays with elapsed time', () => {
  const now = responsePriority({ kind: 'quote_request', weight: 1, observedAt: new Date().toISOString() }, 0);
  const later = responsePriority({ kind: 'quote_request', weight: 1, observedAt: new Date().toISOString() }, 180);
  assert.ok(now > later);
});

// --- 39 Deal revival ---------------------------------------------------------
test('39: only sufficiently dormant deals are revived, timing ranks highest', () => {
  const out = revivalCandidates([
    { id: 'recent', daysSinceContact: 3, originalIntent: 0.9 },
    { id: 'timing', daysSinceContact: 30, originalIntent: 0.9, reason: 'timing' },
    { id: 'competitor', daysSinceContact: 30, originalIntent: 0.9, reason: 'chose_competitor' },
  ]);
  assert.ok(!out.some((d) => d.id === 'recent'));
  assert.equal(out[0]!.id, 'timing');
});

// --- 40/41 offers ------------------------------------------------------------
test('40: cash path always requires owner approval', () => {
  assert.equal(oneClickCashPath('Audit', 250, 3).requiresOwnerApproval, true);
});

test('41: micro-offer price honours the target margin', () => {
  const o = forgeMicroOffer('clean data', 4, 25, 50);
  assert.equal(o.priceUsd, 200); // cost 100 / (1-0.5)
});

// --- 43 Lead shield ----------------------------------------------------------
test('43: lead shield blocks opt-outs and flags cross-owner conflicts', () => {
  const { conflicts, blocked } = shieldLeads([
    { leadId: 'L1', owner: 'A', optedOut: false },
    { leadId: 'L1', owner: 'B', optedOut: false },
    { leadId: 'L2', owner: 'A', optedOut: true },
  ]);
  assert.deepEqual(conflicts, ['L1']);
  assert.deepEqual(blocked, ['L2']);
});

// --- 44 Anomalies ------------------------------------------------------------
test('44: anomaly detector flags an outlier', () => {
  const out = detectAnomalies([10, 11, 10, 12, 11, 100, 10], 2);
  assert.ok(out.some((a) => a.value === 100));
});

// --- 45 Pain clusters --------------------------------------------------------
test('45: similar pains fuse into one cluster', () => {
  const clusters = fusePainClusters([
    { id: 'a', pain: 'manual invoice processing' },
    { id: 'b', pain: 'manual invoice entry' },
    { id: 'c', pain: 'warehouse lighting' },
  ]);
  const merged = clusters.find((c) => c.members.length === 2);
  assert.ok(merged);
});

// --- 46 Competitor predictor -------------------------------------------------
test('46: competitor predictor never claims certainty', () => {
  const moves = predictCompetitorMoves({ ourPriceUsd: 100, competitorPriceUsd: 80, ourDifferentiation: 0.2 });
  assert.ok(moves.every((m) => m.likelihood < 1));
});

// --- 47 Expiry ---------------------------------------------------------------
test('47: expiry clock separates expired from expiring soon', () => {
  const now = new Date('2026-01-31T00:00:00Z');
  const ev = (id: string, daysAgo: number, validForDays: number): Evidence => ({
    id, statement: 's', source: 'src', confidence: 0.5,
    collectedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), validForDays,
  });
  const { expired, expiringSoon } = expiryClock([ev('old', 60, 30), ev('soon', 25, 30), ev('fresh', 1, 30)], now);
  assert.deepEqual(expired, ['old']);
  assert.deepEqual(expiringSoon, ['soon']);
});

// --- 48 Migration ------------------------------------------------------------
test('48: demand migration reports trend', () => {
  assert.equal(demandMigration([{ period: 'Q1', demand: 100 }, { period: 'Q2', demand: 130 }]).trend, 'rising');
});

// --- 49 Friction -------------------------------------------------------------
test('49: friction autopsy names the top blocker and a fix', () => {
  const r = autopsyFriction([{ kind: 'training', severity: 0.3 }, { kind: 'risk', severity: 0.9 }]);
  assert.equal(r.top!.kind, 'risk');
  assert.ok(r.fixes[0]!.length > 0);
});

// --- 50 Offer fit ------------------------------------------------------------
test('50: offer fit warns when priced above willingness to pay', () => {
  const g: OpportunityGenome = {
    problem: 'p', painSeverity: 5, affectedBuyer: 'b', costOfProblemUsd: 1000, currentSolutions: [],
    willingnessToPayUsd: 100, buyingCycleDays: 30, competitionIntensity: 5, costToReachBuyerUsd: 10,
    potentialMarginPct: 50, confidence: 0.5, evidence: [],
  };
  const { notes } = offerFit(g, { priceUsd: 500, marginPct: 50, deliveryDays: 5 });
  assert.ok(notes.some((n) => /above stated willingness/.test(n)));
});

// --- 51 Objections -----------------------------------------------------------
test('51: objections are categorised and answered', () => {
  const out = preemptObjections(['too expensive', 'I do not trust new vendors']);
  assert.equal(out[0]!.category, 'price');
  assert.equal(out[1]!.category, 'trust');
});

// --- 52 Frictionless ---------------------------------------------------------
test('52: approval requirement raises purchase friction', () => {
  const simple = frictionlessCheckout({ priceUsd: 100, needsInvoice: false, needsApproval: false });
  const complex = frictionlessCheckout({ priceUsd: 100, needsInvoice: true, needsApproval: true });
  assert.ok(complex.friction > simple.friction);
});

// --- 53 Momentum -------------------------------------------------------------
test('53: a long buyer silence lowers momentum', () => {
  const hot = conversationMomentum([{ from: 'us', atMinutes: 0 }, { from: 'buyer', atMinutes: 10 }]);
  const cold = conversationMomentum([{ from: 'us', atMinutes: 0 }, { from: 'buyer', atMinutes: 10 }, { from: 'us', atMinutes: 4000 }]);
  assert.ok(hot.momentum > cold.momentum);
});

// --- 54 Critical path --------------------------------------------------------
test('54: critical path is the longest dependency chain', () => {
  const cp = criticalPath([
    { id: 'a', days: 2, deps: [] },
    { id: 'b', days: 3, deps: ['a'] },
    { id: 'c', days: 1, deps: ['a'] },
    { id: 'd', days: 4, deps: ['b'] },
  ]);
  assert.deepEqual(cp.path, ['a', 'b', 'd']);
  assert.equal(cp.days, 9);
});

// --- 55 Arbitrage ------------------------------------------------------------
test('55: trivial work routes to the cheaper provider', () => {
  assert.equal(arbitrageModel('trivial').provider, 'deepseek');
  assert.equal(arbitrageModel('complex').model, 'gpt-4o');
});

// --- 56 Assets ---------------------------------------------------------------
test('56: asset miner ranks by ROI and retires losers', () => {
  const out = mineAssets([
    { id: 'good', kind: 'template', reuseCount: 10, buildCostUsd: 100, savedPerReuseUsd: 50 },
    { id: 'bad', kind: 'tool', reuseCount: 0, buildCostUsd: 100, savedPerReuseUsd: 50 },
  ]);
  assert.equal(out[0]!.id, 'good');
  assert.equal(out.find((a) => a.id === 'bad')!.verdict, 'retire');
});

// --- 57 Circuit breaker ------------------------------------------------------
test('57: circuit breaker opens after threshold and half-opens after cooldown', () => {
  const cb = new CircuitBreaker(2, 1000);
  cb.record(false, 0);
  assert.equal(cb.state(0), 'closed');
  cb.record(false, 0);
  assert.equal(cb.state(0), 'open');
  assert.equal(cb.canAttempt(500), false);
  assert.equal(cb.canAttempt(1500), true);
  assert.equal(cb.state(1500), 'half-open');
});

// --- 58 Simulator ------------------------------------------------------------
test('58: simulator computes break-even units', () => {
  const s = simulate({ priceUsd: 100, unitCostUsd: 60, expectedVolume: 100, fixedCostUsd: 1000 });
  assert.equal(s.breakEvenUnits, 25);
  assert.equal(s.profitUsd, 3000);
});

// --- 59 Marginal profit ------------------------------------------------------
test('59: negative marginal profit says stop', () => {
  assert.equal(marginalProfit(100, 120).decision, 'stop');
  assert.equal(marginalProfit(100, 60, 50).decision, 'stop');
  assert.equal(marginalProfit(100, 60).decision, 'sell');
});

// --- 60 Cashflow -------------------------------------------------------------
test('60: cashflow survival alerts under three months in the worst case', () => {
  const r = cashflowSurvival(3000, 2000, 1500, 500);
  assert.ok(r.runwayMonthsWorst <= 2);
  assert.equal(r.alert, true);
});

// --- 61 Expansion ------------------------------------------------------------
test('61: expansion prioritises high-fit high-price offers', () => {
  const out = expansionGraph(100, [
    { name: 'low', priceUsd: 50, fit: 0.2 },
    { name: 'high', priceUsd: 500, fit: 0.9 },
  ]);
  assert.equal(out[0]!.name, 'high');
});

// --- 62 Portfolio ------------------------------------------------------------
test('62: portfolio discounts by probability and risk', () => {
  const { ranked } = riskPortfolio([
    { id: 'safe', expectedProfitUsd: 1000, probability: 0.8, risk: 0.1 },
    { id: 'risky', expectedProfitUsd: 1000, probability: 0.8, risk: 0.9 },
  ]);
  assert.equal(ranked[0]!.id, 'safe');
});

// --- 63 Causality ------------------------------------------------------------
test('63: causality refuses a claim without a control group', () => {
  const noControl = causalityLab({ treated: 10, control: 0, treatedN: 100, controlN: 0 });
  assert.equal(noControl.confident, false);
  assert.match(noControl.note, /no control group/);
  const good = causalityLab({ treated: 120, control: 100, treatedN: 100, controlN: 100 });
  assert.equal(good.confident, true);
  assert.equal(good.liftPct, 20);
});
