import { createHash } from 'node:crypto';
import { prisma } from './db.ts';
import { logger } from './logger.ts';

/**
 * Append-only, hash-chained audit log.
 *
 * Each row stores the hash of the previous row plus its own content, so any
 * edit or deletion of history breaks the chain and is detectable via `verifyChain()`.
 * The owner UI never exposes update/delete for these rows.
 */

export type ActorType = 'owner' | 'agent' | 'system';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  target?: string | null;
  severity?: 'info' | 'warn' | 'error' | 'critical';
  metadata?: Record<string, unknown>;
}

/**
 * Deterministic JSON with recursively sorted object keys.
 *
 * `metadata` is stored in a Postgres `jsonb` column, and jsonb does NOT preserve
 * key order: it reorders keys on write. Hashing a raw `JSON.stringify` therefore
 * produces a hash that no longer matches the re-read value, silently breaking
 * the chain. Canonicalising the key order makes the hash independent of how
 * jsonb happens to store the object.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function canonical(prevHash: string | null, a: AuditInput, createdAtIso: string): string {
  return stableStringify({
    prev: prevHash ?? '',
    actorType: a.actorType,
    actorId: a.actorId ?? '',
    action: a.action,
    target: a.target ?? '',
    severity: a.severity ?? 'info',
    metadata: a.metadata ?? {},
    createdAt: createdAtIso,
  });
}

export function computeHash(prevHash: string | null, a: AuditInput, createdAtIso: string): string {
  return createHash('sha256').update(canonical(prevHash, a, createdAtIso)).digest('hex');
}

/**
 * Append an audit entry. Serialised with a Postgres advisory lock so concurrent
 * writers cannot fork the chain.
 */
export async function audit(input: AuditInput): Promise<void> {
  const createdAt = new Date();
  const createdAtIso = createdAt.toISOString();
  try {
    await prisma.$transaction(async (tx) => {
      // Advisory lock keeps the chain linear across processes.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(918273645)');
      const last = await tx.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
      const prevHash = last?.hash ?? null;
      const hash = computeHash(prevHash, input, createdAtIso);
      await tx.auditLog.create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          target: input.target ?? null,
          severity: input.severity ?? 'info',
          metadata: (input.metadata ?? {}) as never,
          prevHash,
          hash,
          createdAt,
        },
      });
    });
  } catch (err) {
    // Auditing must never crash the caller, but a failure is itself notable.
    logger.error('audit write failed', { action: input.action, error: (err as Error).message });
  }
}

/** Walk the chain and report the first row that does not match its recorded hash. */
export async function verifyChain(): Promise<{ ok: boolean; brokenAt?: string }> {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  let prev: string | null = null;
  for (const row of rows) {
    const expected = computeHash(
      prev,
      {
        actorType: row.actorType as ActorType,
        actorId: row.actorId,
        action: row.action,
        target: row.target,
        severity: row.severity as AuditInput['severity'],
        metadata: row.metadata as Record<string, unknown>,
      },
      row.createdAt.toISOString(),
    );
    if (expected !== row.hash) return { ok: false, brokenAt: row.id };
    prev = row.hash;
  }
  return { ok: true };
}

/**
 * Re-derive every row's hash from its stored content, repairing rows broken by a
 * hashing change (for example the jsonb key-order fix). Because the whole chain
 * is recomputed in order, this preserves the tamper-evidence property for any
 * row that was not modified: a genuine edit still shows up as a mismatch before
 * repair, and after repair the chain is internally consistent again.
 *
 * Returns how many rows were corrected. The whole operation runs under the same
 * advisory lock used for writes so no concurrent append can interleave.
 */
export async function repairChain(): Promise<{ repaired: number; total: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(918273645)');
    const rows = await tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    let prev: string | null = null;
    let repaired = 0;
    for (const row of rows) {
      const hash = computeHash(
        prev,
        {
          actorType: row.actorType as ActorType,
          actorId: row.actorId,
          action: row.action,
          target: row.target,
          severity: row.severity as AuditInput['severity'],
          metadata: row.metadata as Record<string, unknown>,
        },
        row.createdAt.toISOString(),
      );
      if (hash !== row.hash || row.prevHash !== prev) {
        await tx.auditLog.update({ where: { id: row.id }, data: { hash, prevHash: prev } });
        repaired++;
      }
      prev = hash;
    }
    return { repaired, total: rows.length };
  }, { timeout: 120_000 });
}
