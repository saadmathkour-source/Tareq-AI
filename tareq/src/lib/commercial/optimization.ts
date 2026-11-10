import { clamp, round2 } from './types.ts';

/**
 * Autonomous optimization & reliability engines (Phase 18, sections 8 and 10).
 *
 * Pure, deterministic functions over explicit inputs — the same contract as the
 * other engines, so they are unit-testable without a database and their numbers
 * are reproducible. Nothing here invents data: every recommendation is derived
 * from the inputs and names the evidence it used.
 */

// ---------------------------------------------------------------------------
// Agent reliability — is a sub-agent degraded, and should it be paused?
// ---------------------------------------------------------------------------

export interface AgentRunSample {
  ok: boolean;
  costUsd: number;
  latencyMs?: number;
}

export interface AgentReliability {
  name: string;
  runs: number;
  failures: number;
  failureRate: number;
  avgCostUsd: number;
  degraded: boolean;
  recommendation: 'healthy' | 'watch' | 'pause';
}

/**
 * Judge an agent from its recent runs. Needs at least `minRuns` samples before
 * it will call anything degraded — a single failure is noise, not a verdict.
 */
export function agentReliability(name: string, runs: AgentRunSample[], minRuns = 3): AgentReliability {
  const n = runs.length;
  const failures = runs.filter((r) => !r.ok).length;
  const failureRate = n > 0 ? failures / n : 0;
  const avgCostUsd = n > 0 ? runs.reduce((a, r) => a + r.costUsd, 0) / n : 0;
  const degraded = n >= minRuns && failureRate >= 0.5;
  const recommendation: AgentReliability['recommendation'] = !degraded
    ? failureRate > 0.25
      ? 'watch'
      : 'healthy'
    : 'pause';
  return { name, runs: n, failures, failureRate: round2(failureRate), avgCostUsd: round2(avgCostUsd), degraded, recommendation };
}

// ---------------------------------------------------------------------------
// Dependency integrity — a task waiting on a prerequisite that does not exist
// ---------------------------------------------------------------------------

export interface TaskNode {
  id: string;
  dependsOn: string[];
  status: string;
}

export interface DependencyIntegrity {
  orphans: Array<{ id: string; missing: string[] }>;
  blockedByFailed: Array<{ id: string; failed: string[] }>;
  ok: boolean;
}

/**
 * Find tasks whose dependencies cannot be satisfied: either the prerequisite id
 * does not exist at all, or the prerequisite is already terminal-failed. Either
 * way the task would wait forever, so it must be dead-lettered rather than left.
 */
export function dependencyIntegrity(nodes: TaskNode[]): DependencyIntegrity {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const orphans: DependencyIntegrity['orphans'] = [];
  const blockedByFailed: DependencyIntegrity['blockedByFailed'] = [];
  const FAILED = new Set(['DEAD', 'CANCELLED']);
  for (const n of nodes) {
    if (n.dependsOn.length === 0) continue;
    const missing = n.dependsOn.filter((d) => !byId.has(d));
    if (missing.length > 0) {
      orphans.push({ id: n.id, missing });
      continue;
    }
    const failed = n.dependsOn.filter((d) => FAILED.has(byId.get(d)!.status));
    if (failed.length > 0) blockedByFailed.push({ id: n.id, failed });
  }
  return { orphans, blockedByFailed, ok: orphans.length === 0 && blockedByFailed.length === 0 };
}

// ---------------------------------------------------------------------------
// Duplicate suppression — same logical job enqueued twice without a key
// ---------------------------------------------------------------------------

export interface PendingTask {
  id: string;
  kind: string;
  payload: unknown;
  idempotencyKey?: string | null;
  createdAt: string;
}

/**
 * Return the ids that are redundant duplicates of an earlier pending task. A
 * task that carries an idempotency key is already de-duplicated by the queue, so
 * it is never reported here. Order is by `createdAt` ascending; the first of a
 * (kind, payload) group wins.
 */
