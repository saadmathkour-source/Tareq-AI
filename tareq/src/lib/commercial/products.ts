import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { ValidationError } from '../core/errors.ts';
import { authorize } from '../security/permissions.ts';
import { assertPublishingAllowed, assertNotStopped } from '../security/controls.ts';

/**
 * Product factory (Phase 16, group 3).
 *
 * The catalog below is the concrete result of the opportunity selection: each
 * entry names a real problem, the deliverable the buyer receives, how it is
 * produced, what the buyer must supply, the honest limits, the QA checks that
 * must pass before delivery, and the price/cost/margin.
 *
 * Catalog rows are DESIGN DATA only. `seedProducts()` always writes them as
 * `DRAFT`, so seeding the catalog can never put a product up for sale — a
 * product only reaches `PUBLISHED` through `publishProduct()`, which enforces the
 * owner's `publishingAllowed` control AND the `offer.publish` approval. Only a
 * `PUBLISHED` product is offered for sale; the rest are candidates.
 *
 * Numbers are estimates at design time; realised costs are recorded in the
 * ledger (AI_COST / DELIVERY_COST) and verified revenue only ever comes from a
 * signature-verified Stripe webhook.
 */

export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';

export interface ProductDefinition {
  slug: string;
  name: string;
  tagline: string;
  problem: string;
  solution: string;
  deliverables: string[];
  deliverySteps: string[];
  requirements: string[];
  limitations: string[];
  qaChecklist: string[];
  priceUsd: number;
  costUsd: number;
  status: ProductStatus;
  claimRefs?: string[];
}

/**
 * The current product: a public-demand signal report. `status` here mirrors the catalog
 * seed intent (DRAFT): `seedProducts()` never publishes, so this product is
 * created as a draft and only goes live through the gated `publishProduct()`.
 */
export const MARKET_OPPORTUNITY_REPORT: ProductDefinition = {
  slug: 'market-opportunity-report',
  name: 'Market Opportunity Report',
  tagline: 'A source-linked snapshot of public discussion signals for one market or niche.',
  problem:
    'Founders need a quick, sourced view of what people are publicly discussing before deciding what to research next.',
  solution:
    'We scan public Hacker News discussions and include a Wikipedia background entry when one is available for the requested topic. The report returns observed discussion counts, a transparent signal score, source links, a short summary, and a clearly labelled draft offer. This is an initial desk-research snapshot, not full market validation.',
  deliverables: [
    'A downloadable structured report for one requested market or niche.',
    'A short summary and Hacker News discussion counts, recency, average engagement, and conservative confidence estimate.',
    'Up to 25 available source titles, URLs, engagement counts, and source dates when provided.',
    'A 0–100 discussion-signal score with its weights and limitations.',
    'A draft offer and an explicit list of what the available evidence does not prove.',
  ],
  deliverySteps: [
    'Use the topic supplied at checkout to query the configured public sources.',
    'Calculate the published discussion-signal score from source volume, recency, and engagement.',
    'Generate a short summary and draft offer from the collected data.',
    'Check that the report names the topic, includes valid source links, and labels estimates and limitations.',
    'Store the report as a downloadable order artifact and email its private link to the buyer.',
  ],
  requirements: [
    'The niche or market in one or two sentences.',
    'The buyer segment you care about (optional, improves focus).',
    'Any geography constraint (default: US/UK/CA/AU English-language markets).',
  ],
  limitations: [
    'The current report uses public discussion signals from Hacker News and Wikipedia; it is not comprehensive market research.',
    'Public discussion is a weak proxy and does not establish customer demand or willingness to pay.',
    'It does not include competitor analysis, market sizing, verified pricing benchmarks, or customer interviews.',
    'The value-leak figures are illustrative defaults, not measured for your business.',
    'It is decision support, not financial, legal or investment advice.',
  ],
  qaChecklist: [
    'Report names the requested topic.',
    'Every listed public signal has a title and a valid HTTP(S) source URL.',
    'Report states that discussion is not proof of willingness to pay.',
    'Report labels the default value-leak assumptions as illustrative.',
  ],
  priceUsd: 149,
  costUsd: 1.5,
  status: 'DRAFT',
  claimRefs: [],
};

