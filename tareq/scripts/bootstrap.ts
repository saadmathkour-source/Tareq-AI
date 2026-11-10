/**
 * Bootstrap TAREQ after `prisma db push`:
 *   1. ensure the budget row exists
 *   2. seed the fifteen sub-agent roles
 *   3. seed the default schedules
 *   4. set the operating mode to OBSERVE (safe default)
 *   5. create the primary owner if the env provides credentials and none exists
 *
 * Idempotent: safe to run repeatedly.
 */
import { env } from '../src/lib/env.ts';
import { prisma } from '../src/lib/core/db.ts';
import { logger } from '../src/lib/core/logger.ts';
import { ensureBudget } from '../src/lib/security/budget.ts';
import { seedSubAgents } from '../src/lib/core/subagents.ts';
import { seedSchedules } from '../src/lib/queue/scheduler.ts';
import { createPrimaryOwner } from '../src/lib/security/owner-auth.ts';
import { ensureControls } from '../src/lib/security/controls.ts';
import { audit } from '../src/lib/core/audit.ts';
import { seedProducts } from '../src/lib/commercial/products.ts';
import { generateAllLandings } from '../src/lib/commercial/landing.ts';

async function main(): Promise<void> {
  const e = env();

  await ensureBudget();
  const agents = await seedSubAgents();
  const schedules = await seedSchedules();
  await ensureControls();
  const products = await seedProducts();
  const landings = await generateAllLandings();

  await prisma.setting.upsert({
    where: { key: 'operating_mode' },
    create: { key: 'operating_mode', value: { mode: 'OBSERVE' } as never },
    update: {},
  });

  let ownerCreated = false;
  if (e.TAREQ_OWNER_EMAIL && e.TAREQ_OWNER_PASSWORD) {
    const existing = await prisma.owner.count();
    if (existing === 0) {
      await createPrimaryOwner(e.TAREQ_OWNER_EMAIL, e.TAREQ_OWNER_PASSWORD);
      ownerCreated = true;
    }
  }

  await audit({ actorType: 'system', action: 'bootstrap', metadata: { agents, schedules, ownerCreated, products, landings } });
  logger.info('bootstrap complete', { agents, schedules, ownerCreated, products, landings, mode: 'OBSERVE' });
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('bootstrap failed', { error: (err as Error).message });
  process.exit(1);
});
