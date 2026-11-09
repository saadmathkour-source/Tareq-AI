/**
 * Public storefront pages (Phase 16, group 4).
 *
 * Honest, dependency-free HTML for the shop index, the post-purchase thank-you
 * page and the legal pages (terms, privacy, refunds). No fabricated claims, no
 * testimonials, no certifications — we have no verified ones.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLE = `:root{--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#2563eb;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:1px solid var(--line);padding:16px 0}header .wrap{display:flex;justify-content:space-between;align-items:center}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}.brand{font-weight:700;letter-spacing:-.02em}
main{background:#fff;border:1px solid var(--line);border-radius:14px;margin:28px auto;max-width:880px;padding:32px}
h1{font-size:1.9rem;line-height:1.2}h2{font-size:1.15rem;margin-top:1.6em}a{color:var(--accent)}
.card{border:1px solid var(--line);border-radius:12px;padding:20px;margin:14px 0}
.price{font-weight:700}.muted{color:var(--muted);font-size:.92rem}.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:600}
footer{color:var(--muted);font-size:.85rem;max-width:880px;margin:0 auto 40px;padding:0 20px}`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><div class="wrap"><span class="brand">TAREQ AI</span><a href="/shop">Shop</a></div></header>
<main>${body}</main>
<footer><p>Automated business research services. No results, certifications or partnerships are claimed.</p>
<p><a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a> · <a href="/legal/refunds">Refunds</a> · <a href="mailto:support@tareq.ai">support@tareq.ai</a></p></footer>
</body></html>`;
}

export interface ShopProduct {
  slug: string;
  name: string;
  tagline: string;
  priceUsd: unknown;
}

export function shopHtml(products: ShopProduct[]): string {
  const cards = products.length
    ? products
        .map(
          (p) => `<div class="card"><h2>${esc(p.name)}</h2><p class="muted">${esc(p.tagline)}</p>
<p class="price">$${Number(p.priceUsd).toLocaleString('en-US')}</p><a class="btn" href="/buy/${esc(p.slug)}">View &amp; buy</a></div>`,
        )
        .join('')
    : '<p class="muted">No products are published right now.</p>';
  return shell('Shop — TAREQ AI', `<h1>Products</h1><p class="muted">Fixed-scope, automated research services delivered by email after verified payment.</p>${cards}`);
}

export function thanksHtml(orderId: string): string {
  return shell(
    'Thank you — TAREQ AI',
    `<h1>Thank you</h1>
<p>Your payment is being verified. As soon as Stripe confirms it, your report is generated and emailed to you — usually within a few minutes.</p>
${orderId ? `<p class="muted">Order reference: ${esc(orderId)}</p>` : ''}
<p><a href="/shop">Back to shop</a></p>`,
  );
}

export function notFoundHtml(msg: string): string {
  return shell('Not found — TAREQ AI', `<h1>${esc(msg)}</h1><p><a href="/shop">Back to shop</a></p>`);
}

const LEGAL: Record<string, { title: string; body: string }> = {
  terms: {
    title: 'Terms of Service',
    body: `<h1>Terms of Service</h1>
<p class="muted">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<h2>Service</h2><p>TAREQ AI provides automated business-research deliverables. Each product page states exactly what you receive, what we need from you, and the limits of the service.</p>
<h2>Payment</h2><p>Payment is processed by Stripe. Work begins only after Stripe confirms your payment.</p>
<h2>Delivery</h2><p>Deliverables are sent to the email used at checkout. If we cannot deliver, you receive a full refund.</p>
<h2>No advice</h2><p>Our reports are decision support from public sources. They are not financial, legal or investment advice, and no outcome is guaranteed.</p>
<h2>Acceptable use</h2><p>You agree not to use our deliverables unlawfully or to harass the individuals named in any lead list.</p>`,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `<h1>Privacy Policy</h1>
<p class="muted">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<h2>What we collect</h2><p>Your email address and the requirements you submit, so we can deliver your report. Payment details are handled by Stripe and never reach our servers.</p>
<h2>How we use it</h2><p>Solely to fulfil your order and provide support. We do not sell your data.</p>
<h2>Public information</h2><p>Our research uses only public sources. Where a deliverable lists prospects, each is tied to a public source URL and we state the lawful basis.</p>
<h2>Your rights</h2><p>Email <a href="mailto:support@tareq.ai">support@tareq.ai</a> to access or delete your data.</p>`,
  },
  refunds: {
    title: 'Refunds & Cancellation',
    body: `<h1>Refunds &amp; Cancellation</h1>
<h2>Cancellation</h2><p>You may cancel before delivery starts by emailing <a href="mailto:support@tareq.ai">support@tareq.ai</a>. If work has not begun, we refund in full.</p>
<h2>Refunds</h2><p>If we cannot deliver the described deliverable, you receive a full refund. Because deliverables are produced immediately on payment, we cannot refund a completed report except where it is defective.</p>
<h2>Defective work</h2><p>If a deliverable does not meet the stated scope, tell us within 7 days and we will correct it or refund you.</p>`,
  },
};

export function legalHtml(page: string): string | null {
  const entry = LEGAL[page];
  if (!entry) return null;
  return shell(`${entry.title} — TAREQ AI`, entry.body);
}
