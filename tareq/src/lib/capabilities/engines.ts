import { clamp, round2, type Evidence, isStale, type OpportunityGenome } from '../commercial/types.ts';
import { CircuitBreaker } from '../commercial/engines.ts';

/**
 * New capabilities — directive groups 64 to 100.
 *
 * Same contract as the commercial engines: pure, deterministic, testable
 * functions. Each maps 1:1 to a group number for the acceptance table.
 */

// ---------------------------------------------------------------------------
// 64. Revenue Opportunity DNA Mapper
// ---------------------------------------------------------------------------

export interface OpportunityDNA extends OpportunityGenome {
  fingerprint: string;
}

/**
 * Build a stable fingerprint so a new opportunity can be matched against past
 * ones and judged "repeatable" vs "one-off".
 */
export function opportunityDNA(g: OpportunityGenome): OpportunityDNA {
  const fingerprint = [
    g.affectedBuyer.toLowerCase().replace(/\W+/g, '-').slice(0, 24),
    Math.round(g.painSeverity),
    Math.round(g.willingnessToPayUsd / 100),
    Math.round(g.buyingCycleDays / 10),
  ].join(':');
  return { ...g, fingerprint };
}

export function isRepeatable(a: OpportunityDNA, b: OpportunityDNA, threshold = 0.75): boolean {
  return a.fingerprint === b.fingerprint || similarity(a.fingerprint, b.fingerprint) >= threshold;
}

function similarity(a: string, b: string): number {
  const A = new Set(a.split(/[:.\-]+/).filter(Boolean));
  const B = new Set(b.split(/[:.\-]+/).filter(Boolean));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;
  return inter / union;
}

// ---------------------------------------------------------------------------
// 65. Live Willingness-to-Pay Laboratory
// ---------------------------------------------------------------------------

export interface WtpTest {
  priceUsd: number;
  impressions: number;
  trials: number;
  purchases: number;
}

/**
 * Distinguish interest from willingness to pay. Conversion is measured, not
 * predicted, and a test with no real purchases reports zero — never a guess.
 */
export function wtpLab(tests: WtpTest[]): Array<{ priceUsd: number; trialRate: number; purchaseRate: number; verdict: string }> {
  return tests.map((t) => {
    const trialRate = t.impressions > 0 ? round2(t.trials / t.impressions) : 0;
    const purchaseRate = t.trials > 0 ? round2(t.purchases / t.trials) : 0;
    const verdict = t.purchases > 0 ? 'real willingness to pay observed' : t.trials > 0 ? 'interest shown, no purchase yet' : 'no signal yet';
    return { priceUsd: t.priceUsd, trialRate, purchaseRate, verdict };
  });
}

/** Ethical pricing tests only: no fake purchases, no fake reviews. */
export function ethicalPricingTestAllowed(kind: string): boolean {
  const banned = ['fake_purchase', 'fake_review', 'fake_inventory', 'false_scarcity', 'impersonation'];
  return !banned.includes(kind);
}

// ---------------------------------------------------------------------------
// 66. Pre-Sale Evidence Vault  (see memory/evidence.ts for the DB gate)
// ---------------------------------------------------------------------------

/** Filter a set of claims down to those safe to publish right now. */
export function publishableClaims(claims: Array<{ id: string; publishable: boolean; verifiedAt?: string | null; validUntil?: string | null }>, now = new Date()): string[] {
  return claims
    .filter((c) => c.publishable && c.verifiedAt && (!c.validUntil || new Date(c.validUntil) > now))
    .map((c) => c.id);
}

// ---------------------------------------------------------------------------
// 67. Customer Pain-to-Cash Compiler
// ---------------------------------------------------------------------------

export interface PainToCash {
  measured: Record<string, number>;
  estimated: Record<string, number>;
  assumptions: string[];
  proposedPriceUsd: number;
  valueProof: string;
  purchasePath: string[];
}

