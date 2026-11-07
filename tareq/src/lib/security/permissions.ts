import { ApprovalRequiredError, ForbiddenError } from '../core/errors.ts';
import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';

/**
 * Permission engine.
 *
 * Every externally-visible or money-moving action passes through `authorize()`.
 * Two independent gates:
 *   1. Operating mode — OBSERVE cannot act, AUTONOMOUS may act on low-risk work.
 *   2. Action class  — sensitive actions always need an explicit owner approval,
 *      regardless of mode. A sub-agent or the agent itself can never grant them.
 */

export type OperatingMode = 'OBSERVE' | 'PLAN' | 'SANDBOX' | 'SUPERVISED' | 'AUTONOMOUS';
const MODE_RANK: Record<OperatingMode, number> = {
  OBSERVE: 0,
  PLAN: 1,
  SANDBOX: 2,
  SUPERVISED: 3,
  AUTONOMOUS: 4,
};

/**
 * Action classes. `risk` is the intrinsic risk of the action, independent of mode.
 * `requiresApproval` actions are never auto-approved by any mode.
 */
export const ACTION_CLASSES = {
  // --- read / analyse: safe in every mode from SANDBOX up ---
  'research.search': { risk: 'low', requiresApproval: false, minMode: 'SANDBOX' },
  'market.analyse': { risk: 'low', requiresApproval: false, minMode: 'SANDBOX' },
  'evidence.record': { risk: 'low', requiresApproval: false, minMode: 'SANDBOX' },
  'plan.create': { risk: 'low', requiresApproval: false, minMode: 'PLAN' },
  'memory.write': { risk: 'low', requiresApproval: false, minMode: 'PLAN' },

  // --- sandboxed building / testing ---
  'product.prototype': { risk: 'medium', requiresApproval: false, minMode: 'SANDBOX' },
  'experiment.run': { risk: 'medium', requiresApproval: false, minMode: 'SANDBOX' },
  'offer.draft': { risk: 'medium', requiresApproval: false, minMode: 'SANDBOX' },
  'outreach.draft': { risk: 'medium', requiresApproval: false, minMode: 'SANDBOX' },
  'lead.score': { risk: 'low', requiresApproval: false, minMode: 'SANDBOX' },

  // --- actions that touch the outside world or money: owner approval required ---
  'outreach.send': { risk: 'high', requiresApproval: true, minMode: 'SUPERVISED' },
  'offer.publish': { risk: 'high', requiresApproval: true, minMode: 'SUPERVISED' },
  'contract.propose': { risk: 'high', requiresApproval: true, minMode: 'SUPERVISED' },
  'spend.commit': { risk: 'high', requiresApproval: true, minMode: 'SUPERVISED' },
  'payment.refund': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'payment.transfer': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'budget.raise': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'production.change': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'data.delete': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'permission.change': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
  'secrets.access': { risk: 'high', requiresApproval: true, minMode: 'SUPERVISED' },
  'revenue.reinvest': { risk: 'critical', requiresApproval: true, minMode: 'SUPERVISED' },
} as const;

export type ActionClass = keyof typeof ACTION_CLASSES;

export interface AuthzRequest {
  action: ActionClass;
  actorType: 'owner' | 'agent' | 'system';
  actorId?: string;
  /** Present when the caller already holds an approval for this action. */
  approvalId?: string;
  /** Cost the action will incur, checked against the budget cap. */
  costUsd?: number;
  reason?: string;
}

export interface AuthzResult {
  allowed: boolean;
  approvalId?: string;
}

/** Current operating mode from settings, defaulting to the safest value. */
export async function currentMode(): Promise<OperatingMode> {
  const row = await prisma.setting.findUnique({ where: { key: 'operating_mode' } });
  const value = (row?.value as { mode?: OperatingMode } | null)?.mode;
  return value ?? 'OBSERVE';
}

export async function setMode(mode: OperatingMode, actorId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'operating_mode' },
    create: { key: 'operating_mode', value: { mode } as never },
    update: { value: { mode } as never },
  });
  await audit({ actorType: 'owner', actorId, action: 'operating_mode.set', target: mode, severity: 'warn' });
}

/**
 * Authorize an action, creating an approval request when required.
 * Throws `ForbiddenError` when the mode forbids it outright, or
 * `ApprovalRequiredError` when a decision is needed and none exists yet.
 */
export async function authorize(req: AuthzRequest): Promise<AuthzResult> {
  const spec = ACTION_CLASSES[req.action];
  if (!spec) throw new ForbiddenError(`Unknown action class: ${req.action}`);

  // The owner is the authority; owner-initiated actions are always allowed.
  if (req.actorType === 'owner') return { allowed: true };

  const mode = await currentMode();
  if (MODE_RANK[mode] < MODE_RANK[spec.minMode as OperatingMode]) {
    throw new ForbiddenError(
      `Action "${req.action}" requires mode >= ${spec.minMode}; current mode is ${mode}`,
    );
  }

  if (!spec.requiresApproval) return { allowed: true };

  // Sensitive action: look for an existing approved, undecided-on-this approval.
  if (req.approvalId) {
    const approval = await prisma.approval.findUnique({ where: { id: req.approvalId } });
    if (approval && approval.status === 'APPROVED' && approval.action === req.action) {
      return { allowed: true, approvalId: approval.id };
    }
  }

  // No valid approval: create a pending one and stop.
  const approval = await prisma.approval.create({
    data: {
      title: req.action,
      action: req.action,
      reason: req.reason ?? `Agent requested "${req.action}"`,
      costUsd: req.costUsd ?? null,
      risk: spec.risk,
      status: 'PENDING',
    },
  });
  await audit({
    actorType: req.actorType,
    actorId: req.actorId,
    action: 'approval.requested',
    target: approval.id,
    severity: 'warn',
    metadata: { action: req.action, costUsd: req.costUsd ?? null },
  });
  throw new ApprovalRequiredError(req.action, `approval ${approval.id} created and pending`);
}

/** True when the given action can never be auto-approved. */
export function isSensitive(action: ActionClass): boolean {
  return ACTION_CLASSES[action].requiresApproval;
}

export { MODE_RANK };
