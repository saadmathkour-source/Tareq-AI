import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';

/**
 * Unified Commercial Decision Engine (section 8).
 *
 * An opportunity advances through 17 fixed stages. Each transition is recorded
 * independently (who/what moved it, when, with which evidence). The engine
 * refuses to advance to a selling stage on the strength of a model score alone:
 * a stage gate must be satisfied by recorded evidence.
 */

export type Stage =
  | 'DISCOVERY'
  | 'EVIDENCE_COLLECTION'
  | 'DEMAND_VALIDATION'
  | 'BUYER_IDENTIFICATION'
  | 'ECONOMIC_ANALYSIS'
  | 'RISK_REVIEW'
  | 'OFFER_DESIGN'
  | 'PROTOTYPE'
  | 'QUALITY_VERIFICATION'
  | 'APPROVAL'
  | 'OUTREACH'
  | 'CONVERSION'
  | 'DELIVERY'
  | 'PAYMENT_VERIFICATION'
  | 'PROFIT_CALCULATION'
  | 'RETENTION'
  | 'LEARNING';

export const STAGE_ORDER: Stage[] = [
  'DISCOVERY',
  'EVIDENCE_COLLECTION',
  'DEMAND_VALIDATION',
  'BUYER_IDENTIFICATION',
  'ECONOMIC_ANALYSIS',
  'RISK_REVIEW',
  'OFFER_DESIGN',
  'PROTOTYPE',
  'QUALITY_VERIFICATION',
  'APPROVAL',
  'OUTREACH',
  'CONVERSION',
  'DELIVERY',
  'PAYMENT_VERIFICATION',
  'PROFIT_CALCULATION',
  'RETENTION',
  'LEARNING',
];

export interface StageContext {
  opportunityId: string;
  /** Evidence ids the engine can point to for this transition. */
  evidenceIds: string[];
  /** Structured gate data produced by the relevant capability. */
  gate: Record<string, unknown>;
}

export interface GateResult {
  pass: boolean;
  missing: string[];
}

/**
 * Per-stage gates. A stage may only be entered when its gate passes. Selling
 * stages (OUTREACH onward) demand substantially more than a model opinion.
 */
const GATES: Record<Stage, (ctx: StageContext) => GateResult> = {
  DISCOVERY: () => ({ pass: true, missing: [] }),
  EVIDENCE_COLLECTION: (c) => req(c, c.evidenceIds.length >= 1, 'at least one evidence record'),
  DEMAND_VALIDATION: (c) => req(c, Boolean(c.gate.demandProof), 'a demand-proof result'),
  BUYER_IDENTIFICATION: (c) => req(c, Boolean(c.gate.buyer), 'an identified buyer'),
  ECONOMIC_ANALYSIS: (c) => req(c, Boolean(c.gate.economics), 'an economic analysis'),
  RISK_REVIEW: (c) => req(c, Boolean(c.gate.risk), 'a risk review'),
  OFFER_DESIGN: (c) => req(c, Boolean(c.gate.offer), 'an offer definition'),
  PROTOTYPE: (c) => req(c, Boolean(c.gate.prototype), 'a tested prototype'),
  QUALITY_VERIFICATION: (c) => req(c, c.gate.qualityPassed === true, 'a passed quality gate'),
  APPROVAL: (c) => req(c, c.gate.approvalId !== undefined || c.gate.notRequired === true, 'an owner approval or an explicit not-required decision'),
  OUTREACH: (c) =>
    req(
      c,
      c.evidenceIds.length >= 2 && c.gate.demandProof === true && c.gate.qualityPassed === true,
      'at least two evidence records, a passed demand proof and a passed quality gate',
    ),
  CONVERSION: (c) => req(c, Boolean(c.gate.buyerConsent), 'recorded buyer consent to transact'),
  DELIVERY: (c) => req(c, Boolean(c.gate.deliveryPlan), 'a delivery plan'),
  PAYMENT_VERIFICATION: (c) => req(c, Boolean(c.gate.paymentReference), 'a payment provider reference'),
  PROFIT_CALCULATION: (c) => req(c, Boolean(c.gate.ledgerEntryId), 'a ledger entry'),
  RETENTION: (c) => req(c, Boolean(c.gate.outcomeVerified), 'a verified customer outcome'),
  LEARNING: (c) => req(c, Boolean(c.gate.result), 'a recorded result'),
};

function req(c: StageContext, ok: boolean, what: string): GateResult {
  return ok ? { pass: true, missing: [] } : { pass: false, missing: [what] };
}

export class StageGateError extends Error {
  readonly stage: Stage;
  readonly missing: string[];
  constructor(stage: Stage, missing: string[]) {
    super(`Cannot enter stage ${stage}: missing ${missing.join('; ')}`);
    this.name = 'StageGateError';
    this.stage = stage;
    this.missing = missing;
  }
}

export function nextStage(current: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(current);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1]! : null;
}

/** Evaluate a gate without mutating anything. */
export function checkGate(stage: Stage, ctx: StageContext): GateResult {
  return GATES[stage](ctx);
}

/**
 * Advance an opportunity one stage, recording a StageEvent. Throws if the gate
 * is not satisfied — no stage is ever skipped.
 */
export async function advance(
  opportunityId: string,
  to: Stage,
  ctx: StageContext,
  responsible: string,
): Promise<void> {
  const gate = checkGate(to, ctx);
  if (!gate.pass) {
    await audit({
      actorType: 'agent',
      action: 'opportunity.stage_blocked',
      target: opportunityId,
      severity: 'warn',
      metadata: { to, missing: gate.missing },
    });
    throw new StageGateError(to, gate.missing);
  }

  await prisma.$transaction(async (tx) => {
    await tx.stageEvent.create({
      data: {
        opportunityId,
        stage: to,
        responsible,
        evidenceRefs: ctx.evidenceIds as never,
        outcome: JSON.stringify(ctx.gate),
      },
    });
    await tx.opportunity.update({ where: { id: opportunityId }, data: { stage: to } });
  });

  await audit({
    actorType: 'agent',
    action: 'opportunity.stage_advanced',
    target: opportunityId,
    metadata: { to, responsible },
  });
  logger.info('opportunity advanced', { opportunityId, to });
}

/** The ordered trail of a stage, for the dashboard and for audit. */
export async function history(opportunityId: string) {
  return prisma.stageEvent.findMany({ where: { opportunityId }, orderBy: { startedAt: 'asc' } });
}

/** Kill an opportunity, recording the pre-declared reason (group 84). */
export async function kill(opportunityId: string, reason: string): Promise<void> {
  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: { stage: 'KILLED', killedAt: new Date(), killReason: reason },
  });
  await audit({ actorType: 'agent', action: 'opportunity.killed', target: opportunityId, severity: 'warn', metadata: { reason } });
}