/** Compile a pain into a cash path, keeping measured and estimated apart. */
export function painToCash(input: { problem: string; measured: Record<string, number>; estimated: Record<string, number>; assumptions: string[]; targetMarginPct: number }): PainToCash {
  const estBenefit = Object.values(input.estimated).reduce((a, b) => a + b, 0);
  const measuredBenefit = Object.values(input.measured).reduce((a, b) => a + b, 0);
  const anchor = measuredBenefit > 0 ? measuredBenefit : estBenefit;
  const price = anchor * (1 - clamp(input.targetMarginPct, 0, 90) / 100);
  return {
    measured: input.measured,
    estimated: input.estimated,
    assumptions: input.assumptions,
    proposedPriceUsd: round2(price),
    valueProof: measuredBenefit > 0 ? 'value is measured from real numbers' : 'value is estimated — must be measured before pricing is final',
    purchasePath: ['agree the metric', 'run a small paid pilot', 'measure the result', 'scale only if the metric is met'],
  };
}

// ---------------------------------------------------------------------------
// 68. Demand Collision Detector
// ---------------------------------------------------------------------------

/** Find the same underlying problem appearing across different industries. */
export function demandCollisions(items: Array<{ industry: string; problem: string }>, minIndustries = 2): Array<{ problem: string; industries: string[] }> {
  const byProblem = new Map<string, Set<string>>();
  for (const it of items) {
    const key = it.problem.toLowerCase().replace(/\W+/g, ' ').trim();
    if (!byProblem.has(key)) byProblem.set(key, new Set());
    byProblem.get(key)!.add(it.industry);
  }
  return [...byProblem.entries()]
    .filter(([, set]) => set.size >= minIndustries)
    .map(([problem, set]) => ({ problem, industries: [...set] }));
}

// ---------------------------------------------------------------------------
// 69. Unserved Buyer Network
// ---------------------------------------------------------------------------

export interface UnservedBuyer { segment: string; whyUnserved: string; currentWorkaround: string; blocker: string; servableEconomically: boolean; reachable: boolean }

/** Surface segments that can be served profitably and reached lawfully. */
export function unservedNetwork(buyers: UnservedBuyer[]): UnservedBuyer[] {
  return buyers.filter((b) => b.servableEconomically && b.reachable);
}

// ---------------------------------------------------------------------------
// 70. Commercial Timing Window Engine
// ---------------------------------------------------------------------------

/** Use only public, lawful timing signals (e.g. fiscal period, season). */
export function timingWindow(signals: Array<{ name: string; active: boolean; weight: number }>): { open: boolean; strength: number; note: string } {
  const strength = round2(clamp(signals.filter((s) => s.active).reduce((a, b) => a + b.weight, 0), 0, 1));
  return {
    open: strength >= 0.5,
    strength,
    note: 'based on public calendar/seasonal signals only; no private or invasive data',
  };
}

// ---------------------------------------------------------------------------
// 71. Proof-of-Value Contract Designer
// ---------------------------------------------------------------------------

export interface PovContract {
  scope: string;
  durationDays: number;
  metrics: string[];
  responsibilities: { us: string[]; buyer: string[] };
  acceptance: string[];
  priceUsd: number;
  liabilityLimitUsd: number;
  requiresOwnerReview: true;
}

/** Draft a paid, time-boxed proof. Always surfaced to the owner; never auto-signed. */
export function designPov(input: { outcome: string; durationDays: number; metrics: string[]; priceUsd: number; liabilityLimitUsd: number }): PovContract {
  return {
    scope: `Deliver and measure: ${input.outcome}`,
    durationDays: input.durationDays,
    metrics: input.metrics,
    responsibilities: {
      us: ['deliver the scoped outcome', 'report measured results', 'support during the period'],
      buyer: ['provide timely access and feedback', 'name one decision contact', 'confirm acceptance on the metric'],
    },
    acceptance: input.metrics.map((m) => `metric met: ${m}`),
    priceUsd: round2(input.priceUsd),
    liabilityLimitUsd: round2(input.liabilityLimitUsd),
    requiresOwnerReview: true,
  };
}

// ---------------------------------------------------------------------------
// 72. Revenue Precursor Detector
// ---------------------------------------------------------------------------

/** Precursors are interest, never income. Output is explicitly not revenue. */
export function precursorDetector(events: Array<{ kind: string; atMinutes: number }>): { score: number; isRevenue: false; note: string } {
  const weights: Record<string, number> = { quote_request: 1, trial_request: 0.8, pricing_view: 0.4, integration_question: 0.6, case_study_view: 0.3 };
  const score = round2(clamp(events.reduce((a, e) => a + (weights[e.kind] ?? 0.2), 0) / 3, 0, 1));
  return { score, isRevenue: false, note: 'interest signals only; revenue is recorded only after verified collection' };
}

