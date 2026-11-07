import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for TAREQ's own schema. Kept in a module-level singleton
 * so hot-reload and multiple imports share one connection pool.
 */
declare global {
  // eslint-disable-next-line no-var
  var __tareqPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__tareqPrisma ??
  new PrismaClient({
    log: process.env.TAREQ_PRISMA_LOG === '1' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalThis.__tareqPrisma = prisma;

export type Db = PrismaClient;
