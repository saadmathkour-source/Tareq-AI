import { prisma } from '../core/db.ts';
import { LimitExceededError, ForbiddenError } from '../core/errors.ts';
import { audit } from '../core/audit.ts';
import { env } from '../env.ts';

/**
 * Owner controls (Phase 18, sections 11 and 3).
 *
 * Every hard limit the owner can set lives here, in one place, with a
 * conservative default. The defaults assume NO permission is granted: nothing
 * may be published, no outreach sent, no ad spend, no discounts, no financial
 * operations, until the owner turns it on. A missing row falls back to the
 * defaults, so an empty database is the safest configuration, never the loosest.
 *
 * These are enforcement points, not documentation. Callers that can spend,
 * publish, discount or act financially MUST call the matching `assert*` first.
 */

export interface Controls {
  /** Soft daily ceiling on model spend, USD. Enforced on top of the global cap. */
  dailyBudgetUsd: number;
  /** Soft monthly ceiling on model spend, USD. */
  monthlyBudgetUsd: number;
  /** Hard ceiling on the estimated cost of a single task, USD. */
  perTaskCostCapUsd: number;
  /** Cumulative ceiling on advertising/marketing spend, USD. 0 = no ads. */
  adSpendCapUsd: number;
  /** Maximum discount the agent may apply without a new approval, percent. */
  maxDiscountPct: number;
  /** Maximum model calls per rolling 24h before the agent must stop. */
  modelCallCapPerDay: number;
  /** Permission switches. All false until the owner grants them. */
  publishingAllowed: boolean;
  outreachAllowed: boolean;
  marketingAllowed: boolean;
  financialOpsAllowed: boolean;
  /**
   * Permission to publish original organic content (articles) to TAREQ's own
   * website. Separate from `publishingAllowed` (which gates selling product
   * pages) so the owner can grant one without the other.
   */
  contentPublishingAllowed: boolean;
  /** Emergency stop. True halts all acting work immediately. */
  emergencyStop: boolean;
}

export const DEFAULT_CONTROLS: Controls = {
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 20,
  perTaskCostCapUsd: 0.5,
  adSpendCapUsd: 0,
  maxDiscountPct: 0,
  modelCallCapPerDay: 200,
  publishingAllowed: false,
  outreachAllowed: false,
  marketingAllowed: false,
  financialOpsAllowed: false,
  contentPublishingAllowed: false,
  emergencyStop: false,
};

/**
 * Which controls are enforced at a real action point, and which are declared but
 * have no action path yet. This is deliberately explicit so the control surface
 * can never present an unenforced switch as a live security guarantee:
 *
 *  - IMPLEMENTED: the matching `assert*` is called at the point of action.
 *  - NOT_IMPLEMENTED: no action path exists yet. `setControls` REFUSES to turn
 *    such a switch ON (fail-closed), and `controlStatus()` reports it so the
 *    dashboard/docs can label it "not implemented" instead of "on".
 *
 * When a real action path for one of these is added, move it to IMPLEMENTED in
 * the same commit that adds the enforcement call.
 */
export const IMPLEMENTED_CONTROLS: Array<keyof Controls> = [
  'dailyBudgetUsd',
  'monthlyBudgetUsd',
  'perTaskCostCapUsd',
  'modelCallCapPerDay',
  'publishingAllowed',
  'outreachAllowed',
  'contentPublishingAllowed',
  'emergencyStop',
];

export const NOT_IMPLEMENTED_CONTROLS: Array<keyof Controls> = [
  'marketingAllowed',
  'financialOpsAllowed',
  'maxDiscountPct',
  'adSpendCapUsd',
];

/** The implementation status of every control, for the API/dashboard/docs. */
export function controlStatus(): { implemented: Array<keyof Controls>; notImplemented: Array<keyof Controls> } {
  return { implemented: IMPLEMENTED_CONTROLS, notImplemented: NOT_IMPLEMENTED_CONTROLS };
}

const KEY = 'operating_controls';