// ---------------------------------------------------------------------------
// 73. Micro-Market Launch Sequencer
// ---------------------------------------------------------------------------

export interface LaunchPlan { segment: string; sampleSize: number; durationDays: number; costUsd: number; successMetric: string; stopRule: string; scaleRule: string }

export function sequenceLaunch(input: { segment: string; budgetUsd: number; maxDays: number }): LaunchPlan {
  return {
    segment: input.segment,
    sampleSize: Math.max(10, Math.min(100, Math.floor(input.budgetUsd))),
    durationDays: Math.min(input.maxDays, 14),
    costUsd: round2(Math.min(input.budgetUsd, 20)),
    successMetric: 'at least one verified paid pilot, or >=10% trial-to-paid conversion',
    stopRule: 'stop if cost reaches the budget, or zero paid signal after the window',
    scaleRule: 'scale only if the success metric is met with measured numbers',
  };
}

// ---------------------------------------------------------------------------
// 74. Offer Cannibalization Sentinel
// ---------------------------------------------------------------------------

/** Flag a new offer that shifts sales without increasing net revenue. */
export function cannibalization(existing: { name: string; revenueUsd: number; marginPct: number }, added: { name: string; expectedShiftRevenueUsd: number; expectedNewRevenueUsd: number; marginPct: number }): { netDeltaUsd: number; verdict: 'safe' | 'dilutive' | 'harmful' } {
  const netDelta = added.expectedNewRevenueUsd - added.expectedShiftRevenueUsd;
  const marginDrop = added.marginPct < existing.marginPct - 5;
  const verdict = netDelta <= 0 ? 'harmful' : marginDrop ? 'dilutive' : 'safe';
  return { netDeltaUsd: round2(netDelta), verdict };
}

// ---------------------------------------------------------------------------
// 75. Delivery Capacity Forecaster
// ---------------------------------------------------------------------------

/** Refuse to sell what cannot be delivered on time and at quality. */
export function capacityForecast(input: { availableHoursPerWeek: number; hoursPerUnit: number; currentLoadHours: number; weeks: number }): { maxUnits: number; canAccept: boolean; note: string } {
  const capacity = input.availableHoursPerWeek * input.weeks - input.currentLoadHours;
  const maxUnits = Math.max(0, Math.floor(capacity / Math.max(0.01, input.hoursPerUnit)));
  return { maxUnits, canAccept: maxUnits > 0, note: maxUnits > 0 ? 'capacity available' : 'at capacity — do not accept new delivery commitments' };
}

// ---------------------------------------------------------------------------
// 76. Margin Leakage Forensics
// ---------------------------------------------------------------------------

export interface LeakageItem { kind: 'fees' | 'api' | 'hosting' | 'time' | 'discount' | 'rework' | 'refunds' | 'support'; amountUsd: number }

export function marginLeakage(items: LeakageItem[], revenueUsd: number): { totalUsd: number; leakagePct: number; worst: LeakageItem | null; fixes: string[] } {
  const total = round2(items.reduce((a, b) => a + b.amountUsd, 0));
  const worst = items.length ? [...items].sort((a, b) => b.amountUsd - a.amountUsd)[0]! : null;
  const fixesMap: Record<LeakageItem['kind'], string> = {
    fees: 'renegotiate or switch payment fees; price them in',
    api: 'cache and route to cheaper models (group 55)',
    hosting: 'right-size the plan and stop idle services',
    time: 'productise the delivery (group 96)',
    discount: 'require a measured reason for every discount',
    rework: 'add a pre-delivery quality gate (group 77)',
    refunds: 'tighten acceptance criteria up front',
    support: 'document common questions to cut support time',
  };
  return {
    totalUsd: total,
    leakagePct: revenueUsd > 0 ? round2((total / revenueUsd) * 100) : 0,
    worst,
    fixes: worst ? [fixesMap[worst.kind]] : [],
  };
}

// ---------------------------------------------------------------------------
// 77. Customer Outcome Verification Engine
// ---------------------------------------------------------------------------

/** The agent may not claim an outcome it cannot evidence. */
export function verifyOutcome(input: { metric: string; target: number; actual: number | null; evidence?: string; direction?: 'higher' | 'lower' }): { verified: boolean; status: 'verified' | 'failed' | 'review'; note: string } {
  if (input.actual === null) return { verified: false, status: 'review', note: 'no measured result yet — open a review, do not claim success' };
  const dir = input.direction ?? 'higher';
  const met = dir === 'higher' ? input.actual >= input.target : input.actual <= input.target;
  return {
    verified: met && Boolean(input.evidence),
    status: met ? (input.evidence ? 'verified' : 'review') : 'failed',
    note: met ? (input.evidence ? 'outcome verified with evidence' : 'metric met but evidence missing') : 'metric not met',
  };
}

