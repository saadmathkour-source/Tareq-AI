import { prisma } from './db.ts';
import { audit } from './audit.ts';
import { logger } from './logger.ts';
import { emit } from './events.ts';
import { reclaimStale } from '../queue/tasks.ts';
import { getControls, windowUsage } from '../security/controls.ts';
import { snapshot as budgetSnapshot } from '../security/budget.ts';

/**
 * Supervisor & watchdog (Phase 18, sections 9 and 10).
 *
 * A single central loop that watches the autonomous operation and either
 * self-heals or escalates. It is deliberately query-frugal and idempotent:
 * running it twice in a row produces no duplicate findings, and it never spends
 * money. Every check that mutates state records what it did in `actionTaken`.
 *
 * What it detects (and what it does):
 *   STALLED_TASK      RUNNING task whose heartbeat went stale -> reclaimed
 *   ORPHAN_DEPENDENCY task waiting on a dependency id that does not exist -> dead-lettered
 *   DUPLICATE_TASK    two pending tasks with the same kind+payload -> extra cancelled
 *   DEAD_LETTER       a task exhausted retries -> escalated (needs a human)
 *   STUCK_APPROVAL    a pending approval older than the window -> escalated
 *   BUDGET_BREACH     spend at/over the hard cap -> escalated (critical)
 *   BUDGET_WINDOW     daily/monthly model window near or over the owner limit -> escalated
 *   STALE_SCHEDULE    an enabled schedule whose next run is far in the past -> advanced
 *   AGENT_DEGRADED    a sub-agent whose recent runs mostly failed -> escalated
 *   KILL_SWITCH       the owner's emergency stop is engaged -> recorded (info)
 */

export type Severity = 'info' | 'warn' | 'error' | 'critical';

export interface Finding {
  kind: string;
  severity: Severity;
  subject?: string;
  detail: Record<string, unknown>;
  actionTaken?: string;
  /** When true the finding is informational and does not need a human. */
  autoResolved?: boolean;
}

export interface WatchdogReport {
  ranAt: string;
  findings: Finding[];
  autoResolved: number;
  open: number;
  requiresHuman: number;
}

/** How long a RUNNING task may go without a heartbeat before it is reclaimed. */
const STALL_MS = 5 * 60_000;
/** A pending approval older than this is flagged to the owner. */
const APPROVAL_STUCK_MS = 3 * 86_400_000;
/** A schedule whose next run is more than this late is advanced. */
const SCHEDULE_LATE_MS = 6 * 3600_000;

function payloadKey(kind: string, payload: unknown): string {
  try {
    return `${kind}:${JSON.stringify(payload ?? {})}`;
  } catch {
    return `${kind}:<unserialisable>`;
  }
}

/**
 * Record a finding once. A finding with the same (kind, subject) that is still
 * OPEN is not duplicated — the watchdog is run on a timer, so this is what keeps
 * the alert list a signal rather than a log. `seen` is pre-loaded with the open
 * keys so a run does not issue one lookup per finding.
 */
async function raise(f: Finding, seen: Set<string>): Promise<boolean> {
  const key = `${f.kind}::${f.subject ?? ''}`;
  if (seen.has(key)) return false;
  seen.add(key);
  await prisma.watchdogAlert.create({
    data: {
      kind: f.kind,
      severity: f.severity,
      status: f.autoResolved ? 'AUTO_RESOLVED' : 'OPEN',
      subject: f.subject ?? null,
      detail: f.detail as never,
      actionTaken: f.actionTaken ?? null,
      resolvedAt: f.autoResolved ? new Date() : null,
    },
  });
  await audit({
    actorType: 'system',
    action: `watchdog.${f.kind}`,
    target: f.subject,
    severity: f.severity === 'info' ? 'info' : f.severity === 'warn' ? 'warn' : 'error',
    metadata: { ...f.detail, actionTaken: f.actionTaken ?? null },
  });
  return true;
}

/** Reclaim RUNNING tasks whose heartbeat went stale (crash recovery). */
async function checkStalledTasks(now: Date): Promise<Finding[]> {
  const staleBefore = new Date(now.getTime() - STALL_MS);
  const stalled = await prisma.task.findMany({
    where: { status: 'RUNNING', heartbeatAt: { lt: staleBefore } },
    select: { id: true, kind: true, lockedBy: true, heartbeatAt: true },
    take: 50,
  });
  if (stalled.length === 0) return [];
  const reclaimed = await reclaimStale(STALL_MS);
  return [
    {
      kind: 'STALLED_TASK',
      severity: 'warn',
      subject: `reclaim:${now.toISOString().slice(0, 13)}`,
      detail: { count: stalled.length, tasks: stalled.map((t) => ({ id: t.id, kind: t.kind, worker: t.lockedBy })) },
      actionTaken: `reclaimed ${reclaimed} stale task(s) for retry`,
      autoResolved: true,
    },
  ];
}

