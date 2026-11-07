import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for TAREQ's own schema. Kept as a module-level singleton
 * so hot-reload and multiple imports share one connection pool.
 */

const CONNECTION_LIMIT_FLOOR = 10;
const DEFAULT_POOL_TIMEOUT = 20;

/**
 * Raise an undersized connection pool.
 *
 * The owner dashboard issues ~13 parallel reads on load (`Promise.all` in
 * dashboard.html). With `connection_limit=1` — a common Supabase template
 * value — twelve of those wait on the single connection and die with
 * "Timed out fetching a new connection from the connection pool", which the
 * UI reports as a failed sign-in. A larger configured limit is never lowered.
 */
export function tuneConnectionUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const floor = Number(process.env.TAREQ_DB_CONNECTION_LIMIT ?? CONNECTION_LIMIT_FLOOR) || CONNECTION_LIMIT_FLOOR;
    const current = Number(u.searchParams.get('connection_limit') ?? '0');
    if (!current || current < floor) u.searchParams.set('connection_limit', String(floor));
    if (!u.searchParams.get('pool_timeout')) u.searchParams.set('pool_timeout', String(DEFAULT_POOL_TIMEOUT));
    return u.toString();
  } catch {
    return raw;
  }
}

const dbUrl = tuneConnectionUrl(process.env.DATABASE_URL);

declare global {
  // eslint-disable-next-line no-var
  var __tareqPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__tareqPrisma ??
  new PrismaClient({
    log: process.env.TAREQ_PRISMA_LOG === '1' ? ['warn', 'error'] : ['error'],
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
  });

if (process.env.NODE_ENV !== 'production') globalThis.__tareqPrisma = prisma;

export type Db = PrismaClient;
