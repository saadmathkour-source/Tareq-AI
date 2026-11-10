import { randomBytes } from 'node:crypto';
import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';
import { ValidationError } from '../core/errors.ts';
import { think } from '../providers/router.ts';
import { scanDemand } from '../integrations/publicdata.ts';
import { assertContentPublishingAllowed, assertNotStopped } from '../security/controls.ts';

/**
 * Organic publishing engine (Phase 19).
 *
 * TAREQ's own website is a channel the owner already controls, so it is the one
 * acquisition channel that can be connected with zero additional budget and no
 * new account. This module drafts original, evidence-based articles from real
 * public signals and publishes them to `/insights`.
 *
 * Honesty rules, enforced in code:
 *  - an article is only PUBLISHED when it has a title, a summary and at least
 *    one traceable public source URL;
 *  - the model drafts prose from measured signals only and is told not to invent
 *    statistics, customers or claims; if it is unavailable the article still
 *    ships with the deterministic, source-cited content;
 *  - publishing is gated by the owner's `contentPublishingAllowed` control and
 *    the emergency stop, and every transition is audited.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface ArticleSource {
  title: string;
  url: string;
  points?: number | null;
  comments?: number | null;
  createdAt?: string | null;
}

export interface DraftArticleInput {
  topic: string;
  /** Optional product this article should invite the reader to request. */
  productSlug?: string | null;
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'market-insight';
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? root : `${root}-${randomBytes(2).toString('hex')}`;
    const existing = await prisma.article.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  return `${root}-${randomBytes(4).toString('hex')}`;
}

function renderBody(title: string, topic: string, narrative: string, sources: ArticleSource[], demand: { volume: number; recentCount: number; avgPoints: number } | null, productSlug?: string | null): string {
  const signalBlock = demand
    ? `<h2>What the public signals show</h2>
<p>Across public discussion sources we found <strong>${demand.volume}</strong> item(s) mentioning this market, <strong>${demand.recentCount}</strong> of them in the last year, with an average engagement of <strong>${demand.avgPoints.toFixed(1)}</strong> points. This measures public interest only — it is not a willingness-to-pay estimate.</p>`
    : `<h2>What the public signals show</h2><p>No public-signal count is available for this topic at the time of writing. Treat any demand claim without a source as unproven.</p>`;

  const sourceList = sources.length
    ? `<h2>Sources</h2><ul>${sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title)}</a></li>`).join('')}</ul>`
    : '';

  const cta = productSlug
    ? `<h2>Want the full analysis?</h2><p>If this is your market, we offer a fixed-scope, source-cited research report. <a href="/buy/${esc(productSlug)}">See the report</a> or <a href="/contact">ask a question</a> first.</p>`
    : `<h2>Ask us</h2><p>Have a question about this market? <a href="/contact">Send us a question</a> and we will answer from verified data.</p>`;

  return `<h1>${esc(title)}</h1>
<p class="muted">An evidence-first guide. Every factual figure below is tied to a public source; estimates are labelled.</p>
${narrative ? `<div class="prose">${narrative}</div>` : ''}
${signalBlock}
<h2>How to judge demand honestly</h2>
<ol>
<li>Count real discussions, not opinions — a forum thread with replies is a stronger signal than a headline.</li>
<li>Separate interest from willingness to pay: interest is cheap, a purchase is evidence.</li>
<li>Look for recurring complaints you can remove with a narrow, deliverable scope.</li>
<li>Reject markets where you cannot name a specific buyer and a specific cost they already pay.</li>
</ol>
${sourceList}
${cta}
<p class="muted">This article is automated decision support from public sources. It is not financial, legal or investment advice, and no outcome is guaranteed.</p>`;
}

/**
 * Draft an article from real public signals. Never publishes; the row starts as
 * DRAFT. Returns the created article's id and slug.
 */
export async function draftArticle(input: DraftArticleInput): Promise<{ id: string; slug: string }> {
  const topic = input.topic.trim();
  if (topic.length < 3) throw new ValidationError('topic is too short to research');

  const demand = await scanDemand(topic).catch((err) => {
    logger.warn('article demand scan failed; drafting without signal counts', { error: (err as Error).message });
    return null;
  });
  const sources: ArticleSource[] = (demand?.signals ?? []).slice(0, 12).map((s) => ({
    title: s.title,
    url: s.url,
    points: s.points,
    comments: s.comments,
    createdAt: s.createdAt,
  }));

  const signalLine = demand
    ? `${demand.volume} public discussion(s), ${demand.recentCount} in the last year, average engagement ${demand.avgPoints.toFixed(1)}.`
    : 'no public-signal count was available';

  let narrative = '';
  try {
    const res = await think({
      purpose: 'content.article_draft',
      system:
        'You write honest, genuinely useful educational prose for a business audience. Use ONLY the data provided. Do not invent statistics, customers, competitors, quotes or outcomes. Do not promise results. Write 3 short paragraphs in plain English.',
      messages: [
        {
          role: 'user',
          content: `Topic: ${topic}. Measured public signals: ${signalLine}. Explain, practically, how a reader should evaluate this market and what would make it a good or bad opportunity. Do not fabricate any number.`,
        },
      ],
      maxTokens: 600,
    });
    narrative = res.content.trim().replace(/<[^>]+>/g, '');
  } catch (err) {
    logger.warn('article narrative draft failed; shipping deterministic content only', { error: (err as Error).message });
  }

  const title = `Evaluating the "${topic}" market, evidence-first`;
  const summary = `A short, source-cited guide to judging real demand for ${topic}, with the public signals we measured and the questions that separate interest from a paying customer.`;
  const bodyHtml = renderBody(title, topic, narrative, sources, demand, input.productSlug ?? null);
  const slug = await uniqueSlug(slugify(topic));

  const row = await prisma.article.create({
    data: { slug, title, summary, bodyHtml, sources: sources as never, topic, status: 'DRAFT' },
  });
  await audit({ actorType: 'agent', action: 'content.article_drafted', target: row.id, metadata: { topic, sources: sources.length } });
  return { id: row.id, slug };
}

/**
 * Publish a drafted article. Enforces the emergency stop and the owner's
 * content-publishing permission, runs a QA gate (title, summary, ≥1 source) and
 * audits the transition. Idempotent on re-publish.
 */
export async function publishArticle(slug: string, actorId: string): Promise<{ slug: string; status: string }> {
  await assertNotStopped();
  await assertContentPublishingAllowed();

  const article = await prisma.article.findUnique({ where: { slug } });
  if (!article) throw new ValidationError('article not found');

  const sources = Array.isArray(article.sources) ? (article.sources as unknown[]) : [];
  if (!article.title.trim() || !article.summary.trim() || sources.length === 0) {
    throw new ValidationError('article fails QA: it needs a title, a summary and at least one traceable source');
  }

  const updated = await prisma.article.update({
    where: { slug },
    data: { status: 'PUBLISHED', publishedAt: article.publishedAt ?? new Date() },
  });
  await audit({ actorType: 'owner', actorId, action: 'content.article_published', target: slug, severity: 'warn' });
  return { slug: updated.slug, status: updated.status };
}

export async function listPublishedArticles(): Promise<Array<{ slug: string; title: string; summary: string; publishedAt: Date | null }>> {
  return prisma.article.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    select: { slug: true, title: true, summary: true, publishedAt: true },
  });
}

export async function getPublishedArticle(slug: string) {
  const a = await prisma.article.findUnique({ where: { slug } });
  return a && a.status === 'PUBLISHED' ? a : null;
}

export async function listAllArticles() {
  return prisma.article.findMany({ orderBy: { createdAt: 'desc' } });
}
