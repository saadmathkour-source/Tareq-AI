import { prisma } from '../core/db.ts';
import { env } from '../env.ts';
import { snapshot as budgetSnapshot } from '../security/budget.ts';
import { stats as queueStats } from '../queue/tasks.ts';
import { probe as probeProvider } from '../providers/index.ts';
import { CAPABILITIES, summary as capSummary } from '../capabilities/index.ts';

/**
 * Health and readiness.
 *
 * Reports liveness, database reachability, provider reachability, queue depth
 * and budget position. Secrets are reported as booleans only — never values.
 */

export interface HealthReport {
  ok: boolean;
  service: 'tareq';
  version: string;
  uptimeMs: number;
  checks: Record<string, { ok: boolean; detail?: string }>;
  queue?: Record<string, number>;
  budget?: { capUsd: number; spentUsd: number; remainingUsd: number };
  capabilities?: Record<string, number>;
  timestamp: string;
}

const startedAt = Date.now();

export async function health(opts: { deep?: boolean } = {}): Promise<HealthReport> {
  const checks: HealthReport['checks'] = {};

  // Environment presence (booleans only).
  checks.env = {
    ok: Boolean(process.env.DATABASE_URL),
    detail: `openai:${Boolean(process.env.OPENAI_API_KEY)} deepseek:${Boolean(process.env.DEEPSEEK_API_KEY)} owner:${Boolean(process.env.TAREQ_OWNER_PASSWORD)}`,
  };

  // Database.
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, detail: (err as Error).message.slice(0, 200) };
  }

  const report: HealthReport = {
    ok: Object.values(checks).every((c) => c.ok),
    service: 'tareq',
    version: '0.1.0',
    uptimeMs: Date.now() - startedAt,
    checks,
    timestamp: new Date().toISOString(),
  };

  if (opts.deep) {
    const [openai, deepseek] = await Promise.all([probeProvider('openai'), probeProvider('deepseek')]);
    checks.provider_openai = openai;
    checks.provider_deepseek = deepseek;
    report.ok = Object.values(checks).every((c) => c.ok);
    try {
      report.queue = await queueStats();
    } catch { /* table may not exist yet */ }
    try {
      report.budget = await budgetSnapshot();
    } catch { /* budget row may not exist yet */ }
    report.capabilities = capSummary();
  }

  return report;
}

/** Capability acceptance table for the dashboard and the final report. */
export function capabilityTable() {
  return { summary: capSummary(), items: CAPABILITIES };
}

/** Re-export for callers that want the configured cap without touching env directly. */
export function budgetCap(): number {
  return env().TAREQ_BUDGET_CAP_USD;
}
