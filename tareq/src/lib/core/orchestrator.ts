import { randomUUID } from 'node:crypto';
import { claimNext, succeed, fail, heartbeat, reclaimStale, type ClaimedTask } from '../queue/tasks.ts';
import { drain } from './events.ts';
import { logger } from './logger.ts';
import { audit } from './audit.ts';
import { TareqError } from './errors.ts';
import { isEmergencyStopped } from '../security/controls.ts';

/**
 * Orchestrator.
 *
 * The worker loop that makes TAREQ run without a browser open. It:
 *  - claims durable tasks from the queue
 *  - dispatches them to registered handlers
 *  - heartbeats long-running work so it is not reclaimed
 *  - records success/failure and lets the queue handle retry/backoff/DLQ
 *  - drains the event bus and reclaims tasks from crashed workers
 *
 * It is intentionally thin: all policy lives in the handlers and the permission
 * engine, so the loop stays easy to reason about and test.
 */

export type TaskHandler = (task: ClaimedTask) => Promise<Record<string, unknown>>;

const handlers = new Map<string, TaskHandler>();

export function registerHandler(kind: string, handler: TaskHandler): void {
  if (handlers.has(kind)) throw new Error(`Handler already registered: ${kind}`);
  handlers.set(kind, handler);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()];
}

/** Run one claim/dispatch cycle. Returns true if a task was processed. */
export async function tick(workerId: string): Promise<boolean> {
  // The owner's emergency stop halts ALL work at the source: no task is claimed
  // or executed until it is cleared. This is the process-wide kill switch, and it
  // fails closed — if the control store cannot be read, `isEmergencyStopped()`
  // returns true and the loop claims nothing.
  if (await isEmergencyStopped()) return false;

  const task = await claimNext(workerId);
  if (!task) return false;

  const handler = handlers.get(task.kind);
  const hb = setInterval(() => {
    void heartbeat(task.id).catch(() => {});
  }, 15_000);

  try {
    if (!handler) {
      // An unknown kind is a programming error, not a transient failure.
      await fail(task.id, `No handler for kind: ${task.kind}`, { retryable: false });
      await audit({ actorType: 'system', action: 'task.no_handler', target: task.kind, severity: 'error' });
      return true;
    }
    const result = await handler(task);
    await succeed(task.id, result);
    logger.info('task succeeded', { taskId: task.id, kind: task.kind, attempt: task.attempts });
  } catch (err) {
    const retryable = err instanceof TareqError ? err.retryable : true;
    await fail(task.id, (err as Error).message, { retryable });
    logger.error('task failed', { taskId: task.id, kind: task.kind, retryable, error: (err as Error).message });
  } finally {
    clearInterval(hb);
  }
  return true;
}

export interface RunOptions {
  workerId?: string;
  /**
   * Stop after this many processed tasks. `0` (the default) means *unlimited* —
   * run until stopped — NOT disabled. A non-zero value is a batch bound (e.g.
   * `TAREQ_WORKER_MAX_TASKS=50` drains up to 50 tasks then exits cleanly).
   */
  maxTasks?: number;
  pollIntervalMs?: number;
  /** Reclaim stale tasks every N ticks. */
  reclaimEvery?: number;
  /**
   * How many tasks this worker runs concurrently. Default 1 (sequential, the
   * long-standing behaviour). Higher values raise throughput; safe because
   * `claimNext` uses `FOR UPDATE SKIP LOCKED`, so no task is ever claimed twice
   * even with many workers or slots.
   */
  concurrency?: number;
  /** Return true to stop the loop gracefully (finishes the in-flight batch). */
  shouldStop?: () => boolean;
}

/**
 * Long-running loop. Resolves when `maxTasks` is reached or `shouldStop()` is true.
 * Graceful: finishes the in-flight batch before returning.
 */
export async function run(opts: RunOptions = {}): Promise<number> {
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
  const reclaimEvery = opts.reclaimEvery ?? 15;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));
  let processed = 0;
  let ticks = 0;

  // Claim and run up to `slots` tasks in parallel. `tick` does both claim and
  // dispatch, so a slot that finds nothing simply resolves false.
  const runBatch = async (slots: number): Promise<number> => {
    const batch: Array<Promise<boolean>> = [];
    for (let i = 0; i < slots; i++) batch.push(tick(workerId));
    const results = await Promise.all(batch);
    return results.filter(Boolean).length;
  };

  logger.info('orchestrator started', { workerId, maxTasks: opts.maxTasks ?? 0, concurrency });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.maxTasks && processed >= opts.maxTasks) break;
    if (opts.shouldStop?.()) break;

    try {
      await drain();
      if (ticks % reclaimEvery === 0) await reclaimStale();
      ticks++;

      let slots = concurrency;
      if (opts.maxTasks) slots = Math.min(slots, opts.maxTasks - processed);
      const did = await runBatch(slots);
      processed += did;
      if (did === 0) await sleep(pollIntervalMs);
    } catch (err) {
      logger.error('orchestrator cycle error', { error: (err as Error).message });
      await sleep(pollIntervalMs);
    }
  }
  logger.info('orchestrator stopped', { workerId, processed });
  return processed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Test helper. */
export function clearHandlers(): void {
  handlers.clear();
}
