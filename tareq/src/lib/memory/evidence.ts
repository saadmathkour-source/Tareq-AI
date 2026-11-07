import { prisma } from '../core/db.ts';

/**
 * Pre-Sale Evidence Vault (group 66) and the claim gate it enforces.
 *
 * Every factual statement that could reach a customer must be backed by a
 * `Claim` with a source, a verification date and a validity window. `assertPublishable()`
 * is the single gate that stops an unsupported promise from being published.
 * `refreshStale()` implements the freshness policy of group 95.
 */

export interface ClaimInput {
  statement: string;
  source: string;
  sourceUrl?: string;
  confidence?: number;
  supporting?: unknown[];
  contradicting?: unknown[];
  validUntil?: Date;
  publishable?: boolean;
}

export async function recordClaim(input: ClaimInput): Promise<string> {
  const row = await prisma.claim.create({
    data: {
      statement: input.statement,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      confidence: input.confidence ?? 0.5,
      supporting: (input.supporting ?? []) as never,
      contradicting: (input.contradicting ?? []) as never,
      validUntil: input.validUntil ?? null,
      publishable: input.publishable ?? false,
      verifiedAt: input.publishable ? new Date() : null,
    },
  });
  return row.id;
}

/** Only claims that are publishable, verified and unexpired may be used externally. */
export async function isPublishable(claimId: string): Promise<boolean> {
  const c = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!c) return false;
  if (!c.publishable || !c.verifiedAt) return false;
  if (c.validUntil && c.validUntil.getTime() < Date.now()) return false;
  return true;
}

export class UnsupportedClaimError extends Error {
  readonly claimIds: string[];
  constructor(claimIds: string[]) {
    super(`Refusing to publish: ${claimIds.length} claim(s) are unverified, unpublished or expired [${claimIds.join(', ')}]`);
    this.name = 'UnsupportedClaimError';
    this.claimIds = claimIds;
  }
}

/**
 * Gate an outgoing offer. Throws unless every referenced claim is publishable.
 * This is what makes "no unsupported promises" a mechanism rather than a rule.
 */
export async function assertPublishable(claimIds: string[]): Promise<void> {
  const bad: string[] = [];
  for (const id of claimIds) if (!(await isPublishable(id))) bad.push(id);
  if (bad.length > 0) throw new UnsupportedClaimError(bad);
}

/** Claims whose validity has lapsed and must be re-verified before reuse. */
export async function staleClaims(): Promise<Array<{ id: string; statement: string; source: string }>> {
  const rows = await prisma.claim.findMany({
    where: { validUntil: { lt: new Date() } },
    select: { id: true, statement: true, source: true },
  });
  return rows;
}

export async function verifyClaim(claimId: string): Promise<void> {
  await prisma.claim.update({ where: { id: claimId }, data: { verifiedAt: new Date() } });
}