// ---------------------------------------------------------------------------
// 78. Ethical Demand Validation Simulator
// ---------------------------------------------------------------------------

/** Simulate with documented data and explicit assumptions; never fake demand. */
export function ethicalSimulation(input: { documentedDataPoints: number; assumptions: string[]; scenario: Record<string, number> }): { allowed: boolean; reason: string; result: Record<string, number> } {
  const banned = input.assumptions.some((a) => /fake|fabricat|invent|falsif/i.test(a));
  if (banned) return { allowed: false, reason: 'an assumption describes fabricating data — refused', result: {} };
  if (input.documentedDataPoints < 1) return { allowed: false, reason: 'no documented data points — simulation would be speculation', result: {} };
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.scenario)) result[k] = round2(v);
  return { allowed: true, reason: `based on ${input.documentedDataPoints} documented data points`, result };
}

// ---------------------------------------------------------------------------
// 79. Revenue Dependency Breaker
// ---------------------------------------------------------------------------

export function dependencyBreaker(sources: Array<{ kind: 'customer' | 'platform' | 'supplier' | 'channel' | 'ai_provider'; name: string; sharePct: number }>): { concentration: Array<{ kind: string; name: string; sharePct: number; risk: string }>; advice: string[] } {
  const concentration = sources
    .filter((s) => s.sharePct >= 50)
    .map((s) => ({ kind: s.kind, name: s.name, sharePct: s.sharePct, risk: `${s.kind} dependency at ${s.sharePct}%` }));
  const advice = concentration.length
    ? ['diversify gradually: add one alternative source before removing the incumbent', 'do not fragment focus for less than a 20% risk reduction']
    : ['concentration within tolerance'];
  return { concentration, advice };
}

// ---------------------------------------------------------------------------
// 80. Buyer Objection Evidence Graph
// ---------------------------------------------------------------------------

/** Link each objection to its real cause and the evidence that answers it. */
export function objectionEvidenceGraph(objections: Array<{ objection: string; evidenceIds: string[] }>): Array<{ objection: string; cause: string; answer: string; evidenceIds: string[] }> {
  return objections.map((o) => {
    const l = o.objection.toLowerCase();
    const cause = /price|cost|expensive|سعر/.test(l) ? 'value not yet proven' : /trust|risk|ثقة/.test(l) ? 'perceived delivery risk' : /time|later|وقت/.test(l) ? 'no compelling trigger' : 'unclear fit';
    const answer = cause === 'value not yet proven' ? 'show measured value vs price' : cause === 'perceived delivery risk' ? 'offer a paid pilot with acceptance criteria' : cause === 'no compelling trigger' ? 'agree a concrete trigger date' : 'demonstrate the exact task on their sample';
    return { objection: o.objection, cause, answer, evidenceIds: o.evidenceIds };
  });
}

// ---------------------------------------------------------------------------
// 81. Deal Probability Calibration Engine
// ---------------------------------------------------------------------------

/** Compare predictions with outcomes and shrink systematic optimism. */
export function calibrate(predictions: Array<{ predicted: number; actual: boolean }>): { bias: number; calibrated: (p: number) => number; sample: number } {
  const n = predictions.length;
  if (n === 0) return { bias: 0, calibrated: (p) => p, sample: 0 };
  const avgPredicted = predictions.reduce((a, b) => a + b.predicted, 0) / n;
  const actualRate = predictions.filter((p) => p.actual).length / n;
  const bias = round2(avgPredicted - actualRate);
  return { bias, calibrated: (p) => round2(clamp(p - bias, 0, 1)), sample: n };
}

// ---------------------------------------------------------------------------
// 82. Revenue Recovery Investigator
// ---------------------------------------------------------------------------

export interface RecoveryItem { kind: 'uncollected_invoice' | 'failed_payment' | 'stalled_subscription' | 'due_renewal' | 'undelivered_unbilled'; amountUsd: number; daysOpen: number }

