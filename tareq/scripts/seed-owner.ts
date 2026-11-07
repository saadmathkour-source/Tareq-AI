/**
 * Create the primary owner from environment variables.
 * Run once after `prisma db push`. Refuses to run if an owner already exists.
 */
import { env } from '../src/lib/env.ts';
import { createPrimaryOwner } from '../src/lib/security/owner-auth.ts';
import { prisma } from '../src/lib/core/db.ts';
import { logger } from '../src/lib/core/logger.ts';

async function main(): Promise<void> {
  const e = env();
  const email = e.TAREQ_OWNER_EMAIL;
  const password = e.TAREQ_OWNER_PASSWORD;
  if (!email || !password) {
    logger.error('TAREQ_OWNER_EMAIL and TAREQ_OWNER_PASSWORD must be set');
    process.exit(1);
  }
  const owner = await createPrimaryOwner(email, password);
  logger.info('owner created', { id: owner.id, email: owner.email });
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('seed-owner failed', { error: (err as Error).message });
  process.exit(1);
});
