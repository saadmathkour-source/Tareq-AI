import { prisma } from '../core/db.ts';
import { enqueue } from './tasks.ts';
import { logger } from '../core/logger.ts';

/**
 * Scheduler.
 *
 * Recurring work is declared once and materialised as ordinary durable tasks.
 * The scheduler is deliberately cheap: it computes due schedules on each tick
 * and enqueues the work, using an idempotency key per (schedule, fire time) so
 * a restart cannot double-fire a run. No per-second polling of paid APIs.
 */

export interface ScheduleSeed {
  name: string;
  cron: string;
  taskKind: string;
  payload?: Record<string, unknown>;
}

export const DEFAULT_SCHEDULES: ScheduleSeed[] = [
  { name: 'maintenance.cycle', cron: '0 6 * * *', taskKind: 'maintenance.cycle', payload: {} },
  { name: 'evidence.freshness', cron: '0 7 * * *', taskKind: 'maintenance.evidence_freshness', payload: {} },
  // Commercial operation: ensure the catalog/landings exist and refresh the
  // daily financial report. Both are read-mostly and cost nothing to run.
  { name: 'commercial.catalog', cron: '30 5 * * *', taskKind: 'product.seed_catalog', payload: {} },
  { name: 'finance.daily', cron: '45 23 * * *', taskKind: 'finance.daily_report', payload: {} },
  // Phase 18: the supervisor runs every 10 minutes — it is cheap (only queries
  // local tables), self-healing, and de-duplicates its own findings, so a short
  // interval keeps the operation watched without polling any paid API.
  { name: 'supervisor.watchdog', cron: '*/10 * * * *', taskKind: 'supervisor.watchdog', payload: {} },
  // Autonomous optimization: once a day, compare realised product margins.
  { name: 'commercial.optimize', cron: '15 6 * * *', taskKind: 'commercial.optimize', payload: {} },
];

export async function seedSchedules(seeds: ScheduleSeed[] = DEFAULT_SCHEDULES): Promise<number> {
  let n = 0;
  for (const s of seeds) {
    await prisma.schedule.upsert({
      where: { name: s.name },
      create: {
        name: s.name,
        cron: s.cron,
        taskKind: s.taskKind,
        payload: (s.payload ?? {}) as never,
        nextRunAt: nextCron(s.cron, new Date()),
      },
      update: { cron: s.cron, taskKind: s.taskKind, payload: (s.payload ?? {}) as never },
    });
    n++;
  }
  return n;
}

/** Minimal 5-field cron parser: minute hour day month weekday. Supports * and lists. */
export function cronMatches(cron: string, at: Date): boolean {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  const fieldMatch = (spec: string | undefined, value: number): boolean => {
    if (!spec || spec === '*') return true;
    return spec.split(',').some((part) => {
      if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = Number(stepStr);
        if (!step) return false;
        if (range === '*') return value % step === 0;
      }
      return Number(part) === value;
    });
  };
  return (
    fieldMatch(min, at.getUTCMinutes()) &&
    fieldMatch(hour, at.getUTCHours()) &&
    fieldMatch(dom, at.getUTCDate()) &&
    fieldMatch(mon, at.getUTCMonth() + 1) &&
    fieldMatch(dow, at.getUTCDay())
  );
}

/** Next matching minute strictly after `from`. Scans up to 366 days. */
export function nextCron(cron: string, from: Date): Date {
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(cron, d)) return new Date(d.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return new Date(from.getTime() + 86_400_000);
}

/** Enqueue every due schedule. Idempotent per fire minute. */
export async function tickScheduler(now = new Date()): Promise<number> {
  const due = await prisma.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  let fired = 0;
  for (const s of due) {
    const fireKey = s.nextRunAt ? s.nextRunAt.toISOString() : now.toISOString();
    await enqueue({
      kind: s.taskKind,
      payload: { ...(s.payload as Record<string, unknown>), schedule: s.name },
      idempotencyKey: `schedule:${s.name}:${fireKey}`,
      priority: 'LOW',
    });
    await prisma.schedule.update({
      where: { id: s.id },
      data: { lastRunAt: now, nextRunAt: nextCron(s.cron, now) },
    });
    fired++;
    logger.info('schedule fired', { name: s.name, kind: s.taskKind });
  }
  return fired;
}

/**
 * Run the scheduler on an interval. `tickScheduler` only fires schedules that
 * are due, so a short interval is cheap and safe. Returns a stop function.
 * Without this, daily crons would only be checked at process start.
 */
export function startScheduler(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void tickScheduler().catch((err) => logger.error('scheduler tick failed', { error: (err as Error).message }));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