/** Propose lawful, owner-approved recovery actions. Never moves money. */
export function recoveryInvestigator(items: RecoveryItem[]): Array<RecoveryItem & { action: string; requiresApproval: true }> {
  const actions: Record<RecoveryItem['kind'], string> = {
    uncollected_invoice: 'send a polite reminder and a payment link; escalate only with owner approval',
    failed_payment: 'notify the customer and offer a retry link; never charge silently',
    stalled_subscription: 'ask whether to pause or resume; do not auto-charge',
    due_renewal: 'send a renewal notice with the measured value delivered',
    undelivered_unbilled: 'invoice for delivered work after confirming the deliverable with the customer',
  };
  return items.map((i) => ({ ...i, action: actions[i.kind], requiresApproval: true as const }));
}

// ---------------------------------------------------------------------------
// 83. Commercial Asset Yield Monitor
// ---------------------------------------------------------------------------

export function assetYield(assets: Array<{ id: string; name: string; revenueAttributedUsd: number; costUsd: number }>): Array<{ id: string; name: string; yieldUsd: number; verdict: 'develop' | 'hold' | 'stop' }> {
  return assets
    .map((a) => {
      const yieldUsd = round2(a.revenueAttributedUsd - a.costUsd);
      const verdict: 'develop' | 'hold' | 'stop' = yieldUsd > 0 ? 'develop' : yieldUsd === 0 ? 'hold' : 'stop';
      return { id: a.id, name: a.name, yieldUsd, verdict };
    })
    .sort((a, b) => b.yieldUsd - a.yieldUsd);
}

// ---------------------------------------------------------------------------
// 84. Opportunity Kill-Switch Intelligence
// ---------------------------------------------------------------------------

export interface KillCriteria { maxCostUsd: number; minDemandScore: number; maxFailures: number; maxNegativeMarginDays: number }

