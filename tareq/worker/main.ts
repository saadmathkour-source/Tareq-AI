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

  const maxTasks = process.env.TAREQ_WORKER_MAX_TASKS ? Number(process.env.TAREQ_WORKER_MAX_TASKS) : 0;
  await run({ maxTasks, pollIntervalMs: 2_000 });
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('worker crashed', { error: (err as Error).message });
  process.exit(1);
});