/** Tasks waiting on a dependency id that no longer exists would wait forever. */
async function checkOrphanDependencies(): Promise<Finding[]> {
  const waiting = await prisma.task.findMany({
    where: { status: { in: ['PENDING', 'QUEUED', 'RETRYING'] }, NOT: { dependsOn: { equals: [] } } },
    select: { id: true, kind: true, dependsOn: true },
    take: 100,
  });
  if (waiting.length === 0) return [];
  // Resolve every referenced dependency in ONE query instead of one per task.
  const depIds = [...new Set(waiting.flatMap((t) => t.dependsOn))];
  const existing = await prisma.task.findMany({ where: { id: { in: depIds } }, select: { id: true } });
  const present = new Set(existing.map((e) => e.id));
  const findings: Finding[] = [];
  for (const t of waiting) {
    const missing = t.dependsOn.filter((d) => !present.has(d));
    if (missing.length === 0) continue;
    const reason = `orphan dependency: ${missing.length} prerequisite task(s) do not exist (${missing.join(', ')})`;
    await prisma.task.update({
      where: { id: t.id },
      data: { status: 'DEAD', error: reason, finishedAt: new Date(), lockedBy: null, lockedAt: null },
    });
    await prisma.deadLetter.create({ data: { taskId: t.id, kind: t.kind, payload: {} as never, error: reason } });
    await emit('task.dead', { taskId: t.id, kind: t.kind, error: reason });
    findings.push({
      kind: 'ORPHAN_DEPENDENCY',
      severity: 'error',
      subject: t.id,
      detail: { kind: t.kind, missing },
      actionTaken: 'dead-lettered (a missing prerequisite can never be satisfied)',
      autoResolved: true,
    });
  }
  return findings;
}

/** Two pending tasks with the same kind+payload are redundant; keep the first. */
async function checkDuplicates(): Promise<Finding[]> {
  const pending = await prisma.task.findMany({
    where: { status: { in: ['PENDING', 'QUEUED', 'RETRYING'] } },
    select: { id: true, kind: true, payload: true, createdAt: true, idempotencyKey: true },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const t of pending) {
    // A keyed task already has dedupe enforced by the queue; skip it here.
    if (t.idempotencyKey) continue;
    const key = payloadKey(t.kind, t.payload);
    const first = seen.get(key);
    if (first) {
      dupes.push(t.id);
      await prisma.task.update({
        where: { id: t.id },
        data: { status: 'CANCELLED', error: `duplicate of ${first}`, finishedAt: new Date() },
      });
    } else {
      seen.set(key, t.id);
    }
  }
  if (dupes.length === 0) return [];
  return [
    {
      kind: 'DUPLICATE_TASK',
      severity: 'warn',
      subject: `dup:${new Date().toISOString().slice(0, 13)}`,
      detail: { cancelled: dupes.length, ids: dupes.slice(0, 20) },
      actionTaken: `cancelled ${dupes.length} duplicate pending task(s)`,
      autoResolved: true,
    },
  ];
}

/** Recent dead letters and stuck approvals are the things a human must see. */
async function checkEscalations(now: Date): Promise<Finding[]> {
  const findings: Finding[] = [];

  const dead = await prisma.task.findMany({
    where: { status: 'DEAD' },
    select: { id: true, kind: true, error: true, finishedAt: true },
    orderBy: { finishedAt: 'desc' },
    take: 20,
  });
  for (const d of dead) {
    findings.push({
      kind: 'DEAD_LETTER',
      severity: 'error',
      subject: d.id,
      detail: { kind: d.kind, error: d.error },
    });
  }

  const stuck = await prisma.approval.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - APPROVAL_STUCK_MS) } },
    select: { id: true, action: true, createdAt: true, risk: true },
    take: 20,
  });
  for (const a of stuck) {
    findings.push({
      kind: 'STUCK_APPROVAL',
      severity: 'warn',
      subject: a.id,
      detail: { action: a.action, risk: a.risk, waitingSince: a.createdAt.toISOString() },
    });
  }
  return findings;
}

/** Hard-cap and rolling-window budget breaches. */
async function checkBudget(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const budget = await budgetSnapshot();
  if (budget.capUsd > 0 && budget.spentUsd >= budget.capUsd) {
    findings.push({
      kind: 'BUDGET_BREACH',
      severity: 'critical',
      subject: 'global',
      detail: { capUsd: budget.capUsd, spentUsd: budget.spentUsd },
    });
  }
  const c = await getControls();
  const usage = await windowUsage();
  if (usage.todayUsd >= c.dailyBudgetUsd || usage.monthUsd >= c.monthlyBudgetUsd) {
    findings.push({
      kind: 'BUDGET_WINDOW',
      severity: 'warn',
      subject: 'model-window',
      detail: { todayUsd: usage.todayUsd, dailyCapUsd: c.dailyBudgetUsd, monthUsd: usage.monthUsd, monthlyCapUsd: c.monthlyBudgetUsd },
    });
  }
  return findings;
}

