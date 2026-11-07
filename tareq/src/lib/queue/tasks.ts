import { prisma } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { emit } from '../core/events.ts';

/**
 * Durable task queue backed by Postgres.
 *
 * Guarantees required by the directive:
 *  - survives process restarts (state lives in the `tasks` table)
 *  - no duplicate execution of the same logical job (idempotencyKey, unique)
 *  - retry with exponential backoff, then dead-letter
 *  - visibility timeout via `lockedAt` + heartbeat so a crashed worker's task
 *    is reclaimed rather than lost
 *  - priority ordering and dependency gating
 *
 * Locking uses `FOR UPDATE SKIP LOCKED`, so many workers can poll concurrently
 * without stepping on each other and without a separate Redis instance.
 */

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export interface EnqueueOptions {
  kind: string;
  payload?: Record<string, unknown>;
  priority?: Priority;
  /** Unique key; a second enqueue with the same key is ignored (dedupe). */
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  dependsOn?: string[];
  estimatedCostUsd?: number;
  parentId?: string;
  opportunityId?: string;
}

export interface ClaimedTask {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Add a task. Returns the id, or the existing id when deduped. */
export async function enqueue(opts: EnqueueOptions): Promise<string> {
  if (opts.idempotencyKey) {
    const existing = await prisma.task.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing.id;
  }
  try {
    const task = await prisma.task.create({
      data: {
        kind: opts.kind,
        payload: (opts.payload ?? {}) as never,
        priority: opts.priority ?? 'NORMAL',
        idempotencyKey: opts.idempotencyKey ?? null,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 3,
        dependsOn: opts.dependsOn ?? [],
        estimatedCostUsd: opts.estimatedCostUsd ?? null,
        parentId: opts.parentId ?? null,
        opportunityId: opts.opportunityId ?? null,
        status: 'PENDING',
      },
    });
    await emit('task.enqueued', { taskId: task.id, kind: task.kind });
    return task.id;
  } catch (err) {
    // Unique violation on idempotencyKey under a race — fetch the winner.
    if ((err as { code?: string }).code === 'P2002' && opts.idempotencyKey) {
      const existing = await prisma.task.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
      if (existing) return existing.id;
    }
    throw err;
  }
}

/** Tasks whose dependencies have all succeeded and whose runAt has passed. */
async function dependenciesSatisfied(dependsOn: string[]): Promise<boolean> {
  if (dependsOn.length === 0) return true;
  const unmet = await prisma.task.count({
    where: { id: { in: dependsOn }, status: { notIn: ['SUCCEEDED'] } },
  });
  return unmet === 0;
}

/**
 * Atomically claim the next runnable task for `workerId`.
 * Skips tasks that are locked and still fresh (visibility timeout = staleAfterMs).
 *
 * Claims exactly ONE row: `FOR UPDATE SKIP LOCKED` with `LIMIT 1` lets many
 * workers poll concurrently, each taking a distinct row, without a worker
 * holding locks on rows it does not return. (An earlier `LIMIT 20` version
 * flipped up to 20 rows to RUNNING but returned only one, leaving the rest
 * stuck as RUNNING until the stale-reclaim swept them.)
 */
export async function claimNext(workerId: string, staleAfterMs = 5 * 60_000): Promise<ClaimedTask | null> {
  const staleBefore = new Date(Date.now() - staleAfterMs);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; kind: string; payload: unknown; attempts: number; max_attempts: number; depends_on: string[] }>
  >(
    `
    WITH candidate AS (
      SELECT t.id
      FROM tareq.tasks t
      WHERE t.status IN ('PENDING', 'QUEUED', 'RETRYING')
        AND t.run_at <= now()
        AND (t.locked_at IS NULL OR t.locked_at < $1)
      ORDER BY
        CASE t.priority
          WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        t.run_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE tareq.tasks t
    SET status = 'RUNNING',
        locked_by = $2,
        locked_at = now(),
        heartbeat_at = now(),
        attempts = t.attempts + 1,
        updated_at = now()
    FROM candidate
    WHERE t.id = candidate.id
    RETURNING t.id, t.kind, t.payload, t.attempts, t.max_attempts, t.depends_on
    `,
    staleBefore,
    workerId,
  );

  for (const row of rows) {
    if (await dependenciesSatisfied(row.depends_on ?? [])) {
      return {
        id: row.id,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
    }
    // Dependencies not ready: release without consuming an attempt.
    await prisma.task.update({
      where: { id: row.id },
      data: { status: 'PENDING', lockedBy: null, lockedAt: null, attempts: { decrement: 1 } },
    });
  }
  return null;
}

/** Prove the worker is alive so the task is not reclaimed mid-run. */
export async function heartbeat(taskId: string): Promise<void> {
  await prisma.task.update({ where: { id: taskId }, data: { heartbeatAt: new Date() } });
}

export async function succeed(taskId: string, result: Record<string, unknown> = {}): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'SUCCEEDED', result: result as never, finishedAt: new Date(), lockedBy: null, lockedAt: null },
  });
  await emit('task.succeeded', { taskId });
}

/** Exponential backoff with jitter; dead-letters once maxAttempts is reached. */
export async function fail(taskId: string, error: string, opts: { retryable?: boolean } = {}): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;

  const canRetry = (opts.retryable ?? true) && task.attempts < task.maxAttempts;
  if (canRetry) {
    const backoffMs = Math.min(60_000, 2 ** task.attempts * 1_000) + Math.floor(Math.random() * 500);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'RETRYING',
        error,
        runAt: new Date(Date.now() + backoffMs),
        lockedBy: null,
        lockedAt: null,
      },
    });
    logger.warn('task scheduled for retry', { taskId, attempt: task.attempts, backoffMs });
  } else {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'DEAD', error, finishedAt: new Date(), lockedBy: null, lockedAt: null },
    });
    await prisma.deadLetter.create({
      data: { taskId, kind: task.kind, payload: task.payload as never, error },
    });
    await emit('task.dead', { taskId, kind: task.kind, error });
    logger.error('task dead-lettered', { taskId, kind: task.kind });
  }
}

/** Mark a task as blocked on an owner decision. */
export async function awaitApproval(taskId: string, approvalId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'WAITING_APPROVAL', lockedBy: null, lockedAt: null, result: { approvalId } as never },
  });
}

export async function cancel(taskId: string, reason = 'cancelled'): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'CANCELLED', error: reason, finishedAt: new Date(), lockedBy: null, lockedAt: null },
  });
}

/** Requeue every task stuck in RUNNING whose heartbeat went stale (crash recovery). */
export async function reclaimStale(staleAfterMs = 5 * 60_000): Promise<number> {
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const res = await prisma.task.updateMany({
    where: { status: 'RUNNING', heartbeatAt: { lt: staleBefore } },
    data: { status: 'RETRYING', lockedBy: null, lockedAt: null, runAt: new Date() },
  });
  if (res.count > 0) logger.warn('reclaimed stale tasks', { count: res.count });
  return res.count;
}

/** Queue depth snapshot for the dashboard and health checks. */
export async function stats(): Promise<Record<string, number>> {
  const grouped = await prisma.task.groupBy({ by: ['status'], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.status] = g._count._all;
  return out;
}

export { PRIORITY_RANK };
