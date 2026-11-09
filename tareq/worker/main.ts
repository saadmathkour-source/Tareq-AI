/**
 * TAREQ worker entrypoint.
 *
 * Runs the durable task loop in its own process. Use this when you want the
 * queue worked separately from the API (e.g. a dedicated Railway worker
 * service). If you only run one service, the API can host the loop instead via
 * TAREQ_EMBEDDED_WORKER=1. Start with:
 *   npm run worker
 */
import { run } from '../src/lib/core/orchestrator.ts';
import { bootstrapWorker } from '../src/lib/core/worker-boot.ts';
import { env } from '../src/lib/env.ts';
import { logger } from '../src/lib/core/logger.ts';
import { prisma } from '../src/lib/core/db.ts';

async function main(): Promise<void> {
  env();
  await bootstrapWorker();

  // maxTasks 0 = unlimited (run forever). A positive value drains a bounded
  // batch then exits — useful for one-shot backfills, never a "disable".
  const maxTasks = process.env.TAREQ_WORKER_MAX_TASKS ? Number(process.env.TAREQ_WORKER_MAX_TASKS) : 0;
  // Concurrent task slots per worker. Default 1 (sequential). Safe to raise:
  // claims use FOR UPDATE SKIP LOCKED, so tasks are never executed twice.
  const concurrency = process.env.TAREQ_WORKER_CONCURRENCY ? Number(process.env.TAREQ_WORKER_CONCURRENCY) : 1;

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('worker stop requested', { signal });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info('worker config', { maxTasks, concurrency });
  await run({ maxTasks, concurrency, pollIntervalMs: 2_000, shouldStop: () => stopping });
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('worker crashed', { error: (err as Error).message });
  process.exit(1);
});