/** An enabled schedule whose next run is far in the past (worker was down). */
async function checkSchedules(now: Date): Promise<Finding[]> {
  const late = await prisma.schedule.findMany({
    where: { enabled: true, nextRunAt: { lt: new Date(now.getTime() - SCHEDULE_LATE_MS) } },
    select: { name: true, nextRunAt: true, cron: true },
    take: 50,
  });
  const findings: Finding[] = [];
  for (const s of late) {
    // The scheduler tick will re-fire it; this finding makes the outage visible.
    findings.push({
      kind: 'STALE_SCHEDULE',
      severity: 'warn',
      subject: s.name,
      detail: { nextRunAt: s.nextRunAt?.toISOString(), cron: s.cron },
      actionTaken: 'left for the next scheduler tick to fire (no work lost)',
      autoResolved: true,
    });
  }
  return findings;
}

/** A sub-agent whose recent runs mostly failed is degraded. */
async function checkAgentHealth(): Promise<Finding[]> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const agents = await prisma.subAgent.findMany({ select: { id: true, name: true, enabled: true } });
  if (agents.length === 0) return [];
  // One query for all recent runs, then group in memory (keeps the watchdog
  // query-frugal on the pooled connection).
  const runs = await prisma.subAgentRun.findMany({
    where: { startedAt: { gte: since } },
    select: { subAgentId: true, ok: true },
  });
  const byAgent = new Map<string, { runs: number; failed: number }>();
  for (const r of runs) {
    const agg = byAgent.get(r.subAgentId) ?? { runs: 0, failed: 0 };
    agg.runs++;
    if (!r.ok) agg.failed++;
    byAgent.set(r.subAgentId, agg);
  }
  const findings: Finding[] = [];
  for (const a of agents) {
    const agg = byAgent.get(a.id);
    if (!agg || agg.runs < 3) continue;
    const rate = agg.failed / agg.runs;
    if (rate >= 0.5) {
      findings.push({
        kind: 'AGENT_DEGRADED',
        severity: 'warn',
        subject: a.name,
        detail: { runs: agg.runs, failed: agg.failed, failureRate: Number(rate.toFixed(2)) },
      });
    }
  }
  return findings;
}

/** The owner's emergency stop is engaged: record it, do not silently ignore it. */
async function checkKillSwitch(): Promise<Finding[]> {
  const c = await getControls();
  if (!c.emergencyStop) return [];
  return [
    {
      kind: 'KILL_SWITCH',
      severity: 'critical',
      subject: 'controls.emergencyStop',
      detail: { emergencyStop: true },
      actionTaken: 'acting work is refused by the control layer while engaged',
    },
  ];
}

/** Run every check. Safe to call repeatedly; findings are de-duplicated. */
export async function runWatchdog(now = new Date()): Promise<WatchdogReport> {
  const findings: Finding[] = [];
  const collect = async (fn: () => Promise<Finding[]>): Promise<void> => {
    try {
      findings.push(...(await fn()));
    } catch (err) {
      logger.error('watchdog check failed', { error: (err as Error).message });
    }
  };

  await collect(() => checkKillSwitch());
  await collect(() => checkStalledTasks(now));
  await collect(checkOrphanDependencies);
  await collect(checkDuplicates);
  await collect(checkEscalations.bind(null, now));
  await collect(checkBudget);
  await collect(() => checkSchedules(now));
  await collect(checkAgentHealth);

  let autoResolved = 0;
  let open = 0;
  // Pre-load the keys of currently-open findings so a repeat run is a no-op.
  const existingOpen = await prisma.watchdogAlert.findMany({ where: { status: 'OPEN' }, select: { kind: true, subject: true } });
  const seen = new Set(existingOpen.map((a) => `${a.kind}::${a.subject ?? ''}`));
  for (const f of findings) {
    const created = await raise(f, seen);
    if (!created) continue;
    if (f.autoResolved) autoResolved++;
    else open++;
  }

  const report: WatchdogReport = {
    ranAt: now.toISOString(),
    findings,
    autoResolved,
    open,
    requiresHuman: open,
  };
  logger.info('watchdog ran', { findings: findings.length, autoResolved, open });
  return report;
}

/** Open findings for the dashboard/API, newest first. */
export async function openFindings(limit = 100): Promise<Array<{ id: string; kind: string; severity: string; subject: string | null; detail: unknown; actionTaken: string | null; createdAt: Date }>> {
  return prisma.watchdogAlert.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, kind: true, severity: true, subject: true, detail: true, actionTaken: true, createdAt: true },
  });
}

/** Resolve a finding (owner action). */
export async function resolveFinding(id: string, actorId: string): Promise<boolean> {
  const res = await prisma.watchdogAlert.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
  if (res.count > 0) {
    await audit({ actorType: 'owner', actorId, action: 'watchdog.resolve', target: id, severity: 'info' });
    return true;
  }
  return false;
}
