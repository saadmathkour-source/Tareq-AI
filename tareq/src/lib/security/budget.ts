import { prisma } from '../core/db.ts';
import { LimitExceededError } from '../core/errors.ts';
import { logger } from '../core/logger.ts';
import { audit } from '../core/audit.ts';
import { env } from '../env.ts';

/**
 * Hard budget ceiling. The cap is a limit, never a target.
 *
 * Every spend path calls `assertCanSpend()` first and `recordSpend()` after, so
 * a run that would cross the cap is refused before it incurs cost. Raising the
 * cap is a sensitive action requiring owner approval (see permissions.ts).
 */

const SCOPE = 'global';

export async function ensureBudget(): Promise<void> {
  const { TAREQ_BUDGET_CAP_USD, TAREQ_BUDGET_WARN_USD } = env();
  await prisma.budget.upsert({
    where: { scope: SCOPE },
    create: { scope: SCOPE, capUsd: TAREQ_BUDGET_CAP_USD, warnUsd: TAREQ_BUDGET_WARN_USD, spentUsd: 0 },
    update: {},
  });
}

export async function snapshot(): Promise<{ capUsd: number; spentUsd: number; remainingUsd: number; warnUsd: number | null }> {
  await ensureBudget();
  const b = await prisma.budget.findUniqueOrThrow({ where: { scope: SCOPE } });
  const capUsd = Number(b.capUsd);
  const spentUsd = Number(b.spentUsd);
  return {
    capUsd,
    spentUsd,
    remainingUsd: Math.max(0, capUsd - spentUsd),
    warnUsd: b.warnUsd === null ? null : Number(b.warnUsd),
  };
}

/** Throw before spending if the projected amount would exceed the cap. */
export async function assertCanSpend(projectedUsd: number, what: string): Promise<void> {
  const { capUsd, spentUsd } = await snapshot();
  if (spentUsd + projectedUsd > capUsd) {
    throw new LimitExceededError(
      'budget cap',
      `spending $${projectedUsd.toFixed(4)} on "${what}" would exceed the $${capUsd.toFixed(2)} cap (already spent $${spentUsd.toFixed(4)})`,
    );
  }
}

/** Record actual spend and warn once the warning threshold is crossed. */
export async function recordSpend(amountUsd: number, what: string): Promise<void> {
  if (amountUsd <= 0) return;
  await ensureBudget();
  const b = await prisma.budget.update({
    where: { scope: SCOPE },
    data: { spentUsd: { increment: amountUsd } },
  });
  const spentUsd = Number(b.spentUsd);
  const warnUsd = b.warnUsd === null ? null : Number(b.warnUsd);
  if (warnUsd !== null && spentUsd >= warnUsd && spentUsd - amountUsd < warnUsd) {
    logger.warn('budget warning threshold crossed', { spentUsd, warnUsd, what });
    await audit({ actorType: 'system', action: 'budget.warn', severity: 'warn', metadata: { spentUsd, warnUsd } });
  }
}
