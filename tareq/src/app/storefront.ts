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
.price{font-weight:700}.muted{color:var(--muted);font-size:.92rem}.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:600;border:0;cursor:pointer;font-size:1rem}
.buyform{margin:22px 0;display:grid;gap:8px;max-width:460px}
.buyform label{font-weight:600;font-size:.95rem}
.buyform input{padding:11px 12px;border:1px solid var(--line);border-radius:9px;font-size:1rem;font-family:inherit}
.buyform .btn{margin-top:8px;justify-self:start}
pre.doc{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:10px;overflow:auto;font-size:12.5px;line-height:1.5}
nav a{margin-left:12px;text-decoration:none}
.prose p{margin:0 0 1em}
.prose{white-space:pre-wrap}
form.contact{display:grid;gap:8px;max-width:520px;margin:18px 0}
form.contact label{font-weight:600;font-size:.95rem}
form.contact input,form.contact textarea{padding:11px 12px;border:1px solid var(--line);border-radius:9px;font-size:1rem;font-family:inherit}
form.contact textarea{min-height:130px}
.articlelist .card h2{margin-top:0}
footer{color:var(--muted);font-size:.85rem;max-width:880px;margin:0 auto 40px;padding:0 20px}`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><div class="wrap"><span class="brand">TAREQ AI</span><nav><a href="/insights">Insights</a> · <a href="/shop">Shop</a> · <a href="/contact">Contact</a></nav></div></header>
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

/**
 * Post-purchase page. It shows the order's REAL status — it never claims the
 * deliverable was emailed before that actually happened. Only the status word
 * and the buyer's own order reference are shown; no other customer's data is
 * ever exposed.
 */
export function thanksHtml(orderId: string, status?: string | null): string {
  const state: Record<string, { title: string; body: string }> = {
    AWAITING_PAYMENT: {
      title: 'Payment is being verified',
      body: 'We have not received confirmation from Stripe yet. This page updates once your payment is confirmed — you can refresh it in a moment.',
    },
    PAID: {
      title: 'Payment confirmed',
      body: 'Thank you — your payment is confirmed. We are generating your report now; you will receive it by email shortly.',
    },
    IN_DELIVERY: {
      title: 'Your report is being created',
      body: 'Your payment is confirmed and your report is being generated. This usually takes a few minutes; you will receive it by email.',
    },
    DELIVERY_PENDING: {
      title: 'Your report is ready — email on its way',
      body: 'Your report has been generated. We are sending your confirmation email now.',
    },
    EMAIL_FAILED: {
      title: 'Your report is ready — email delayed',
      body: 'Your report has been generated successfully, but the confirmation email could not be sent yet. We are retrying. If you do not receive it soon, contact support with your order reference and we will send it manually.',
    },
    DELIVERED: {
      title: 'Your report has been emailed',
      body: 'Your report has been generated and emailed to the address you used at checkout. If you cannot find it, check your spam folder, then contact support with your order reference.',
    },
    REFUNDED: {
      title: 'Order refunded',
      body: 'This order was refunded. If you have any questions, contact support with your order reference.',
    },
    FAILED: {
      title: 'We could not complete your order',
      body: 'Something went wrong while producing your report. You will not be charged for a failed delivery; contact support with your order reference and we will resolve it.',
    },
    CANCELLED: {
      title: 'Order cancelled',
      body: 'This order was cancelled. No payment was taken.',
    },
  };
  const s = status && state[status] ? state[status]! : {
    title: 'Thank you',
    body: 'Your payment is being verified. As soon as Stripe confirms it, your report is generated and emailed to you.',
  };
  return shell(
    `${s.title} — TAREQ AI`,
    `<h1>${esc(s.title)}</h1>
<p>${esc(s.body)}</p>
${orderId ? `<p class="muted">Order reference: ${esc(orderId)}</p>` : ''}
<p><a href="/shop">Back to shop</a> · <a href="mailto:support@tareq.ai">Contact support</a></p>`,
  );
}

/**
 * Purchase page for a product: an email field that POSTs to the public checkout
 * endpoint. The price shown comes from the server-side product row, so the page
 * cannot be tricked into advertising a different price than the one charged.
 */
export function buyHtml(p: { slug: string; name: string; tagline: string; priceUsd: unknown; currency?: string; requirements?: unknown }): string {
  const price = Number(p.priceUsd);
  const priceLabel = `$${price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const reqs = Array.isArray(p.requirements) ? (p.requirements as string[]) : [];
  const reqList = reqs.length ? `<h2>What we need from you</h2><ul>${reqs.map((r) => `<li>${esc(String(r))}</li>`).join('')}</ul>` : '';
  return shell(
    `Buy ${p.name} — TAREQ AI`,
    `<h1>${esc(p.name)}</h1>
<p class="muted">${esc(p.tagline)}</p>
<p class="price">${esc(priceLabel)} <span class="muted">one-time · ${esc(p.currency ?? 'USD')}</span></p>
${reqList}
<form method="POST" action="/checkout/${esc(p.slug)}" class="buyform">
  <label for="email">Your email (we send the report here)</label>
  <input id="email" name="email" type="email" required maxlength="254" placeholder="you@company.com" autocomplete="email">
  <label for="topic">The niche or market to analyse</label>
  <input id="topic" name="topic" type="text" maxlength="500" placeholder="e.g. AI bookkeeping for dental clinics">
  <button class="btn" type="submit">Pay ${esc(priceLabel)} with Stripe</button>
</form>
<p class="muted">Secure payment via Stripe. Work begins only after Stripe confirms payment; the deliverable is emailed after verification. If we cannot deliver, you get a full refund.</p>
<p><a href="/shop">Back to shop</a></p>`,
  );
}