/** Evaluate pre-declared kill criteria against current state. */
export function killSwitch(criteria: KillCriteria, state: { spentUsd: number; demandScore: number; failures: number; negativeMarginDays: number; legalOrSecurityRisk: boolean }): { kill: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (state.spentUsd > criteria.maxCostUsd) reasons.push(`cost exceeded cap ($${state.spentUsd} > $${criteria.maxCostUsd})`);
  if (state.demandScore < criteria.minDemandScore) reasons.push(`demand below threshold (${state.demandScore} < ${criteria.minDemandScore})`);
  if (state.failures >= criteria.maxFailures) reasons.push(`repeated failures (${state.failures})`);
  if (state.negativeMarginDays > criteria.maxNegativeMarginDays) reasons.push(`negative margin for ${state.negativeMarginDays} days`);
  if (state.legalOrSecurityRisk) reasons.push('legal or security risk present');
  return { kill: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// 85. Competitive Response Stress Tester
// ---------------------------------------------------------------------------

export function stressTest(input: { ourCostUsd: number; ourPriceUsd: number; competitorPriceUsd: number }): Array<{ scenario: string; survivalPriceUsd: number; viable: boolean }> {
  const scenarios = [
    { scenario: 'competitor cuts price 20%', competitorPriceUsd: input.competitorPriceUsd * 0.8 },
    { scenario: 'competitor cuts price 40%', competitorPriceUsd: input.competitorPriceUsd * 0.6 },
  ];
  return scenarios.map((s) => {
    const survivalPrice = Math.max(input.ourCostUsd * 1.15, s.competitorPriceUsd);
    return { scenario: s.scenario, survivalPriceUsd: round2(survivalPrice), viable: survivalPrice > input.ourCostUsd };
  });
}

// ---------------------------------------------------------------------------
// 86. Customer Switching Cost Mapper
// ---------------------------------------------------------------------------

export function switchingCost(input: { integrationHours: number; trainingHours: number; dataMigrationHours: number; hourlyRateUsd: number; perceivedRisk: number }): { costUsd: number; plan: string[] } {
  const hours = input.integrationHours + input.trainingHours + input.dataMigrationHours;
  return {
    costUsd: round2(hours * input.hourlyRateUsd + input.perceivedRisk * 100),
    plan: [
      'provide a ready connector to cut integration time',
      'include onboarding to cut training time',
      'run a guided import with a rollback point',
      'reduce perceived risk with a paid pilot and acceptance criteria',
    ],
  };
}

// ---------------------------------------------------------------------------
// 87. Cross-Border Revenue Route Planner
// ---------------------------------------------------------------------------

export interface MarketRoute { market: string; reachable: boolean; paymentMethods: string[]; legalRestrictions: string[]; taxPct: number; collectionCostPct: number; platformTermsOk: boolean }

/** Compare markets on lawful, practical criteria. Sanctions are never bypassed. */
export function crossBorderRoutes(routes: MarketRoute[]): Array<MarketRoute & { score: number; allowed: boolean }> {
  return routes
    .map((r) => {
      const allowed = r.reachable && r.platformTermsOk && r.legalRestrictions.length === 0;
      const score = round2(clamp((allowed ? 1 : 0) * (1 - (r.taxPct + r.collectionCostPct) / 100), 0, 1));
      return { ...r, score, allowed };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// 88. Revenue Collection Reliability Score
// ---------------------------------------------------------------------------

export type MoneyStage = 'quote' | 'purchase_order' | 'invoice' | 'pending_payment' | 'confirmed_payment' | 'refundable' | 'net_collected';

const STAGE_PROB: Record<MoneyStage, number> = {
  quote: 0.15,
  purchase_order: 0.4,
  invoice: 0.6,
  pending_payment: 0.75,
  confirmed_payment: 0.95,
  refundable: 0.9,
  net_collected: 1,
};

/** Convert pipeline stages into an expected realisable amount. */
export function collectionReliability(amounts: Array<{ stage: MoneyStage; amountUsd: number }>): { expectedUsd: number; note: string } {
  const expected = amounts.reduce((a, b) => a + b.amountUsd * STAGE_PROB[b.stage], 0);
  return { expectedUsd: round2(expected), note: 'only net_collected is treated as income' };
}

// ---------------------------------------------------------------------------
// 89. Trust Deficit Repair Engine
// ---------------------------------------------------------------------------

export function trustRepair(deficit: 'credibility' | 'capability' | 'delivery_risk' | 'privacy'): string[] {
  const map = {
    credibility: ['publish transparent pricing', 'show a working sample', 'state limits honestly'],
    capability: ['demonstrate the exact task on the buyer’s sample'],
    delivery_risk: ['offer a paid pilot with acceptance criteria and a refund clause'],
    privacy: ['document exactly what data is stored and for how long', 'offer deletion on request'],
  } as const;
  return [...map[deficit]];
}

// ---------------------------------------------------------------------------
// 90. Business Model Mutation Lab
// ---------------------------------------------------------------------------

export interface ModelVariant { model: 'subscription' | 'usage' | 'service_fee' | 'license' | 'commission' | 'package' | 'retainer'; monthlyRevenueUsd: number; monthlyCostUsd: number; retentionMonths: number }

export function modelLab(variants: ModelVariant[]): Array<ModelVariant & { ltvUsd: number; monthlyProfitUsd: number }> {
  return variants
    .map((v) => ({ ...v, monthlyProfitUsd: round2(v.monthlyRevenueUsd - v.monthlyCostUsd), ltvUsd: round2((v.monthlyRevenueUsd - v.monthlyCostUsd) * v.retentionMonths) }))
    .sort((a, b) => b.ltvUsd - a.ltvUsd);
}

// ---------------------------------------------------------------------------
// 91. Autonomous Experiment Budget Governor
// ---------------------------------------------------------------------------

export class ExperimentBudgetGovernor {
  private spent = 0;
  private readonly capUsd: number;
  constructor(capUsd: number) {
    this.capUsd = capUsd;
  }
  canSpend(amountUsd: number): boolean { return this.spent + amountUsd <= this.capUsd; }
  commit(amountUsd: number): void {
    if (!this.canSpend(amountUsd)) throw new Error(`Experiment budget exceeded: $${this.spent + amountUsd} > $${this.capUsd}`);
    this.spent += amountUsd;
  }
  remaining(): number { return round2(this.capUsd - this.spent); }
  /** Reinvestment of profit is a sensitive action and is never automatic. */
  reinvest(): never { throw new Error('Reinvesting revenue requires explicit owner approval'); }
}

// ---------------------------------------------------------------------------
// 92. Multi-Channel Attribution Integrity Engine
// ---------------------------------------------------------------------------

/** Assign each conversion to exactly one channel under a stated model. */
export function attributeDeals(deals: Array<{ id: string; touches: Array<{ channel: string; at: string }> }>, model: 'first' | 'last'): { attributed: Array<{ id: string; channel: string }>; duplicates: string[] } {
  const attributed: Array<{ id: string; channel: string }> = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const d of deals) {
    if (seen.has(d.id)) { duplicates.push(d.id); continue; }
    seen.add(d.id);
    const sorted = [...d.touches].sort((a, b) => a.at.localeCompare(b.at));
    const touch = model === 'first' ? sorted[0] : sorted[sorted.length - 1];
    if (touch) attributed.push({ id: d.id, channel: touch.channel });
  }
  return { attributed, duplicates };
}

// ---------------------------------------------------------------------------
// 93. Service Failure Compensation Planner
// ---------------------------------------------------------------------------

export function compensationPlan(input: { failureCostUsd: number; cause: string; options: Array<{ kind: 'redo' | 'partial_refund' | 'full_refund' | 'credit'; costUsd: number }> }): { recommended: string; options: Array<{ kind: string; costUsd: number; effect: string }>; requiresApproval: true } {
  const options = input.options
    .map((o) => ({ kind: o.kind, costUsd: round2(o.costUsd), effect: o.costUsd <= input.failureCostUsd ? 'within the cost of the failure' : 'exceeds the cost of the failure' }))
    .sort((a, b) => a.costUsd - b.costUsd);
  return { recommended: options[0]?.kind ?? 'redo', options, requiresApproval: true };
}

// ---------------------------------------------------------------------------
// 94. Hidden Workload Cost Detector
// ---------------------------------------------------------------------------

export function hiddenWorkload(input: { supportHours: number; revisionHours: number; meetingHours: number; reviewHours: number; reworkHours: number; hourlyRateUsd: number }): { hiddenHours: number; hiddenCostUsd: number; addToOfferUsd: number } {
  const hours = input.supportHours + input.revisionHours + input.meetingHours + input.reviewHours + input.reworkHours;
  const cost = hours * input.hourlyRateUsd;
  return { hiddenHours: round2(hours), hiddenCostUsd: round2(cost), addToOfferUsd: round2(cost * 1.15) };
}

// ---------------------------------------------------------------------------
// 95. Market Evidence Freshness Engine
// ---------------------------------------------------------------------------

/** Per-evidence-type max age in days before re-verification is required. */
export const FRESHNESS_DAYS: Record<string, number> = {
  price: 30,
  policy: 90,
  program_feature: 60,
  demand: 45,
  competitor: 30,
  contact: 180,
};

export function freshnessReport(evidence: Evidence[], now = new Date()): { fresh: string[]; stale: string[] } {
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const e of evidence) (isStale(e, now) ? stale : fresh).push(e.id);
  return { fresh, stale };
}

// ---------------------------------------------------------------------------
// 96. Productized Service Assembly Line
// ---------------------------------------------------------------------------

export interface ServiceTemplate { name: string; steps: string[]; inputs: string[]; templates: string[]; qualityChecks: string[]; deliveryDays: number; priceUsd: number; acceptance: string[] }

/** Turn a one-off success into a repeatable, quality-checked process. */
export function productize(input: { name: string; steps: string[]; inputs: string[]; qualityChecks: string[]; deliveryDays: number; priceUsd: number }): ServiceTemplate {
  return {
    name: input.name,
    steps: input.steps,
    inputs: input.inputs,
    templates: input.steps.map((s) => `template: ${s}`),
    qualityChecks: input.qualityChecks,
    deliveryDays: input.deliveryDays,
    priceUsd: round2(input.priceUsd),
    acceptance: input.qualityChecks.map((q) => `passes: ${q}`),
  };
}

// ---------------------------------------------------------------------------
// 97. Revenue-to-Capability Feedback Loop
// ---------------------------------------------------------------------------

/** Record what a sale taught, and which asset to improve next. */
export function capabilityFeedback(sales: Array<{ id: string; outcome: 'won' | 'lost'; reason: string; usedAssets: string[] }>): { improve: string[]; lessons: string[] } {
  const wonAssets = new Map<string, number>();
  const lessons: string[] = [];
  for (const s of sales) {
    if (s.outcome === 'won') for (const a of s.usedAssets) wonAssets.set(a, (wonAssets.get(a) ?? 0) + 1);
    else lessons.push(`lost ${s.id}: ${s.reason}`);
  }
  const improve = [...wonAssets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
  return { improve, lessons };
}

// ---------------------------------------------------------------------------
// 98. Commercial Opportunity Collision Avoidance
// ---------------------------------------------------------------------------

export interface Commitment { opportunityId: string; buyerId: string; startDay: number; endDay: number; exclusive: boolean }

/** Detect conflicts: same buyer double-committed, or overlapping exclusivity. */
export function collisions(commitments: Commitment[]): Array<{ a: string; b: string; reason: string }> {
  const out: Array<{ a: string; b: string; reason: string }> = [];
  for (let i = 0; i < commitments.length; i++) {
    for (let j = i + 1; j < commitments.length; j++) {
      const a = commitments[i]!;
      const b = commitments[j]!;
      const overlap = a.startDay <= b.endDay && b.startDay <= a.endDay;
      if (a.buyerId === b.buyerId && overlap) out.push({ a: a.opportunityId, b: b.opportunityId, reason: 'same buyer with overlapping commitments' });
      else if (overlap && a.exclusive && b.exclusive) out.push({ a: a.opportunityId, b: b.opportunityId, reason: 'overlapping exclusive commitments' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 99. First-Dollar Execution Navigator
// ---------------------------------------------------------------------------

export interface FirstDollarStep { order: number; step: string; evidenceRequired: string; done: boolean }

/** The concrete, evidence-gated route to the first paid customer. */
export function firstDollarNavigator(state: { problemChosen: boolean; demandEvidence: number; offerReady: boolean; proofReady: boolean; buyersIdentified: number; outreachApproved: boolean; closed: boolean; delivered: boolean; paid: boolean }): { steps: FirstDollarStep[]; nextStep: string } {
  const steps: FirstDollarStep[] = [
    { order: 1, step: 'choose a sellable problem', evidenceRequired: 'a stated problem', done: state.problemChosen },
    { order: 2, step: 'collect demand evidence', evidenceRequired: '>=2 evidence records', done: state.demandEvidence >= 2 },
    { order: 3, step: 'prepare a small offer', evidenceRequired: 'an offer with a price', done: state.offerReady },
    { order: 4, step: 'build a testable proof', evidenceRequired: 'a runnable sample', done: state.proofReady },
    { order: 5, step: 'identify suitable buyers', evidenceRequired: '>=1 sourced buyer', done: state.buyersIdentified >= 1 },
    { order: 6, step: 'lawful, personalised outreach', evidenceRequired: 'owner approval', done: state.outreachApproved },
    { order: 7, step: 'close the deal', evidenceRequired: 'buyer consent', done: state.closed },
    { order: 8, step: 'deliver', evidenceRequired: 'delivery plan met', done: state.delivered },
    { order: 9, step: 'verify payment and outcome', evidenceRequired: 'verified payment reference', done: state.paid },
  ];
  const next = steps.find((s) => !s.done);
  return { steps, nextStep: next ? next.step : 'first dollar reached — measure profit and repeat' };
}

// ---------------------------------------------------------------------------
// 100. Autonomous Commercial Governance Engine
// ---------------------------------------------------------------------------

export interface GovernanceState {
  mode: string;
  budgetRemainingUsd: number;
  proposedCostUsd: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  hasApproval: boolean;
  evidenceCount: number;
  dataSafe: boolean;
  marginPct: number;
}

export interface GovernanceDecision { allow: boolean; reason: string }

/**
 * The final gate. Combines autonomy limits, budget, risk, permissions, evidence
 * quality and margin into one allow/deny decision. Anything over the owner's
 * delegation, or lacking required evidence, is refused.
 */
export function govern(s: GovernanceState): GovernanceDecision {
  if (!s.dataSafe) return { allow: false, reason: 'data safety check failed' };
  if (s.proposedCostUsd > s.budgetRemainingUsd) return { allow: false, reason: 'would exceed the remaining budget' };
  if (s.mode === 'OBSERVE' || s.mode === 'PLAN') return { allow: false, reason: `mode ${s.mode} does not permit external action` };
  if (s.riskLevel === 'critical' || s.riskLevel === 'high') {
    return s.hasApproval ? { allow: true, reason: 'owner approval present' } : { allow: false, reason: 'high-risk action requires owner approval' };
  }
  if (s.evidenceCount < 1) return { allow: false, reason: 'no supporting evidence' };
  if (s.marginPct < 0) return { allow: false, reason: 'negative margin' };
  return { allow: true, reason: 'within delegation and evidence thresholds' };
}

export { CircuitBreaker };
