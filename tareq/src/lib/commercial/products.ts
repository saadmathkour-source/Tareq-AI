import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { ValidationError } from '../core/errors.ts';

/**
 * Product factory (Phase 16, group 3).
 *
 * The catalog below is the concrete result of the opportunity selection: each
 * entry names a real problem, the deliverable the buyer receives, how it is
 * produced, what the buyer must supply, the honest limits, the QA checks that
 * must pass before delivery, and the price/cost/margin. Only products with
 * `status: 'PUBLISHED'` are offered for sale; the rest are candidates.
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
 * The published product: a source-cited market opportunity report. It is
 * deliverable end-to-end with the research + commercial engines already in the
 * repo, so nothing about it is aspirational.
 */
export const MARKET_OPPORTUNITY_REPORT: ProductDefinition = {
  slug: 'market-opportunity-report',
  name: 'Market Opportunity Report',
  tagline: 'A source-cited read on whether a niche is worth entering — demand signals, white space, and a scored shortlist.',
  problem:
    'Founders and small teams waste weeks (and money) entering niches on gut feel. Public demand signals, competitor gaps and realistic pricing are scattered across forums, wikis and product pages, and nobody has time to assemble them into a decision.',
  solution:
    'We run a structured, automated analysis of your chosen niche using public, citable sources (Hacker News discussion, Wikipedia, public product pages). You receive a written report that states what the public signals actually show, where the white space is, how incumbents appear to price, and a scored shortlist of specific opportunities — with every factual claim tied to a source URL and date.',
  deliverables: [
    'A written Market Opportunity Report (PDF-ready markdown) for your chosen niche.',
    'A demand-signal appendix: each signal with title, source URL, points/comments and date.',
    'A competitor & white-space section derived from public product information.',
    'A pricing benchmark section with the reasoning and its assumptions stated.',
    'A scored opportunity shortlist with the scoring inputs shown.',
    'An explicit "what this report does NOT prove" section.',
  ],
  deliverySteps: [
    'Confirm the niche and any constraints with the buyer.',
    'Collect public demand signals (Hacker News Algolia, Wikipedia) for the niche.',
    'Run the commercial engines (demand interpretation, white-space mapping, economics, risk).',
    'Draft the report with the model, attaching a source URL + date to each factual claim.',
    'Validate the draft against the QA checklist (sources present, no unsupported numbers).',
    'Store the deliverable as a versioned artifact and notify the buyer of its location.',
  ],
  requirements: [
    'The niche or market in one or two sentences.',
    'The buyer segment you care about (optional, improves focus).',
    'Any geography constraint (default: US/UK/CA/AU English-language markets).',
  ],
  limitations: [
    'Based on public, keyless sources only — it is not a paid analyst dataset.',
    'Demand signals measure public discussion, not verified willingness to pay.',
    'Competitor pricing is inferred from public pages and may change without notice.',
    'It is decision support, not financial, legal or investment advice.',
  ],
  qaChecklist: [
    'Every factual market claim has a source URL and a collection date.',
    'No invented statistics: estimates are labelled as estimates with their basis.',
    'The "what this does not prove" section is present and specific.',
    'The report names the niche it was generated for.',
  ],
  priceUsd: 149,
  costUsd: 1.5,
  status: 'PUBLISHED',
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

/** Upsert the catalog into the database. Idempotent. */
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
        status: def.status,
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
