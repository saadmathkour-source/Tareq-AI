import { prisma } from '../core/db.ts';

/**
 * Memory layer.
 *
 * Every record carries provenance (`source`, `epistemic`, `confidence`) so the
 * agent can always distinguish a verified fact from an estimate or hypothesis.
 * `epistemic` is enforced, not advisory: capabilities that need proof query
 * only `fact` records.
 */

export type MemoryKind =
  | 'WORKING'
  | 'LONG_TERM'
  | 'CUSTOMER'
  | 'DEAL'
  | 'MARKET_EVIDENCE'
  | 'EXPERIMENT'
  | 'STRATEGY'
  | 'FAILURE'
  | 'OWNER_PREFERENCE';

export type Epistemic = 'fact' | 'estimate' | 'hypothesis';

export interface RememberInput {
  kind: MemoryKind;
  key: string;
  content: string;
  scope?: string;
  source?: string;
  sourceUrl?: string;
  epistemic?: Epistemic;
  confidence?: number;
  expiresAt?: Date;
  ownerId?: string;
}

export async function remember(input: RememberInput): Promise<string> {
  const row = await prisma.memoryRecord.upsert({
    where: { kind_scope_key: { kind: input.kind, scope: input.scope ?? 'global', key: input.key } },
    create: {
      kind: input.kind,
      scope: input.scope ?? 'global',
      key: input.key,
      content: input.content,
      source: input.source ?? 'system',
      sourceUrl: input.sourceUrl ?? null,
      epistemic: input.epistemic ?? 'fact',
      confidence: input.confidence ?? 0.5,
      expiresAt: input.expiresAt ?? null,
      ownerId: input.ownerId ?? null,
    },
    update: {
      content: input.content,
      source: input.source ?? 'system',
      sourceUrl: input.sourceUrl ?? null,
      epistemic: input.epistemic ?? 'fact',
      confidence: input.confidence ?? 0.5,
      expiresAt: input.expiresAt ?? null,
      updatedAt: new Date(),
    },
  });
  return row.id;
}

export async function recall(kind: MemoryKind, key: string, scope = 'global'): Promise<string | null> {
  const row = await prisma.memoryRecord.findUnique({
    where: { kind_scope_key: { kind, scope, key } },
  });
  if (!row) return null;
  // Expired evidence is treated as absent so it cannot silently influence decisions.
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row.content;
}

export async function search(kind: MemoryKind, contains: string, limit = 20) {
  return prisma.memoryRecord.findMany({
    where: { kind, content: { contains, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}

/** Facts only — used where an unsupported claim would be unacceptable. */
export async function factsFor(kind: MemoryKind, contains: string) {
  return prisma.memoryRecord.findMany({
    where: { kind, epistemic: 'fact', content: { contains, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
  });
}

/** Purge expired evidence. Called by the scheduler (group 95 freshness). */
export async function pruneExpired(): Promise<number> {
  const res = await prisma.memoryRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}

/** Owner preferences are a dedicated kind so the agent can honour them consistently. */
export async function setPreference(key: string, value: string): Promise<void> {
  await remember({ kind: 'OWNER_PREFERENCE', key, content: value, source: 'owner', epistemic: 'fact', confidence: 1 });
}

export async function getPreference(key: string): Promise<string | null> {
  return recall('OWNER_PREFERENCE', key);
}
