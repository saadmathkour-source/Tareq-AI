/**
 * Public-data research connectors (capability 9, and the demand-signal inputs
 * used by groups 10, 12, 30, 44, 68).
 *
 * These connectors use only public, keyless endpoints, so TAREQ keeps working
 * with zero paid subscriptions and no external account. They collect demand
 * *signals* — discussion volume, recency and engagement on a topic — never
 * willingness-to-pay proof. The output is therefore recorded as a hypothesis,
 * never as a verified fact.
 *
 * Every fetch is timeout-bounded, size-capped and treated as untrusted data.
 */

import { ValidationError } from '../core/errors.ts';

export type SignalSource = 'hackernews' | 'wikipedia';

export interface DemandSignal {
  source: SignalSource;
  title: string;
  url: string;
  points: number | null;
  comments: number | null;
  createdAt: string | null;
  text: string;
}

export interface DemandScan {
  topic: string;
  signals: DemandSignal[];
  volume: number;
  recentCount: number;
  avgPoints: number;
  confidence: number;
  interpretation: string;
  scannedAt: string;
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
      headers: { accept: 'application/json', 'user-agent': 'TAREQ-Agent/0.1 (+research; contact: owner)' },
    });
    const buf = await res.arrayBuffer();
    if (res.status >= 400) throw new ValidationError(`${parsed.hostname} returned ${res.status}`);
    const text = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface HnHit {
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string | null;
  objectID?: string | null;
}

/**
 * Hacker News search (Algolia). A keyless, public index of technical discussion.
 * Returns raw signals; it makes no claim about commercial intent.
 */
export async function hnSearch(query: string, opts: { limit?: number } = {}): Promise<DemandSignal[]> {
  if (!query.trim()) throw new ValidationError('query is required');
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const data = await fetchJson<{ hits?: HnHit[] }>(url);
  return (data.hits ?? [])
    .map((h) => ({
      source: 'hackernews' as const,
      title: (h.title ?? h.story_title ?? '').trim(),
      url: (h.url ?? h.story_url ?? (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '')).trim(),
      points: typeof h.points === 'number' ? h.points : null,
      comments: typeof h.num_comments === 'number' ? h.num_comments : null,
      createdAt: h.created_at ?? null,
      text: '',
    }))
    .filter((s) => s.title.length > 0);
}

interface WikiSummary {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

/** Wikipedia REST summary — public background facts about a market or technology. */
export async function wikiSummary(topic: string): Promise<DemandSignal | null> {
  if (!topic.trim()) throw new ValidationError('topic is required');
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.replace(/\s+/g, '_'))}`;
  try {
    const data = await fetchJson<WikiSummary>(url);
    if (!data.extract) return null;
    return {
      source: 'wikipedia',
      title: data.title ?? topic,
      url: data.content_urls?.desktop?.page ?? url,
      points: null,
      comments: null,
      createdAt: null,
      text: data.extract,
    };
  } catch (err) {
    // A missing article is not an error condition for a scan.
    if (err instanceof ValidationError && /\b404\b/.test(err.message)) return null;
    throw err;
  }
}

/**
 * Pure aggregation, separated from I/O so it can be tested deterministically.
 *
 * Confidence is deliberately conservative: discussion volume is a weak proxy for
 * demand, so the score is capped at 0.5 and the interpretation states the limit.
 */
export function summarizeSignals(topic: string, signals: DemandSignal[], now = Date.now()): DemandScan {
  const yearMs = 365 * 86_400_000;
  const hn = signals.filter((s) => s.source === 'hackernews');
  const recentCount = hn.filter((s) => s.createdAt && now - Date.parse(s.createdAt) < yearMs).length;
  const scored = hn.filter((s) => typeof s.points === 'number');
  const avgPoints = scored.length > 0 ? scored.reduce((a, s) => a + (s.points ?? 0), 0) / scored.length : 0;

  const volumeScore = Math.min(hn.length / 20, 1);
  const recencyScore = Math.min(recentCount / 10, 1);
  const engagementScore = Math.min(avgPoints / 100, 1);
  const confidence = Math.min(0.5, 0.5 * (0.5 * volumeScore + 0.3 * recencyScore + 0.2 * engagementScore));

  const interpretation =
    hn.length === 0
      ? 'No public discussion found. Absence of signals is not evidence of demand.'
      : `${hn.length} public discussion(s), ${recentCount} in the last year, avg ${avgPoints.toFixed(1)} points. ` +
        'This measures interest, not willingness to pay. Confirm with a priced offer before treating as demand.';

  return { topic, signals, volume: hn.length, recentCount, avgPoints, confidence, interpretation, scannedAt: new Date(now).toISOString() };
}

/** Scan a topic across the public connectors and aggregate the signals. */
export async function scanDemand(topic: string, opts: { limit?: number } = {}): Promise<DemandScan> {
  const [hn, wiki] = await Promise.all([
    hnSearch(topic, opts).catch(() => [] as DemandSignal[]),
    wikiSummary(topic).catch(() => null),
  ]);
  const signals = wiki ? [...hn, wiki] : hn;
  return summarizeSignals(topic, signals);
}