/** Candidate products — designed but intentionally not published yet. */
export const CANDIDATE_PRODUCTS: ProductDefinition[] = [
  {
    slug: 'competitor-white-space-scan',
    name: 'Competitor & White-Space Scan',
    tagline: 'Where your competitors are weak, from public information only.',
    problem: 'Teams copy competitors without knowing which gaps are actually underserved.',
    solution:
      'A focused scan of public competitor positioning and pricing that maps the white space you could own, with sources.',
    deliverables: ['White-space map', 'Competitor positioning table', 'Recommended wedge'],
    deliverySteps: ['Collect public competitor pages', 'Run white-space engine', 'Draft + validate report'],
    requirements: ['Your market', 'Two to five competitor names (optional)'],
    limitations: ['Public information only', 'Not a legal competitive review'],
    qaChecklist: ['Every competitor claim cites a public URL', 'No invented pricing'],
    priceUsd: 199,
    costUsd: 1.8,
    status: 'DRAFT',
  },
  {
    slug: 'qualified-lead-research-pack',
    name: 'Qualified Lead Research Pack',
    tagline: 'A short list of real, publicly-identifiable prospects for your offer.',
    problem: 'Outbound lists are full of unqualified, non-compliant contacts.',
    solution:
      'We assemble a small set of prospects from public sources, score their fit, and state the lawful basis for each — no purchased databases.',
    deliverables: ['Scored prospect list with public source URLs', 'Fit reasoning per prospect', 'Suggested first-touch angle'],
    deliverySteps: ['Define ICP', 'Discover public candidates', 'Score + qualify', 'Draft outreach angles'],
    requirements: ['Your ICP', 'Your offer in one sentence'],
    limitations: ['Public sources only', 'No guaranteed response rate', 'You remain responsible for lawful outreach'],
    qaChecklist: ['Each prospect has a public source URL', 'No fabricated contacts'],
    priceUsd: 99,
    costUsd: 1.2,
    status: 'DRAFT',
  },
];

export const CATALOG: ProductDefinition[] = [MARKET_OPPORTUNITY_REPORT, ...CANDIDATE_PRODUCTS];

function marginPct(priceUsd: number, costUsd: number): number {
  if (priceUsd <= 0) return 0;
  return Math.round(((priceUsd - costUsd) / priceUsd) * 100);
}

/**
 * Upsert the catalog into the database. Idempotent.
 *
 * Every product is written as `DRAFT`. Seeding is a *content* operation, never a
 * publishing one: it must not be able to put a product on sale, whether it runs
 * from the owner route, the bootstrap script, or the scheduled
 * `product.seed_catalog` task. Publishing is a separate, owner-gated step
 * (`publishProduct`). The upsert never clobbers a live status the owner set.
 */
export async function seedProducts(): Promise<number> {
  let n = 0;
  for (const def of CATALOG) {
    await prisma.product.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        name: def.name,
        tagline: def.tagline,
        problem: def.problem,
        solution: def.solution,
        deliverables: def.deliverables as never,
        deliverySteps: def.deliverySteps as never,
        requirements: def.requirements as never,
        limitations: def.limitations as never,
        qaChecklist: def.qaChecklist as never,
        priceUsd: def.priceUsd,
        costUsd: def.costUsd,
        marginPct: marginPct(def.priceUsd, def.costUsd),
        // Always DRAFT: seeding must never publish (see the doc comment above).
        status: 'DRAFT',
        claimRefs: (def.claimRefs ?? []) as never,
      },
      // Never clobber a live price/status set by the owner; only refresh copy.
      update: {
        name: def.name,
        tagline: def.tagline,
        problem: def.problem,
        solution: def.solution,
        deliverables: def.deliverables as never,
        deliverySteps: def.deliverySteps as never,
        requirements: def.requirements as never,
        limitations: def.limitations as never,
        qaChecklist: def.qaChecklist as never,
      },
    });
    n++;
  }
  await audit({ actorType: 'system', action: 'products.seeded', metadata: { count: n } });
  return n;
}