export function notFoundHtml(msg: string): string {
  return shell('Not found — TAREQ AI', `<h1>${esc(msg)}</h1><p><a href="/shop">Back to shop</a></p>`);
}

/** The buyer's own deliverable page, reached only via a valid download token. */
export function downloadHtml(name: string, content: string): string {
  return shell(
    `Your deliverable — TAREQ AI`,
    `<h1>Your deliverable is ready</h1>
<p class="muted">${esc(name)}</p>
<p><a class="btn" href="?format=json" download>Download as JSON</a></p>
<h2>Preview</h2>
<pre class="doc">${esc(content)}</pre>
<p class="muted">This page is private to your order. Do not share the link — anyone with it can view the report.</p>`,
  );
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

// --- organic publishing & inbound (Phase 19) -------------------------------

export interface ArticleCard {
  slug: string;
  title: string;
  summary: string;
  publishedAt: Date | null;
}

/** Index of published articles — TAREQ's own, owner-controlled channel. */
export function insightsHtml(articles: ArticleCard[]): string {
  const cards = articles.length
    ? `<div class="articlelist">${articles
        .map(
          (a) => `<div class="card"><h2><a href="/insights/${esc(a.slug)}">${esc(a.title)}</a></h2>
<p class="muted">${esc(a.summary)}</p></div>`,
        )
        .join('')}</div>`
    : '<p class="muted">No articles are published yet.</p>';
  return shell(
    'Insights — TAREQ AI',
    `<h1>Market insights</h1>
<p class="muted">Short, source-cited guides on judging demand honestly. Every figure is tied to a public source.</p>
${cards}
<p><a href="/shop">See our research services</a> · <a href="/contact">Ask a question</a></p>`,
  );
}

/** A single published article. Body is authored HTML with only escaped fields. */
export function articleHtml(a: { title: string; summary: string; bodyHtml: string; publishedAt: Date | null }): string {
  const date = a.publishedAt ? a.publishedAt.toISOString().slice(0, 10) : '';
  return shell(
    `${a.title} — TAREQ AI`,
    `<meta name="description" content="${esc(a.summary)}">
<article>${a.bodyHtml}</article>
${date ? `<p class="muted">Published ${esc(date)}</p>` : ''}
<p><a href="/insights">All insights</a> · <a href="/contact">Ask a question</a></p>`,
  );
}

/** Public contact form. Submitting is the visitor's own request — not outreach. */
export function contactHtml(opts: { products?: Array<{ slug: string; name: string }>; notice?: string; error?: string } = {}): string {
  const products = opts.products ?? [];
  const options = products.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('');
  const notice = opts.notice ? `<p class="muted">${esc(opts.notice)}</p>` : '';
  const error = opts.error ? `<p style="color:#b91c1c">${esc(opts.error)}</p>` : '';
  return shell(
    'Contact — TAREQ AI',
    `<h1>Ask a question</h1>
<p>Tell us what you need. We answer from verified product information, not sales talk. A member of the team can follow up by email.</p>
${error}${notice}
<form method="POST" action="/contact" class="contact">
  <label for="email">Your email</label>
  <input id="email" name="email" type="email" required maxlength="254" placeholder="you@company.com" autocomplete="email">
  <label for="name">Your name (optional)</label>
  <input id="name" name="name" type="text" maxlength="200" autocomplete="name">
  <label for="productSlug">Which service is this about? (optional)</label>
  <select id="productSlug" name="productSlug"><option value="">General question</option>${options}</select>
  <label for="message">Your question</label>
  <textarea id="message" name="message" required maxlength="4000" placeholder="e.g. What exactly do I receive, and how long does it take?"></textarea>
  <button class="btn" type="submit">Send question</button>
</form>
<p class="muted">We use your email only to reply to this question. You can ask us to delete it at any time.</p>`,
  );
}
