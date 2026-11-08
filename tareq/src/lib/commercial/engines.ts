import { clamp, round2, scoreGenome, type Evidence, type OpportunityGenome, isStale, measured, estimated, assumed, type Valued } from './types.ts';

/**
 * Commercial intelligence engines — directive groups 29 to 63.
 *
 * Each export is one capability, implemented as a pure function so it can be
 * unit-tested without a database or a model. The group number is in the name
 * and in `CAPABILITY_INDEX` so the acceptance table maps 1:1 to code.
 */

// ---------------------------------------------------------------------------
// 29. Opportunity Genome — Commercial Knowledge Graph
// ---------------------------------------------------------------------------

export interface GenomeGraph {
  nodes: Array<{ id: string; kind: 'problem' | 'buyer' | 'solution' | 'outcome'; label: string }>;
  edges: Array<{ from: string; to: string; relation: string }>;
}

/** Build a small knowledge graph from a genome so relationships are queryable. */
export function buildGenomeGraph(g: OpportunityGenome, id = 'opp'): GenomeGraph {
  const nodes: GenomeGraph['nodes'] = [
    { id: `${id}:problem`, kind: 'problem', label: g.problem },
    { id: `${id}:buyer`, kind: 'buyer', label: g.affectedBuyer },
    ...g.currentSolutions.map((s, i) => ({ id: `${id}:sol${i}`, kind: 'solution' as const, label: s })),
    { id: `${id}:outcome`, kind: 'outcome', label: `value up to $${g.willingnessToPayUsd}` },
  ];
  const edges: GenomeGraph['edges'] = [
    { from: `${id}:problem`, to: `${id}:buyer`, relation: 'affects' },
    ...g.currentSolutions.map((_, i) => ({ from: `${id}:sol${i}`, to: `${id}:problem`, relation: 'addresses' })),
    { from: `${id}:outcome`, to: `${id}:buyer`, relation: 'benefits' },
  ];
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// 30. Buyer Intent Interceptor
// ---------------------------------------------------------------------------

export interface IntentSignal {
  kind: 'pricing_page_repeat' | 'trial_request' | 'quote_request' | 'integration_question' | 'case_study_read';
  weight: number;
  observedAt: string;
}

const INTENT_WEIGHTS: Record<IntentSignal['kind'], number> = {
  quote_request: 0.9,
  trial_request: 0.75,
  pricing_page_repeat: 0.5,
  integration_question: 0.6,
  case_study_read: 0.35,
};

/** Score buying intent from observed signals. Deliberately never equals 1. */
export function scoreIntent(signals: IntentSignal[]): { score: number; label: 'cold' | 'warming' | 'warm' | 'hot' } {
  if (signals.length === 0) return { score: 0, label: 'cold' };
  let p = 0;
  for (const s of signals) p = p + (1 - p) * clamp(s.weight * INTENT_WEIGHTS[s.kind], 0, 0.95);
  const score = round2(clamp(p, 0, 0.95));
  const label = score >= 0.7 ? 'hot' : score >= 0.45 ? 'warm' : score >= 0.2 ? 'warming' : 'cold';
  return { score, label };
}

// ---------------------------------------------------------------------------
// 31. Demand Proof Ladder
// ---------------------------------------------------------------------------

export type ProofRung = 'stated_interest' | 'problem_confirmed' | 'budget_acknowledged' | 'price_agreed' | 'paid';

const RUNG_RANK: Record<ProofRung, number> = {
  stated_interest: 1,
  problem_confirmed: 2,
  budget_acknowledged: 3,
  price_agreed: 4,
  paid: 5,
};

export interface ProofState {
  rung: ProofRung;
  /** Real observations only; the ladder never advances on speculation. */
  observations: string[];
}

/**
 * Advance the proof ladder. A rung may only be claimed with at least one
 * concrete observation, and 'paid' requires a payment reference.
 */
export function advanceProof(state: ProofState, to: ProofRung, observation: string, paymentRef?: string): ProofState {
  if (RUNG_RANK[to] > RUNG_RANK[state.rung] + 1) {
    throw new Error(`Cannot skip rungs: from ${state.rung} to ${to}`);
  }
  if (!observation.trim()) throw new Error('A rung requires a concrete observation');
  if (to === 'paid' && !paymentRef) throw new Error("The 'paid' rung requires a payment reference");
  return { rung: to, observations: [...state.observations, observation] };
}

export function demandProofPassed(state: ProofState): boolean {
  return RUNG_RANK[state.rung] >= RUNG_RANK['budget_acknowledged'];
}

// ---------------------------------------------------------------------------
// 32. Revenue Path Compiler
// ---------------------------------------------------------------------------

export interface RevenuePath {
  steps: Array<{ action: string; costUsd: number; days: number; risk: number }>;
  totalCostUsd: number;
  totalDays: number;
  expectedRevenueUsd: number;
  expectedProfitUsd: number;
}

/** Compile the cheapest-and-fastest ordered path to revenue from candidate steps. */
export function compileRevenuePath(
  candidates: Array<{ action: string; costUsd: number; days: number; risk: number; expectedRevenueUsd: number }>,
  budgetUsd: number,
): RevenuePath {
  const ordered = [...candidates].sort((a, b) => a.days + a.costUsd / 100 - (b.days + b.costUsd / 100));
  const chosen: RevenuePath['steps'] = [];
  let cost = 0;
  let days = 0;
  let expectedRevenueUsd = 0;
  for (const c of ordered) {
    if (cost + c.costUsd > budgetUsd) continue;
    chosen.push({ action: c.action, costUsd: c.costUsd, days: c.days, risk: c.risk });
    cost += c.costUsd;
    days += c.days;
    expectedRevenueUsd += c.expectedRevenueUsd;
  }
  return {
    steps: chosen,
    totalCostUsd: round2(cost),
    totalDays: days,
    expectedRevenueUsd: round2(expectedRevenueUsd),
    expectedProfitUsd: round2(expectedRevenueUsd - cost),
  };
}

// ---------------------------------------------------------------------------
// 33. Market White-Space Mapper
// ---------------------------------------------------------------------------

export interface MarketCell {
  segment: string;
  needIntensity: number; // 0..10
  solutionCoverage: number; // 0..10
}

/** Cells with high need and low coverage are white space worth attacking. */
export function mapWhiteSpace(cells: MarketCell[]): Array<MarketCell & { whitespaceScore: number }> {
  return cells
    .map((c) => ({ ...c, whitespaceScore: round2(clamp((c.needIntensity - c.solutionCoverage) / 10, -1, 1)) }))
    .sort((a, b) => b.whitespaceScore - a.whitespaceScore);
}

// ---------------------------------------------------------------------------
// 34. Buyer-Now Radar
// ---------------------------------------------------------------------------

export interface RadarInput {
  buyerId: string;
  intentScore: number; // 0..1 from engine 30
  urgencyDays: number; // days until their problem bites
  reachableNow: boolean;
}

/** Rank buyers by readiness to buy today, discounting those we cannot reach. */
export function rankBuyersNow(inputs: RadarInput[]): Array<RadarInput & { readiness: number }> {
  return inputs
    .map((b) => ({
      ...b,
      readiness: round2(clamp(b.intentScore * 0.6 + (1 - clamp(b.urgencyDays / 90, 0, 1)) * 0.4, 0, 1) * (b.reachableNow ? 1 : 0.3)),
    }))
    .sort((a, b) => b.readiness - a.readiness);
}

// ---------------------------------------------------------------------------
// 35. Decision-Maker Lock
// ---------------------------------------------------------------------------

export interface Contact {
  name: string;
  role: string;
  isDecisionMaker: boolean;
  sourceUrl?: string;
}

/** Prefer the decision maker; require a source before treating a contact as real. */
export function lockDecisionMaker(contacts: Contact[]): Contact | null {
  const sourced = contacts.filter((c) => c.isDecisionMaker && c.sourceUrl);
  return sourced[0] ?? null;
}

// ---------------------------------------------------------------------------
// 36. Instant Value Leak Scanner
// ---------------------------------------------------------------------------

export interface LeakInput {
  currentCostUsd: number;
  wastedHoursPerMonth: number;
  hourlyRateUsd: number;
  errorRatePct: number;
  errorCostUsd: number;
}

/** Quantify money leaking today — the number a buyer feels immediately. */
export function scanValueLeak(i: LeakInput): { monthlyLeakUsd: number; annualLeakUsd: number; breakdown: Record<string, number> } {
  const wasted = i.wastedHoursPerMonth * i.hourlyRateUsd;
  const errors = (i.errorRatePct / 100) * i.errorCostUsd;
  const monthly = i.currentCostUsd + wasted + errors;
  return {
    monthlyLeakUsd: round2(monthly),
    annualLeakUsd: round2(monthly * 12),
    breakdown: { base: round2(i.currentCostUsd), wastedTime: round2(wasted), errors: round2(errors) },
  };
}

// ---------------------------------------------------------------------------
// 37. 90-Second Proof Engine
// ---------------------------------------------------------------------------

/** A short, evidence-bound proof a buyer can evaluate in ~90 seconds. */
export function ninetySecondProof(problem: string, leakUsd: number, proofSteps: string[]): { script: string; durationSec: number } {
  const script = [
    `1) Your problem: ${problem}`,
    `2) What it costs you today: ~$${round2(leakUsd)} / month (estimated)`,
    `3) How we remove it: ${proofSteps.join(' → ')}`,
    `4) How you verify it: run the sample and check the result yourself`,
  ].join('\n');
  return { script, durationSec: 90 };
}

// ---------------------------------------------------------------------------
// 38. Response-Time Sniper
// ---------------------------------------------------------------------------

/** Reward fast, relevant first responses; a late reply is worth far less. */
export function responsePriority(signal: IntentSignal, minutesSince: number): number {
  const decay = Math.exp(-minutesSince / 60);
  return round2(clamp(INTENT_WEIGHTS[signal.kind] * decay, 0, 1));
}

// ---------------------------------------------------------------------------
// 39. Deal Revival Engine
// ---------------------------------------------------------------------------

export interface DormantDeal {
  id: string;
  daysSinceContact: number;
  originalIntent: number;
  reason?: 'no_budget' | 'timing' | 'no_reply' | 'chose_competitor';
}

/** Revive deals whose blocker has plausibly expired. */
export function revivalCandidates(deals: DormantDeal[]): Array<DormantDeal & { revivalScore: number }> {
  const revivability: Record<string, number> = { timing: 0.8, no_reply: 0.5, no_budget: 0.3, chose_competitor: 0.2 };
  return deals
    .filter((d) => d.daysSinceContact >= 21)
    .map((d) => ({ ...d, revivalScore: round2(clamp(d.originalIntent * (revivability[d.reason ?? 'no_reply'] ?? 0.4), 0, 1)) }))
    .sort((a, b) => b.revivalScore - a.revivalScore);
}

// ---------------------------------------------------------------------------
// 40. One-Click Cash Path
// ---------------------------------------------------------------------------

export interface CashPath {
  offerName: string;
  priceUsd: number;
  deliveryDays: number;
  requiresOwnerApproval: boolean;
}

/** The shortest legitimate path from a ready buyer to paid. */
export function oneClickCashPath(offerName: string, priceUsd: number, deliveryDays: number): CashPath {
  return { offerName, priceUsd: round2(priceUsd), deliveryDays, requiresOwnerApproval: true };
}

// ---------------------------------------------------------------------------
// 41. Micro-Offer Forge
// ---------------------------------------------------------------------------

/** Small, low-risk paid offers that produce a real transaction quickly. */
export function forgeMicroOffer(outcome: string, estHours: number, hourlyRateUsd: number, marginPct = 40): { name: string; priceUsd: number; scope: string } {
  const cost = estHours * hourlyRateUsd;
  const price = cost / (1 - clamp(marginPct, 0, 90) / 100);
  return { name: `Quick Win: ${outcome}`, priceUsd: round2(price), scope: `Deliver ${outcome} within a fixed small scope; measured by an agreed metric.` };
}

// ---------------------------------------------------------------------------
// 42. Trust-Transfer Engine
// ---------------------------------------------------------------------------

/** Real trust assets only; nothing fabricated. */
export function trustAssets(kind: 'sample' | 'transparent_pricing' | 'refund_policy' | 'pilot'): string[] {
  const map = {
    sample: ['A working sample the buyer can run themselves'],
    transparent_pricing: ['A published price list with no hidden fees'],
    refund_policy: ['A written refund policy with explicit conditions'],
    pilot: ['A time-boxed, paid pilot with acceptance criteria'],
  } as const;
  return [...map[kind]];
}

/**
 * Source reliability, declared explicitly so trust is auditable rather than
 * implied. Keys are matched case-insensitively against `TrustSource.source`.
 * A source we have never seen is treated as low trust (0.4), never as high.
 */
export const SOURCE_RELIABILITY: Record<string, number> = {
  owner: 0.95,
  supabase: 0.95,
  official_registry: 0.95,
  stripe_webhook: 0.95,
  public_dataset: 0.8,
  wikipedia: 0.8,
  hackernews: 0.55,
  public_discussion: 0.55,
  model_estimate: 0.3,
  assumption: 0.3,
};

export interface TrustSource {
  id: string;
  statement: string;
  source: string;
  sourceUrl?: string | null;
  /** Self-declared confidence, 0..1. */
  confidence: number;
  /** True only when the claim carries a verification timestamp. */
  verified: boolean;
  validUntil?: Date | string | null;
  supporting?: string[];
  contradicting?: string[];
}

export interface TrustAssessment {
  /** Composite trust score, 0..1. */
  score: number;
  /** Confidence propagated from the sources, 0..1. */
  confidence: number;
  /** 1 - confidence, widened by each contradiction. */
  uncertainty: number;
  /** Reliability-weighted mean of the sources, 0..1. */
  sourceReliability: number;
  /** Claim ids past their validity date. */
  staleIds: string[];
  /** Claim ids that are contradicted (by themselves or another claim). */
  contradictionIds: string[];
  /** Which claim each contradiction came from, for auditability. */
  contradictions: Array<{ id: string; contradictedBy: string[] }>;
  /** Evidence provenance: each claim with the chain of claims supporting it. */
  provenance: Array<{ id: string; source: string; sourceUrl: string | null; chain: string[] }>;
  /** Claims safe to show a customer. */
  publishableIds: string[];
  /** Human-readable reasons a claim was withheld. */
  blockers: string[];
}

export function sourceReliability(source: string): number {
  return SOURCE_RELIABILITY[source.toLowerCase()] ?? 0.4;
}

function isExpired(s: TrustSource, now: number): boolean {
  if (!s.validUntil) return false;
  return new Date(s.validUntil).getTime() < now;
}

/**
 * Trust-Transfer Engine (capability 42).
 *
 * Turns a pile of evidence into one auditable trust decision. It is a pure
 * function: no database, no model, no randomness. It answers six questions and
 * records the reason for each answer:
 *   - provenance: where did each claim come from, and what supports it?
 *   - confidence propagation: how much of the source confidence survives?
 *   - source reliability: how much do we trust each source class?
 *   - stale evidence: which claims have expired?
 *   - contradictory evidence: which claims disagree?
 *   - uncertainty propagation: how much doubt must be carried forward?
 *
 * Only verified, unexpired, uncontradicted claims above 0.6 confidence are
 * publishable. Everything withheld is named in `blockers`.
 */
export function assessTrust(sources: TrustSource[], now: number = Date.now()): TrustAssessment {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const staleIds: string[] = [];
  const contradictionIds: string[] = [];
  const contradictions: Array<{ id: string; contradictedBy: string[] }> = [];
  const provenance: TrustAssessment['provenance'] = [];
  const publishableIds: string[] = [];
  const blockers: string[] = [];

  // Provenance: walk the supporting chain for each claim, guarding against cycles.
  const chainOf = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const s = byId.get(id);
    if (!s) return [];
    return (s.supporting ?? []).flatMap((sid) => [sid, ...chainOf(sid, seen)]);
  };

  // Contradictions: explicit self-declaration, plus mutual contradiction.
  const explicitContradicted = new Set<string>();
  for (const s of sources) {
    if ((s.contradicting ?? []).length > 0) explicitContradicted.add(s.id);
  }
  for (const s of sources) {
    const from = sources
      .filter((o) => o.id !== s.id && ((o.contradicting ?? []).includes(s.id) || (s.contradicting ?? []).includes(o.id)))
      .map((o) => o.id);
    if (from.length > 0) {
      contradictionIds.push(s.id);
      contradictions.push({ id: s.id, contradictedBy: from });
    }
  }

  let reliabilitySum = 0;
  let confidenceSum = 0;
  let counted = 0;

  for (const s of sources) {
    const rel = sourceReliability(s.source);
    provenance.push({ id: s.id, source: s.source, sourceUrl: s.sourceUrl ?? null, chain: chainOf(s.id) });

    const stale = isExpired(s, now);
    if (stale) staleIds.push(s.id);

    const contradicted = explicitContradicted.has(s.id) || contradictionIds.includes(s.id);

    // Only verified, unexpired claims contribute to the trust numbers.
    if (s.verified && !stale) {
      reliabilitySum += rel;
      confidenceSum += rel * clamp(s.confidence, 0, 1);
      counted += 1;
    }

    const reasons: string[] = [];
    if (!s.verified) reasons.push('not verified');
    if (stale) reasons.push('stale');
    if (contradicted) reasons.push('contradicted');
    if (clamp(s.confidence, 0, 1) < 0.6) reasons.push('confidence below 0.6');

    if (reasons.length === 0) publishableIds.push(s.id);
    else blockers.push(`${s.id}: ${reasons.join(', ')}`);
  }

  const sourceReliabilityMean = counted > 0 ? reliabilitySum / counted : 0;
  // Weighted mean: total reliability-weighted confidence over total reliability.
  let confidence = reliabilitySum > 0 ? confidenceSum / reliabilitySum : 0;
  // Each contradiction widens uncertainty: a disagreement cannot be hidden.
  const uniqueContradictions = new Set(contradictionIds).size;
  for (let i = 0; i < uniqueContradictions; i += 1) confidence *= 0.6;
  confidence = clamp(confidence, 0, 1);
  const uncertainty = clamp(1 - confidence + 0.05 * uniqueContradictions, 0, 1);

  return {
    score: round2(confidence),
    confidence: round2(confidence),
    uncertainty: round2(uncertainty),
    sourceReliability: round2(sourceReliabilityMean),
    staleIds,
    contradictionIds: [...new Set(contradictionIds)],
    contradictions,
    provenance,
    publishableIds,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// 43. Lead Memory Shield
// ---------------------------------------------------------------------------

export interface LeadRecord {
  leadId: string;
  owner: string; // which opportunity/agent owns this lead
  optedOut: boolean;
}

/** Prevent two opportunities from working the same lead, and honour opt-out. */
export function shieldLeads(records: LeadRecord[]): { conflicts: string[]; blocked: string[] } {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  const blocked: string[] = [];
  for (const r of records) {
    if (r.optedOut) {
      blocked.push(r.leadId);
      continue;
    }
    const prev = seen.get(r.leadId);
    if (prev && prev !== r.owner) conflicts.push(r.leadId);
    else seen.set(r.leadId, r.owner);
  }
  return { conflicts, blocked };
}

// ---------------------------------------------------------------------------
// 44. Market Pulse Anomaly Detector
// ---------------------------------------------------------------------------

/** Flag a point that deviates from the rolling baseline beyond `z`. */
export function detectAnomalies(series: number[], z = 2): Array<{ index: number; value: number; z: number }> {
  if (series.length < 4) return [];
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length) || 1;
  const out: Array<{ index: number; value: number; z: number }> = [];
  series.forEach((v, i) => {
    const zz = (v - mean) / sd;
    if (Math.abs(zz) >= z) out.push({ index: i, value: v, z: round2(zz) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 45. Pain Cluster Fusion
// ---------------------------------------------------------------------------

/** Group similar pains so one solution can serve many buyers. */
export function fusePainClusters(items: Array<{ id: string; pain: string }>, similarity = 0.5): Array<{ label: string; members: string[] }> {
  const clusters: Array<{ label: string; members: string[] }> = [];
  for (const it of items) {
    const target = clusters.find((c) => jaccard(c.label, it.pain) >= similarity);
    if (target) target.members.push(it.id);
    else clusters.push({ label: it.pain, members: [it.id] });
  }
  return clusters;
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;
  return inter / union;
}

// ---------------------------------------------------------------------------
// 46. Competitor Move Predictor
// ---------------------------------------------------------------------------

/** Enumerate plausible responses without claiming to know intent. */
export function predictCompetitorMoves(input: { ourPriceUsd: number; competitorPriceUsd: number; ourDifferentiation: number }): Array<{ move: string; likelihood: number; ourCounter: string }> {
  const cheaper = input.competitorPriceUsd < input.ourPriceUsd;
  const weakDiff = input.ourDifferentiation < 0.4;
  return [
    { move: 'price cut', likelihood: cheaper ? 0.5 : 0.25, ourCounter: 'compete on measured outcome, not price' },
    { move: 'copy feature', likelihood: weakDiff ? 0.6 : 0.3, ourCounter: 'lean on data and integration moat' },
    { move: 'improve service', likelihood: 0.4, ourCounter: 'publish response-time and acceptance guarantees' },
  ];
}

// ---------------------------------------------------------------------------
// 47. Opportunity Expiry Clock
// ---------------------------------------------------------------------------

export function expiryClock(evidence: Evidence[], now: Date = new Date()): { expired: string[]; expiringSoon: string[] } {
  const expired: string[] = [];
  const soon: string[] = [];
  for (const e of evidence) {
    const ageDays = (now.getTime() - new Date(e.collectedAt).getTime()) / 86_400_000;
    if (ageDays > e.validForDays) expired.push(e.id);
    else if (ageDays > e.validForDays * 0.8) soon.push(e.id);
  }
  return { expired, expiringSoon: soon };
}

// ---------------------------------------------------------------------------
// 48. Demand Migration Tracker
// ---------------------------------------------------------------------------

export function demandMigration(history: Array<{ period: string; demand: number }>): { trend: 'rising' | 'flat' | 'falling'; changePct: number } {
  if (history.length < 2) return { trend: 'flat', changePct: 0 };
  const first = history[0]!.demand;
  const last = history[history.length - 1]!.demand;
  const changePct = first === 0 ? 0 : round2(((last - first) / first) * 100);
  return { trend: changePct > 5 ? 'rising' : changePct < -5 ? 'falling' : 'flat', changePct };
}

// ---------------------------------------------------------------------------
// 49. Buying Friction Autopsy
// ---------------------------------------------------------------------------

export interface Friction { kind: 'integration' | 'training' | 'data' | 'risk' | 'price' | 'approval'; severity: number }

/** Identify the single biggest blocker and the smallest fix for it. */
export function autopsyFriction(frictions: Friction[]): { top: Friction | null; fixes: string[] } {
  if (frictions.length === 0) return { top: null, fixes: [] };
  const top = [...frictions].sort((a, b) => b.severity - a.severity)[0]!;
  const fixesMap: Record<Friction['kind'], string> = {
    integration: 'provide a ready-made connector and a sandbox key',
    training: 'include a 30-minute onboarding and a one-page guide',
    data: 'offer a guided import with a rollback point',
    risk: 'offer a paid pilot with acceptance criteria and a refund clause',
    price: 'offer a smaller scoped start and a measured ROI proof',
    approval: 'produce a one-page business case the buyer can forward',
  };
  return { top, fixes: [fixesMap[top.kind]] };
}

// ---------------------------------------------------------------------------
// 50. Offer Fit Fingerprint
// ---------------------------------------------------------------------------

export function offerFit(genome: OpportunityGenome, offer: { priceUsd: number; marginPct: number; deliveryDays: number }): { fit: number; notes: string[] } {
  const notes: string[] = [];
  const priceFit = clamp(offer.priceUsd / Math.max(1, genome.willingnessToPayUsd), 0, 1.5);
  if (priceFit > 1.1) notes.push('priced above stated willingness to pay');
  if (offer.marginPct < 30) notes.push('margin below 30% — review costs');
  if (offer.deliveryDays > genome.buyingCycleDays) notes.push('delivery longer than buying cycle');
  const fit = round2(clamp(1 - Math.abs(1 - priceFit) * 0.5 + clamp(offer.marginPct / 100, 0, 1) * 0.3, 0, 1));
  return { fit, notes };
}

// ---------------------------------------------------------------------------
// 51. Objection Preemption Lab
// ---------------------------------------------------------------------------

export function preemptObjections(objections: string[]): Array<{ objection: string; category: 'price' | 'trust' | 'timing' | 'capability' | 'integration' | 'other'; response: string }> {
  return objections.map((o) => {
    const l = o.toLowerCase();
    const category = l.includes('price') || l.includes('cost') || l.includes('expensive') || l.includes('سعر')
      ? 'price'
      : l.includes('trust') || l.includes('risk') || l.includes('ثقة')
        ? 'trust'
        : l.includes('later') || l.includes('timing') || l.includes('وقت')
          ? 'timing'
          : l.includes('can') || l.includes('capab')
            ? 'capability'
            : l.includes('integrat')
              ? 'integration'
              : 'other';
    const responses: Record<typeof category, string> = {
      price: 'Show measured value vs. price and offer a smaller scoped start.',
      trust: 'Offer a paid pilot with acceptance criteria and a clear refund policy.',
      timing: 'Agree a concrete trigger date and a reminder; keep the proof warm.',
      capability: 'Demonstrate the exact task on the buyer’s own sample.',
      integration: 'Provide a connector and a sandbox so they verify it themselves.',
      other: 'Ask one clarifying question before responding.',
    };
    return { objection: o, category, response: responses[category] };
  });
}

// ---------------------------------------------------------------------------
// 52. Frictionless Purchase Architect
// ---------------------------------------------------------------------------

export function frictionlessCheckout(cfg: { priceUsd: number; needsInvoice: boolean; needsApproval: boolean }): { steps: string[]; friction: number } {
  const steps = ['clear price', 'what is delivered', 'when it is delivered', 'how to pay'];
  let friction = 0.2;
  if (cfg.needsInvoice) { steps.push('invoice details'); friction += 0.2; }
  if (cfg.needsApproval) { steps.push('one-page business case for the approver'); friction += 0.3; }
  return { steps, friction: round2(clamp(friction, 0, 1)) };
}

// ---------------------------------------------------------------------------
// 53. Conversation Momentum Engine
// ---------------------------------------------------------------------------

export function conversationMomentum(turns: Array<{ from: 'buyer' | 'us'; atMinutes: number }>): { momentum: number; recommendation: string } {
  if (turns.length === 0) return { momentum: 0, recommendation: 'start the conversation with a relevant observation' };
  const lastBuyer = [...turns].reverse().find((t) => t.from === 'buyer');
  const gaps = turns.slice(1).map((t, i) => t.atMinutes - turns[i]!.atMinutes);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const silence = lastBuyer ? turns[turns.length - 1]!.atMinutes - lastBuyer.atMinutes : Infinity;
  const momentum = round2(clamp(1 - silence / 1440, 0, 1) * clamp(1 - avgGap / 720, 0.1, 1));
  const recommendation = momentum > 0.6 ? 'reply now with the next concrete step' : momentum > 0.3 ? 'follow up with a short, relevant nudge' : 'send a value reminder, then pause';
  return { momentum, recommendation };
}

// ---------------------------------------------------------------------------
// 54. Task Critical Path Optimizer
// ---------------------------------------------------------------------------

export interface DepTask { id: string; days: number; deps: string[] }

/** Longest path through the dependency graph — the real schedule bottleneck. */
export function criticalPath(tasks: DepTask[]): { path: string[]; days: number } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, { days: number; path: string[] }>();
  const visit = (id: string): { days: number; path: string[] } => {
    const cached = memo.get(id);
    if (cached) return cached;
    const t = byId.get(id);
    if (!t) return { days: 0, path: [] };
    let best = { days: 0, path: [] as string[] };
    for (const d of t.deps) {
      const r = visit(d);
      if (r.days > best.days) best = r;
    }
    const res = { days: best.days + t.days, path: [...best.path, id] };
    memo.set(id, res);
    return res;
  };
  let best = { days: 0, path: [] as string[] };
  for (const t of tasks) {
    const r = visit(t.id);
    if (r.days > best.days) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 55. Intelligence Cost Arbitrage
// ---------------------------------------------------------------------------

/** Route a task to the cheapest model that can do it adequately. */
export function arbitrageModel(complexity: 'trivial' | 'simple' | 'moderate' | 'complex'): { provider: 'openai' | 'deepseek'; model: string; rationale: string } {
  switch (complexity) {
    case 'trivial':
    case 'simple':
      return { provider: 'deepseek', model: 'deepseek-chat', rationale: 'cheapest adequate model for low-complexity work' };
    case 'moderate':
      return { provider: 'openai', model: 'gpt-4o-mini', rationale: 'good quality/cost balance' };
    case 'complex':
      return { provider: 'openai', model: 'gpt-4o', rationale: 'stronger reasoning justified by task complexity' };
  }
}

// ---------------------------------------------------------------------------
// 56. Reusable Asset Miner
// ---------------------------------------------------------------------------

export interface AssetCandidate { id: string; kind: string; reuseCount: number; buildCostUsd: number; savedPerReuseUsd: number }

/** Rank assets by realised return and flag those worth retiring. */
export function mineAssets(assets: AssetCandidate[]): Array<AssetCandidate & { roi: number; verdict: 'invest' | 'keep' | 'retire' }> {
  return assets
    .map((a) => {
      const benefit = a.reuseCount * a.savedPerReuseUsd;
      const roi = a.buildCostUsd === 0 ? benefit : round2((benefit - a.buildCostUsd) / a.buildCostUsd);
      const verdict: 'invest' | 'keep' | 'retire' = roi > 1 ? 'invest' : roi >= 0 ? 'keep' : 'retire';
      return { ...a, roi, verdict };
    })
    .sort((a, b) => b.roi - a.roi);
}

// ---------------------------------------------------------------------------
// 57. Failure Containment Mesh
// ---------------------------------------------------------------------------

/** Circuit breaker: open after `threshold` consecutive failures, then half-open. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  constructor(threshold = 3, cooldownMs = 60_000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }
  canAttempt(now = Date.now()): boolean {
    if (this.openedAt === null) return true;
    return now - this.openedAt >= this.cooldownMs;
  }
  record(ok: boolean, now = Date.now()): void {
    if (ok) { this.failures = 0; this.openedAt = null; return; }
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = now;
  }
  state(now = Date.now()): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return this.canAttempt(now) ? 'half-open' : 'open';
  }
}

// ---------------------------------------------------------------------------
// 58. Preflight Business Simulator
// ---------------------------------------------------------------------------

export function simulate(input: { priceUsd: number; unitCostUsd: number; expectedVolume: number; fixedCostUsd: number; churnPct?: number }): { revenueUsd: number; profitUsd: number; breakEvenUnits: number; marginPct: number } {
  const revenue = input.priceUsd * input.expectedVolume;
  const variable = input.unitCostUsd * input.expectedVolume;
  const profit = revenue - variable - input.fixedCostUsd;
  const contribution = input.priceUsd - input.unitCostUsd;
  const breakEvenUnits = contribution > 0 ? Math.ceil(input.fixedCostUsd / contribution) : Infinity;
  return {
    revenueUsd: round2(revenue),
    profitUsd: round2(profit),
    breakEvenUnits,
    marginPct: revenue > 0 ? round2((profit / revenue) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// 59. Marginal Profit Compass
// ---------------------------------------------------------------------------

/** Profit of the next unit. Negative marginal profit means stop selling it. */
export function marginalProfit(priceUsd: number, variableCostUsd: number, hiddenCostUsd = 0): { marginalUsd: number; decision: 'sell' | 'reprice' | 'stop' } {
  const m = priceUsd - variableCostUsd - hiddenCostUsd;
  return { marginalUsd: round2(m), decision: m > 0 ? 'sell' : m === 0 ? 'reprice' : 'stop' };
}

// ---------------------------------------------------------------------------
// 60. Cashflow Survival Engine
// ---------------------------------------------------------------------------

export function cashflowSurvival(cashUsd: number, monthlyBurnUsd: number, monthlyInflowUsd: number, worstCaseInflowUsd = 0): { runwayMonthsBase: number; runwayMonthsWorst: number; alert: boolean } {
  const netBase = monthlyInflowUsd - monthlyBurnUsd;
  const netWorst = worstCaseInflowUsd - monthlyBurnUsd;
  const runwayBase = netBase >= 0 ? Infinity : cashUsd / -netBase;
  const runwayWorst = netWorst >= 0 ? Infinity : cashUsd / -netWorst;
  return {
    runwayMonthsBase: runwayBase === Infinity ? 999 : round2(runwayBase),
    runwayMonthsWorst: runwayWorst === Infinity ? 999 : round2(runwayWorst),
    alert: runwayWorst < 3,
  };
}

// ---------------------------------------------------------------------------
// 61. Customer Value Expansion Graph
// ---------------------------------------------------------------------------

export function expansionGraph(currentValueUsd: number, adjacentOffers: Array<{ name: string; priceUsd: number; fit: number }>): Array<{ name: string; potentialUsd: number; priority: number }> {
  return adjacentOffers
    .map((o) => ({ name: o.name, potentialUsd: round2(o.priceUsd), priority: round2(clamp(o.fit, 0, 1) * o.priceUsd / Math.max(1, currentValueUsd)) }))
    .sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------------------
// 62. Risk-Adjusted Opportunity Portfolio
// ---------------------------------------------------------------------------

export function riskPortfolio(opps: Array<{ id: string; expectedProfitUsd: number; probability: number; risk: number }>): { ranked: Array<{ id: string; riskAdjustedUsd: number }>; concentration: number } {
  const ranked = opps
    .map((o) => ({ id: o.id, riskAdjustedUsd: round2(o.expectedProfitUsd * clamp(o.probability, 0, 1) * (1 - clamp(o.risk, 0, 1))) }))
    .sort((a, b) => b.riskAdjustedUsd - a.riskAdjustedUsd);
  const total = ranked.reduce((a, b) => a + Math.max(0, b.riskAdjustedUsd), 0);
  const top = ranked[0]?.riskAdjustedUsd ?? 0;
  return { ranked, concentration: total > 0 ? round2(top / total) : 0 };
}

// ---------------------------------------------------------------------------
// 63. Revenue Causality Lab
// ---------------------------------------------------------------------------

/** Attribute an outcome to a cause only when a real comparison exists. */
export function causalityLab(input: { treated: number; control: number; treatedN: number; controlN: number }): { liftPct: number; confident: boolean; note: string } {
  if (input.controlN === 0) return { liftPct: 0, confident: false, note: 'no control group — cannot attribute causality' };
  const lift = input.control === 0 ? 0 : ((input.treated - input.control) / input.control) * 100;
  const confident = input.treatedN >= 30 && input.controlN >= 30;
  return { liftPct: round2(lift), confident, note: confident ? 'sample sufficient for a directional claim' : 'sample too small for a confident claim' };
}

// Re-export helpers used across engines.
export { scoreGenome, isStale, measured, estimated, assumed };
export type { Valued, OpportunityGenome, Evidence };