/**
 * The single authorised path from DRAFT to PUBLISHED.
 *
 * Publishing puts a product up for sale for real money, so it is gated on BOTH:
 *   1. the owner's `publishingAllowed` control (off by default), and
 *   2. the `offer.publish` approval — a sensitive action that only an owner can
 *      approve. An autonomous caller (the agent or a scheduled task) that has no
 *      approved `offer.publish` approval is refused, not silently allowed.
 *
 * The outcome (allowed or refused) is written to the append-only audit log with
 * the actor, the product id and the result, so the decision is always traceable.
 */
export async function publishProduct(
  slug: string,
  actor: { actorType: 'owner' | 'agent' | 'system'; actorId?: string; approvalId?: string },
): Promise<void> {
  const product = await prisma.product.findUnique({ where: { slug } });
  if (!product) throw new ValidationError(`Product not found: ${slug}`);

  const base = { slug, productId: product.id, actorType: actor.actorType, actorId: actor.actorId ?? null };

  // 1. Emergency stop halts all acting work, publishing included.
  try {
    await assertNotStopped();
  } catch (err) {
    await audit({ actorType: actor.actorType, actorId: actor.actorId, action: 'product.publish_refused', target: product.id, severity: 'warn', metadata: { ...base, reason: (err as Error).message } });
    throw err;
  }

  // 2. The owner's publishing control must be ON. Off (the default) => refused.
  try {
    await assertPublishingAllowed();
  } catch (err) {
    await audit({ actorType: actor.actorType, actorId: actor.actorId, action: 'product.publish_refused', target: product.id, severity: 'warn', metadata: { ...base, reason: (err as Error).message } });
    throw err;
  }

  // 3. Authorisation/approval: `offer.publish` always requires an owner approval.
  //    The owner passes through; an agent without an approved approval is refused
  //    (authorize() raises ApprovalRequiredError and creates a pending request).
  try {
    await authorize({ action: 'offer.publish', actorType: actor.actorType, actorId: actor.actorId, approvalId: actor.approvalId, reason: `Publish product ${slug}` });
  } catch (err) {
    await audit({ actorType: actor.actorType, actorId: actor.actorId, action: 'product.publish_refused', target: product.id, severity: 'warn', metadata: { ...base, reason: (err as Error).message } });
    throw err;
  }

  // 4. Authorised: make it live. `updateMany` with a status guard keeps the write
  //    honest even if the row changed since we read it.
  await prisma.product.updateMany({ where: { id: product.id, status: { not: 'ARCHIVED' } }, data: { status: 'PUBLISHED' } });
  await audit({ actorType: actor.actorType, actorId: actor.actorId, action: 'product.published', target: product.id, severity: 'warn', metadata: { ...base, result: 'PUBLISHED' } });
}

export async function getProduct(slug: string) {
  return prisma.product.findUnique({ where: { slug } });
}

export async function getPublishedProduct(slug: string) {
  const p = await prisma.product.findUnique({ where: { slug } });
  if (!p || p.status !== 'PUBLISHED') return null;
  return p;
}

export async function listProducts(onlyPublished = false) {
  return prisma.product.findMany({
    where: onlyPublished ? { status: 'PUBLISHED' } : {},
    orderBy: { createdAt: 'asc' },
  });
}

export function requirePublished<T extends { status: string } | null>(p: T, slug: string): NonNullable<T> {
  if (!p || p.status !== 'PUBLISHED') throw new ValidationError(`Product not available: ${slug}`);
  return p as NonNullable<T>;
}