/** The current controls, defaults merged with any owner override. */
export async function getControls(): Promise<Controls> {
  const row = await prisma.controlSetting.findUnique({ where: { key: KEY } });
  const stored = (row?.value as Partial<Controls> | null) ?? {};
  return { ...DEFAULT_CONTROLS, ...stored };
}

/** Materialise the defaults once. Never overwrites an existing row. */
export async function seedControls(): Promise<void> {
  await prisma.controlSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: DEFAULT_CONTROLS as never },
    update: {},
  });
}

/** Apply a validated patch. Only known keys are accepted; unknown keys are ignored. */
export async function setControls(patch: Partial<Controls>, actorId: string): Promise<Controls> {
  const current = await getControls();
  const next: Controls = { ...current };
  for (const key of Object.keys(DEFAULT_CONTROLS) as Array<keyof Controls>) {
    const value = patch[key];
    if (value === undefined) continue;
    if (typeof DEFAULT_CONTROLS[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new ForbiddenError(`control ${key} must be a boolean`);
      // Fail closed: a permission switch with no action path cannot be turned
      // on. Turning it on would imply an enforcement that does not exist.
      if (value === true && NOT_IMPLEMENTED_CONTROLS.includes(key)) {
        throw new ForbiddenError(
          `control ${key} is NOT IMPLEMENTED: there is no action path to enforce it yet, so it cannot be enabled`,
        );
      }
      (next[key] as boolean) = value;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new ForbiddenError(`control ${key} must be a non-negative number`);
      // A limit with no action path cannot be raised above 0 (0 = the safe no-op).
      if (n > 0 && NOT_IMPLEMENTED_CONTROLS.includes(key)) {
        throw new ForbiddenError(
          `control ${key} is NOT IMPLEMENTED: there is no action path to enforce it yet, so it must stay 0`,
        );
      }
      (next[key] as number) = n;
    }
  }
  await prisma.controlSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as never },
    update: { value: next as never },
  });
  await audit({
    actorType: 'owner',
    actorId,
    action: 'controls.set',
    severity: 'warn',
    metadata: { changed: Object.keys(patch) },
  });
  return next;
}

/** Model calls and spend inside a rolling window, from provider_calls (the source of truth). */
async function modelSpendSince(since: Date): Promise<{ usd: number; calls: number }> {
  const agg = await prisma.providerCall.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { costUsd: true },
    _count: { _all: true },
  });
  return { usd: Number(agg._sum.costUsd ?? 0), calls: agg._count._all };
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Current consumption against the daily/monthly/model-call windows. */
export async function windowUsage(): Promise<{ todayUsd: number; monthUsd: number; callsToday: number }> {
  const day = await modelSpendSince(startOfUtcDay());
  const month = await modelSpendSince(startOfUtcMonth());
  return { todayUsd: day.usd, monthUsd: month.usd, callsToday: day.calls };
}

/**
 * Throw before any acting work if the owner has pulled the emergency stop.
 *
 * Fails CLOSED: if the control store cannot be read, we cannot prove the stop is
 * clear, so we treat the system as stopped rather than let work proceed.
 */
export async function assertNotStopped(): Promise<void> {
  if (await isEmergencyStopped()) {
    throw new ForbiddenError('emergency stop is engaged; all acting work is halted');
  }
}

/**
 * Whether acting work must halt. Returns `true` (halt) when the stop is engaged
 * OR when the control state cannot be read — a database/control-store failure
 * must never be interpreted as "not stopped". Used by the worker loop.
 */
export async function isEmergencyStopped(): Promise<boolean> {
  try {
    const c = await getControls();
    return c.emergencyStop;
  } catch {
    return true;
  }
}

