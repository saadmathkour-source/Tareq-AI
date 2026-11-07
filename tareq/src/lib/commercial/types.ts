/**
 * Shared types for the commercial intelligence engines.
 *
 * Every engine is a pure function over explicit inputs so results are
 * reproducible and unit-testable. Numbers carry their epistemic status:
 * `measured` values come from real observations, `estimated` from models,
 * `assumed` from stated assumptions. The directive requires these never be
 * conflated, so the distinction is in the type system, not just in prose.
 */

export type EvidenceQuality = 'measured' | 'estimated' | 'assumed';

export interface Valued<T = number> {
  value: T;
  quality: EvidenceQuality;
  /** Human-readable basis for the number, required for anything non-measured. */
  basis?: string;
}

export function measured<T>(value: T, basis?: string): Valued<T> {
  return { value, quality: 'measured', basis };
}
export function estimated<T>(value: T, basis: string): Valued<T> {
  return { value, quality: 'estimated', basis };
}
export function assumed<T>(value: T, basis: string): Valued<T> {
  return { value, quality: 'assumed', basis };
}

/** A single piece of market/competitor/demand evidence. */
export interface Evidence {
  id: string;
  statement: string;
  source: string;
  sourceUrl?: string;
  /** 0..1 */
  confidence: number;
  collectedAt: string;
  /** Days after collection at which this evidence must be re-verified. */
  validForDays: number;
}

export function isStale(e: Evidence, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - new Date(e.collectedAt).getTime();
  return ageMs > e.validForDays * 24 * 60 * 60 * 1000;
}

/** Opportunity genome — the structured fingerprint used by many engines. */
export interface OpportunityGenome {
  problem: string;
  painSeverity: number; // 0..10
  affectedBuyer: string;
  costOfProblemUsd: number; // annual, per buyer
  currentSolutions: string[];
  willingnessToPayUsd: number;
  buyingCycleDays: number;
  competitionIntensity: number; // 0..10
  costToReachBuyerUsd: number;
  potentialMarginPct: number; // 0..100
  confidence: number; // 0..1
  evidence: Evidence[];
}

/** Confidence-weighted score in 0..100. */
export function scoreGenome(g: OpportunityGenome): number {
  const pain = clamp(g.painSeverity / 10, 0, 1);
  const wtp = clamp(g.willingnessToPayUsd / Math.max(1, g.costOfProblemUsd), 0, 1);
  const comp = 1 - clamp(g.competitionIntensity / 10, 0, 1);
  const margin = clamp(g.potentialMarginPct / 100, 0, 1);
  const cycle = 1 - clamp(g.buyingCycleDays / 180, 0, 1);
  const reach = 1 - clamp(g.costToReachBuyerUsd / Math.max(1, g.willingnessToPayUsd), 0, 1);
  const raw = 0.25 * pain + 0.2 * wtp + 0.15 * comp + 0.2 * margin + 0.1 * cycle + 0.1 * reach;
  return Math.round(100 * raw * clamp(g.confidence, 0, 1) + 100 * raw * (1 - clamp(g.confidence, 0, 1)) * 0.5);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
