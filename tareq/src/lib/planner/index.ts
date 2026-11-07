import { prisma } from '../core/db.ts';
import { enqueue, type Priority } from '../queue/tasks.ts';

/**
 * Planner.
 *
 * Turns a goal into an ordered, dependency-aware task graph. The planner is
 * deliberately deterministic first: known goal kinds map to fixed step
 * templates, so behaviour is reproducible and testable. Model-driven planning is
 * an optional enrichment layered on top, never a requirement.
 */

export interface PlanStep {
  key: string;
  kind: string;
  payload?: Record<string, unknown>;
  priority?: Priority;
  dependsOnKeys?: string[];
  estimatedCostUsd?: number;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

/** Goal templates. Each key is a stable, auditable workflow. */
const TEMPLATES: Record<string, PlanStep[]> = {
  'opportunity.discover': [
    { key: 'research', kind: 'commercial.market_research', priority: 'NORMAL' },
    { key: 'genome', kind: 'commercial.opportunity_genome', dependsOnKeys: ['research'] },
    { key: 'demand', kind: 'commercial.demand_validation', dependsOnKeys: ['genome'] },
    { key: 'economics', kind: 'commercial.economic_analysis', dependsOnKeys: ['demand'] },
    { key: 'risk', kind: 'commercial.risk_review', dependsOnKeys: ['economics'] },
  ],
  'opportunity.to_offer': [
    { key: 'offer', kind: 'commercial.offer_design' },
    { key: 'claims', kind: 'commercial.evidence_gate', dependsOnKeys: ['offer'] },
    { key: 'quality', kind: 'commercial.quality_verification', dependsOnKeys: ['claims'] },
  ],
  'opportunity.to_sale': [
    { key: 'leads', kind: 'sales.lead_discovery' },
    { key: 'score', kind: 'sales.lead_score', dependsOnKeys: ['leads'] },
    { key: 'draft', kind: 'sales.outreach_draft', dependsOnKeys: ['score'] },
    { key: 'approve', kind: 'sales.outreach_send', dependsOnKeys: ['draft'], priority: 'HIGH' },
  ],
  'maintenance.cycle': [
    { key: 'freshness', kind: 'maintenance.evidence_freshness' },
    { key: 'assets', kind: 'commercial.asset_yield' },
    { key: 'portfolio', kind: 'commercial.risk_portfolio' },
  ],
};

export function templateFor(goal: string): Plan | null {
  const steps = TEMPLATES[goal];
  if (!steps) return null;
  return { goal, steps };
}

/** Enqueue a plan's steps, wiring dependencies between them. Returns task ids by key. */
export async function execute(
  plan: Plan,
  opts: { parentId?: string; opportunityId?: string; idempotencyPrefix?: string } = {},
): Promise<Record<string, string>> {
  const idByKey: Record<string, string> = {};
  // Create in declaration order so dependencies already exist.
  for (const step of plan.steps) {
    const dependsOn = (step.dependsOnKeys ?? []).map((k) => idByKey[k]).filter((v): v is string => Boolean(v));
    const id = await enqueue({
      kind: step.kind,
      payload: { ...(step.payload ?? {}), planKey: step.key, goal: plan.goal },
      priority: step.priority ?? 'NORMAL',
      dependsOn,
      estimatedCostUsd: step.estimatedCostUsd,
      parentId: opts.parentId,
      opportunityId: opts.opportunityId,
      idempotencyKey: opts.idempotencyPrefix ? `${opts.idempotencyPrefix}:${step.key}` : undefined,
    });
    idByKey[step.key] = id;
  }
  return idByKey;
}

/** Persist a plan as a parent task whose children carry the work. */
export async function plan(goal: string, opportunityId?: string): Promise<Record<string, string>> {
  const t = templateFor(goal);
  if (!t) throw new Error(`No plan template for goal: ${goal}`);
  const parentId = await enqueue({
    kind: 'plan',
    payload: { goal },
    priority: 'HIGH',
    opportunityId,
  });
  return execute(t, { parentId, opportunityId });
}

export { prisma };
