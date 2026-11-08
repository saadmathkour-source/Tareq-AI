/**
 * Worker bootstrap.
 *
 * Shared by the dedicated worker process and the API's embedded worker so both
 * bring TAREQ to the same state: budget, schedules, built-in tools and every
 * task handler registered, then a scheduler tick. Idempotent.
 */
import { logger } from './logger.ts';
import { ensureBudget } from '../security/budget.ts';
import { seedSchedules, tickScheduler } from '../queue/scheduler.ts';
import { registerBuiltinTools } from '../tools/index.ts';
import { registerAllHandlers } from './handlers.ts';
import { registeredKinds } from './orchestrator.ts';

export async function bootstrapWorker(): Promise<number> {
  await ensureBudget();
  await seedSchedules();
  registerBuiltinTools();
  registerAllHandlers();
  const kinds = registeredKinds().length;
  logger.info('worker ready', { handlers: kinds });
  await tickScheduler();
  return kinds;
}