/** Enforce the per-task cost ceiling and the daily/monthly windows for a projected spend. */
export async function assertTaskCostAllowed(projectedUsd: number, what: string): Promise<void> {
  await assertNotStopped();
  const c = await getControls();
  if (projectedUsd > c.perTaskCostCapUsd) {
    throw new LimitExceededError(
      'per-task cost cap',
      `projected $${projectedUsd.toFixed(4)} for "${what}" exceeds the per-task cap of $${c.perTaskCostCapUsd.toFixed(4)}`,
    );
  }
  const usage = await windowUsage();
  if (usage.todayUsd + projectedUsd > c.dailyBudgetUsd) {
    throw new LimitExceededError(
      'daily budget',
      `$${projectedUsd.toFixed(4)} for "${what}" would exceed the $${c.dailyBudgetUsd.toFixed(2)} daily budget (spent today $${usage.todayUsd.toFixed(4)})`,
    );
  }
  if (usage.monthUsd + projectedUsd > c.monthlyBudgetUsd) {
    throw new LimitExceededError(
      'monthly budget',
      `$${projectedUsd.toFixed(4)} for "${what}" would exceed the $${c.monthlyBudgetUsd.toFixed(2)} monthly budget (spent this month $${usage.monthUsd.toFixed(4)})`,
    );
  }
}

/** Enforce the rolling 24h model-call cap. */
export async function assertModelCallAllowed(): Promise<void> {
  const c = await getControls();
  const day = await modelSpendSince(startOfUtcDay());
  if (day.calls >= c.modelCallCapPerDay) {
    throw new LimitExceededError('model call cap', `${day.calls} calls today reach the cap of ${c.modelCallCapPerDay}`);
  }
}

/** Cumulative marketing/advertising spend vs the owner's cap. */
export async function assertAdSpendAllowed(amountUsd: number): Promise<void> {
  const c = await getControls();
  if (!c.marketingAllowed) throw new ForbiddenError('marketing is not permitted by the owner controls');
  const agg = await prisma.ledgerEntry.aggregate({ where: { kind: 'MARKETING_COST' }, _sum: { amountUsd: true } });
  const spent = Number(agg._sum.amountUsd ?? 0);
  if (spent + amountUsd > c.adSpendCapUsd) {
    throw new LimitExceededError(
      'ad spend cap',
      `$${amountUsd.toFixed(2)} would exceed the $${c.adSpendCapUsd.toFixed(2)} ad-spend cap (spent $${spent.toFixed(2)})`,
    );
  }
}

/** A discount above the owner's ceiling needs a fresh approval. */
export async function assertDiscountAllowed(pct: number): Promise<void> {
  const c = await getControls();
  if (pct > c.maxDiscountPct) {
    throw new ForbiddenError(`discount ${pct}% exceeds the allowed maximum of ${c.maxDiscountPct}%`);
  }
}

export async function assertPublishingAllowed(): Promise<void> {
  const c = await getControls();
  if (!c.publishingAllowed) throw new ForbiddenError('publishing is not permitted by the owner controls');
}

/** Gate for publishing original organic content (articles) to TAREQ's own site. */
export async function assertContentPublishingAllowed(): Promise<void> {
  const c = await getControls();
  if (!c.contentPublishingAllowed) throw new ForbiddenError('content publishing is not permitted by the owner controls');
}

export async function assertOutreachAllowed(): Promise<void> {
  const c = await getControls();
  if (!c.outreachAllowed) throw new ForbiddenError('outreach is not permitted by the owner controls');
}

export async function assertFinancialOpsAllowed(): Promise<void> {
  const c = await getControls();
  if (!c.financialOpsAllowed) throw new ForbiddenError('financial operations are not permitted by the owner controls');
}

/** Seed defaults from the environment's global cap when present, keeping owner overrides. */
export async function ensureControls(): Promise<void> {
  const e = env();
  const existing = await prisma.controlSetting.findUnique({ where: { key: KEY } });
  if (existing) return;
  await prisma.controlSetting.create({
    data: {
      key: KEY,
      value: {
        ...DEFAULT_CONTROLS,
        dailyBudgetUsd: Math.min(DEFAULT_CONTROLS.dailyBudgetUsd, e.TAREQ_BUDGET_CAP_USD),
        monthlyBudgetUsd: e.TAREQ_BUDGET_CAP_USD,
      } as never,
    },
  });
}
