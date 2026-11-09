import { prisma } from '../core/db.ts';
import { logger } from '../core/logger.ts';

/**
 * Landing page renderer (Phase 16, group 4).
 *
 * Renders a clean, honest, English-language commercial page from a Product row.
 * It carries ONLY facts we can stand behind: the problem, the solution, exactly
 * what the buyer receives, the price, the requirements, and the limits. There
 * are deliberately no testimonials, logos, certifications or customer counts —
 * we have no verified ones, and the directive forbids inventing them.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function list(items: unknown, cls = ''): string {
  const arr = Array.isArray(items) ? (items as string[]) : [];
  if (arr.length === 0) return '';
  return `<ul class="${cls}">${arr.map((i) => `<li>${esc(String(i))}</li>`).join('')}</ul>`;
}

export interface LandingInput {
  slug: string;
  name: string;
  tagline: string;
  problem: string;
  solution: string;
  deliverables: unknown;
  deliverySteps: unknown;
  requirements: unknown;
  limitations: unknown;
  priceUsd: number | string;
  currency?: string;
  checkoutUrl?: string;
}

export function renderLandingHtml(p: LandingInput): string {
  const price = Number(p.priceUsd);
  const priceLabel = `$${price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  // The purchase form lives at /checkout/:slug. Pointing the CTA there (rather
  // than back at this landing page) is what makes the button actually buy.
  const cta = p.checkoutUrl
    ? `<a class="btn" href="${esc(p.checkoutUrl)}">Buy now — ${esc(priceLabel)}</a>`
    : `<a class="btn" href="/checkout/${esc(p.slug)}">Buy now — ${esc(priceLabel)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)} — ${esc(p.tagline)}</title>
<meta name="description" content="${esc(p.tagline)}">
<style>
:root{--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#2563eb;--bg:#f8fafc}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:1px solid var(--line);padding:16px 0}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}
.brand{font-weight:700;letter-spacing:-.02em}
main{background:#fff;border:1px solid var(--line);border-radius:14px;margin:28px auto;max-width:880px;padding:32px}
h1{font-size:2rem;line-height:1.2;margin:.2em 0}
h2{font-size:1.15rem;margin:1.6em 0 .4em}
.tag{color:var(--muted);font-size:1.05rem}
.price{font-size:2rem;font-weight:700;margin:.4em 0}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600}
.btn:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
ul{padding-left:1.1em}
li{margin:.3em 0}
.muted{color:var(--muted);font-size:.92rem}
.limits{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px}
footer{color:var(--muted);font-size:.85rem;max-width:880px;margin:0 auto 40px;padding:0 20px}
a{color:var(--accent)}
</style>
</head>
<body>
<header><div class="wrap"><span class="brand">TAREQ AI</span></div></header>
<main>
  <p class="muted">${esc(p.tagline)}</p>
  <h1>${esc(p.name)}</h1>
  <h2>The problem</h2><p>${esc(p.problem)}</p>
  <h2>What you get</h2><p>${esc(p.solution)}</p>
  ${list(p.deliverables)}
  <div class="grid">
    <div><h2>What we need from you</h2>${list(p.requirements)}</div>
    <div><h2>How it is delivered</h2>${list(p.deliverySteps)}</div>
  </div>
  <h2>Honest limitations</h2>
  <div class="limits">${list(p.limitations)}</div>
  <div class="price">${esc(priceLabel)} <span class="muted">one-time · ${esc(p.currency ?? 'USD')}</span></div>
  <p>${cta}</p>
  <p class="muted">Secure payment via Stripe. You will receive the deliverable by email after payment is verified. If we cannot deliver, you get a full refund.</p>
</main>
<footer>
  <p>TAREQ AI — automated business research services. No results, certifications or partnerships are claimed here; we have no verified customer outcomes to show yet, and we will not invent any.</p>
  <p><a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a> · <a href="/legal/refunds">Refunds &amp; Cancellation</a> · <a href="mailto:support@tareq.ai">support@tareq.ai</a></p>
</footer>
</body>
</html>`;
}

/** Render and persist the landing page for a product. */
export async function generateLanding(slug: string, checkoutUrl?: string): Promise<string> {
  const p = await prisma.product.findUnique({ where: { slug } });
  if (!p) throw new Error(`Product not found: ${slug}`);
  const html = renderLandingHtml({
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    problem: p.problem,
    solution: p.solution,
    deliverables: p.deliverables,
    deliverySteps: p.deliverySteps,
    requirements: p.requirements,
    limitations: p.limitations,
    priceUsd: Number(p.priceUsd),
    currency: p.currency,
    checkoutUrl,
  });
  await prisma.product.update({ where: { id: p.id }, data: { landingHtml: html } });
  logger.info('landing page generated', { slug });
  return html;
}

/** Regenerate landing pages for every published product. */
export async function generateAllLandings(): Promise<number> {
  const products = await prisma.product.findMany({ where: { status: 'PUBLISHED' } });
  for (const p of products) {
    await generateLanding(p.slug);
  }
  return products.length;
}