export function duplicateSuppression(tasks: PendingTask[]): { keep: string[]; duplicates: string[] } {
  const sorted = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Map<string, string>();
  const keep: string[] = [];
  const duplicates: string[] = [];
  for (const t of sorted) {
    if (t.idempotencyKey) {
      keep.push(t.id);
      continue;
    }
    const key = `${t.kind}:${stableStringify(t.payload)}`;
    if (seen.has(key)) {
      duplicates.push(t.id);
    } else {
      seen.set(key, t.id);
      keep.push(t.id);
    }
  }
  return { keep, duplicates };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Resource allocation — send each task to the cheapest model that clears quality
// ---------------------------------------------------------------------------

export interface ModelProfile {
  name: string;
  /** 0..1 quality score for this kind of work. */
  quality: number;
  /** Estimated USD per 1k tokens (blended). */
  costPer1k: number;
}

export interface AllocationInput {
  kind: string;
  /** Minimum acceptable quality for this task kind, 0..1. */
  requiredQuality: number;
  /** Rough token budget for the task. */
  tokens: number;
  /** Priority may justify a stronger model when quality is borderline. */
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export interface Allocation {
  kind: string;
  model: string | null;
  reason: string;
  estimatedCostUsd: number;
}

/**
 * Pick the cheapest model whose quality clears the task's requirement. Ties
 * break toward lower cost, then higher quality. When nothing clears the bar, no
 * model is chosen — the task is not silently downgraded to an unfit model.
 */
export function allocateResources(input: AllocationInput, models: ModelProfile[]): Allocation {
  const eligible = models.filter((m) => m.quality >= input.requiredQuality);
  if (eligible.length === 0) {
    return { kind: input.kind, model: null, reason: `no model meets quality >= ${input.requiredQuality}`, estimatedCostUsd: 0 };
  }
  const ranked = [...eligible].sort((a, b) => a.costPer1k - b.costPer1k || b.quality - a.quality);
  const chosen = ranked[0]!;
  const estimatedCostUsd = round2((chosen.costPer1k * input.tokens) / 1000 * 10000) / 10000;
  return {
    kind: input.kind,
    model: chosen.name,
    reason: `cheapest model with quality ${chosen.quality} >= ${input.requiredQuality}`,
    estimatedCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Optimization report — what is working, what is losing money, what to stop
// ---------------------------------------------------------------------------

export interface ProductPerformance {
  slug: string;
  name: string;
  priceUsd: number;
  unitCostUsd: number;
  orders: number;
  revenueUsd: number;
  costUsd: number;
}

export interface ProductVerdict extends ProductPerformance {
  marginUsd: number;
  marginPct: number;
  verdict: 'scale' | 'hold' | 'fix' | 'stop';
  note: string;
}

export interface OptimizationReport {
  products: ProductVerdict[];
  /** Recommendations the agent may act on within its own authority. */
  actions: string[];
  /** Changes that need owner approval (pricing, stopping a channel). */
  requiresOwnerApproval: string[];
}

/**
 * Compare products by realised margin and recommend an action for each. A
 * product with no orders yet is `hold` (not `stop`) — absence of sales is not
 * evidence of failure, and the honest thing is to say so.
 */
export function optimizationReport(products: ProductPerformance[], minMarginPct = 20): OptimizationReport {
  const verdicts: ProductVerdict[] = products.map((p) => {
    const marginUsd = p.revenueUsd - p.costUsd;
    const marginPct = p.revenueUsd > 0 ? (marginUsd / p.revenueUsd) * 100 : 0;
    let verdict: ProductVerdict['verdict'];
    let note: string;
    if (p.orders === 0) {
      verdict = 'hold';
      note = 'no orders yet — absence of sales is not evidence of failure';
    } else if (marginUsd < 0) {
      verdict = 'stop';
      note = 'losing money on every unit sold';
    } else if (marginPct < minMarginPct) {
      verdict = 'fix';
      note = `margin ${round2(marginPct)}% is below the ${minMarginPct}% floor`;
    } else if (marginPct >= minMarginPct * 1.5) {
      verdict = 'scale';
      note = `strong margin ${round2(marginPct)}%`;
    } else {
      verdict = 'hold';
      note = `acceptable margin ${round2(marginPct)}%`;
    }
    return { ...p, marginUsd: round2(marginUsd), marginPct: round2(marginPct), verdict, note };
  });

  const actions: string[] = [];
  const requiresOwnerApproval: string[] = [];
  for (const v of verdicts) {
    if (v.verdict === 'stop') requiresOwnerApproval.push(`stop selling "${v.name}" (margin ${v.marginPct}%)`);
    if (v.verdict === 'fix') actions.push(`re-check the cost stack for "${v.name}" (margin ${v.marginPct}%)`);
    if (v.verdict === 'scale') actions.push(`allocate more research effort to "${v.name}"`);
  }
  return { products: verdicts, actions, requiresOwnerApproval };
}

// ---------------------------------------------------------------------------
// Commercial readiness — honest per-capability evidence check
// ---------------------------------------------------------------------------

export interface ReadinessItem {
  n: number;
  name: string;
  /** Did an independent, verifiable artefact back this item? */
  verified: boolean;
  evidence: string;
  blockedBy?: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  verified: number;
  total: number;
  complete: boolean;
  blockers: string[];
}

/**
 * Summarise a readiness checklist. This never upgrades an item: an item with no
 * verifiable evidence stays unverified, and any external blocker is surfaced
 * verbatim so the report cannot read as more finished than it is.
 */
export function commercialReadiness(items: ReadinessItem[]): ReadinessReport {
  const verified = items.filter((i) => i.verified).length;
  const blockers = items.filter((i) => i.blockedBy).map((i) => `#${i.n} ${i.name}: ${i.blockedBy}`);
  return {
    items,
    verified,
    total: items.length,
    complete: verified === items.length,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// Budget windows — is the agent inside its owner-set limits?
// ---------------------------------------------------------------------------

export interface WindowStatus {
  todayUsd: number;
  dailyCapUsd: number;
  monthUsd: number;
  monthlyCapUsd: number;
  callsToday: number;
  callCapPerDay: number;
  withinDaily: boolean;
  withinMonthly: boolean;
  withinCallCap: boolean;
  utilisation: number;
}

export function budgetWindows(input: {
  todayUsd: number;
  dailyCapUsd: number;
  monthUsd: number;
  monthlyCapUsd: number;
  callsToday: number;
  callCapPerDay: number;
}): WindowStatus {
  const withinDaily = input.todayUsd <= input.dailyCapUsd;
  const withinMonthly = input.monthUsd <= input.monthlyCapUsd;
  const withinCallCap = input.callsToday <= input.callCapPerDay;
  const utilisation = input.monthlyCapUsd > 0 ? clamp(input.monthUsd / input.monthlyCapUsd, 0, 1) : 1;
  return { ...input, withinDaily, withinMonthly, withinCallCap, utilisation: round2(utilisation) };
}
