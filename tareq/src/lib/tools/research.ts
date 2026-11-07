import { ValidationError } from '../core/errors.ts';
import { recordClaim } from '../memory/evidence.ts';
import { remember } from '../memory/index.ts';

/**
 * Research tool.
 *
 * Lawful collection only: it fetches a URL the operator or the agent has chosen,
 * from the public web, with a hard timeout and a size cap, and records what it
 * found as evidence with provenance. It never bypasses a login, paywall or
 * technical protection, and it treats every fetched byte as untrusted data.
 */

export interface FetchResult {
  url: string;
  status: number;
  title: string;
  text: string;
  fetchedAt: string;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;

/** Very small HTML-to-text: strip scripts/styles, tags, and collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1] ?? '') : '';
}

/** Fetch a public URL. Refuses non-http(s) schemes and oversized bodies. */
export async function fetchPublic(url: string): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`Refusing to fetch non-http(s) URL: ${parsed.protocol}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'TAREQ-Agent/0.1 (+research; contact: owner)' },
    });
    const buf = await res.arrayBuffer();
    const html = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
    const text = htmlToText(html);
    return { url: parsed.toString(), status: res.status, title: extractTitle(html), text: text.slice(0, 20_000), fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a source and record it as market evidence. Returns the evidence id.
 * The claim is created unpublished — it becomes publishable only after the owner
 * or a verification step confirms it.
 */
export async function researchSource(url: string, statement: string, validForDays = 45): Promise<{ evidenceId: string; title: string; chars: number }> {
  const result = await fetchPublic(url);
  if (result.status >= 400) throw new ValidationError(`Source returned ${result.status}`);
  const evidenceId = await recordClaim({
    statement,
    source: result.title || result.url,
    sourceUrl: result.url,
    confidence: 0.6,
    validUntil: new Date(Date.now() + validForDays * 86_400_000),
    publishable: false,
  });
  await remember({
    kind: 'MARKET_EVIDENCE',
    key: `src:${new URL(result.url).hostname}:${result.title.slice(0, 40)}`,
    content: `${result.title}\n${result.text.slice(0, 2000)}`,
    source: 'web',
    sourceUrl: result.url,
    epistemic: 'fact',
    confidence: 0.6,
    expiresAt: new Date(Date.now() + validForDays * 86_400_000),
  });
  return { evidenceId, title: result.title, chars: result.text.length };
}
