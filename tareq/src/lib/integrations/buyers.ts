/**
 * Public buyer-discovery connector (capability 11).
 *
 * Finds *potential* buyers from public, lawful sources — currently Hacker News
 * discussion. It records only what the source actually publishes: a public
 * pseudonymous author handle and a public permalink. It does NOT fabricate
 * emails, names, or intent.
 *
 * A pseudonymous handle is NOT a business contact. Callers must treat the
 * result as a lead candidate requiring the buyer's own lawful basis before any
 * contact, which is why `lawfulBasis` is 'public_discussion' and no email is set.
 *
 * The connector returns two things:
 *  - CandidateLead[]: authors who publicly discussed the problem (public handle).
 *  - Complaint[]: verbatim excerpts that evidence the pain, with permalinks.
 * Both are returned as untrusted data.
 */

import { ValidationError } from '../core/errors.ts';
import { logger } from '../core/logger.ts';

export interface CandidateLead {
  /** Public pseudonymous handle, as published by the source. */
  handle: string;
  sourceUrl: string;
  storyTitle: string | null;
  postedAt: string | null;
  /** Public post/comment where the person discussed the topic. */
  postUrl: string;
  /** The complaint/need excerpt that matched. */
  excerpt: string;
  /** 0..1 keyword-match strength; this is a relevance proxy, not buying intent. */
  relevance: number;
  lawfulBasis: 'public_discussion';
}

export interface BuyerDiscoveryResult {
  topic: string;
  candidates: CandidateLead[];
  complaints: Array<{ text: string; sourceUrl: string; postedAt: string | null; source: string }>;
  totalHits: number;
  scanned: number;
  interpretation: string;
  discoveredAt: string;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 512 * 1024;

async function fetchJson<T>(url: string): Promise<T> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new ValidationError(`Refusing non-https endpoint: ${parsed.protocol}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': 'TAREQ-Agent/0.1 (+buyer-research; contact: owner)' },
    });
    if (res.status >= 400) throw new ValidationError(`${parsed.hostname} returned ${res.status}`);
    const buf = await res.arrayBuffer();
    return JSON.parse(Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8')) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip HTML entities/tags from a comment body. Comment text is untrusted data. */
export function cleanComment(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keyword-match relevance in 0..1 (fraction of meaningful terms present). */
export function relevance(topic: string, text: string): number {
  const terms = topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  const hits = terms.filter((w) => hay.includes(w)).length;
  return Math.min(1, hits / terms.length);
}

interface HnComment {
  author?: string | null;
  story_title?: string | null;
  created_at?: string | null;
  objectID?: string | null;
  comment_text?: string | null;
}

/**
 * Discover candidate leads and complaint evidence from public Hacker News
 * comments. Returns handles, permalinks and excerpts — nothing invented.
 */
export async function discoverBuyersFromHN(topic: string, opts: { limit?: number } = {}): Promise<BuyerDiscoveryResult> {
  if (!topic.trim()) throw new ValidationError('topic is required');
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=comment&hitsPerPage=${limit}`;
  const data = await fetchJson<{ nbHits?: number; hits?: HnComment[] }>(url);
  const hits = data.hits ?? [];

  const candidates: CandidateLead[] = [];
  const complaints: BuyerDiscoveryResult['complaints'] = [];
  const seen = new Set<string>();

  for (const h of hits) {
    const text = cleanComment(h.comment_text ?? '');
    if (!text || !h.author || !h.objectID) continue;
    const rel = relevance(topic, text);
    const postUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
    if (rel >= 0.5 && !seen.has(h.author)) {
      seen.add(h.author);
      candidates.push({
        handle: h.author,
        sourceUrl: postUrl,
        storyTitle: h.story_title ?? null,
        postedAt: h.created_at ?? null,
        postUrl,
        excerpt: text.slice(0, 300),
        relevance: rel,
        lawfulBasis: 'public_discussion',
      });
    }
    if (rel >= 0.5) {
      complaints.push({ text: text.slice(0, 300), sourceUrl: postUrl, postedAt: h.created_at ?? null, source: 'hackernews' });
    }
  }

  candidates.sort((a, b) => b.relevance - a.relevance);
  const interpretation =
    candidates.length === 0
      ? 'No public discussion participants matched. This does not mean no buyers exist; it means this source produced no candidates.'
      : `${candidates.length} public participant(s) discussed this topic. These are pseudonymous public handles, not verified buyers or business contacts. Any contact requires the person's own lawful basis and owner approval.`;

  logger.info('buyer discovery complete', { topic, candidates: candidates.length, hits: hits.length });
  return {
    topic,
    candidates,
    complaints,
    totalHits: data.nbHits ?? hits.length,
    scanned: hits.length,
    interpretation,
    discoveredAt: new Date().toISOString(),
  };
}
