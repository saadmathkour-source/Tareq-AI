import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/core/db.ts';
import { seedProducts } from '../src/lib/commercial/products.ts';
import { createPublicCheckout, getPublicOrderStatus, normalizeEmail, sanitizeRequirements } from '../src/lib/commercial/checkout.ts';
import { deliverOrder, redeemDownloadToken, hashToken, mintDownloadToken } from '../src/lib/commercial/delivery.ts';
import { handleWebhook } from '../src/lib/integrations/stripe.ts';
import { rateLimit, resetRateLimits } from '../src/lib/security/rate-limit.ts';
import { thanksHtml, buyHtml } from '../src/app/storefront.ts';
import type { DemandScan } from '../src/lib/integrations/publicdata.ts';

/**
 * Phase 17 — public checkout and real customer delivery.
 *
 * These tests exercise the real DB code paths against the isolated test
 * database. Stripe's HTTPS API is stubbed (a real LIVE charge must never be
 * created in a test) and email is injected, so nothing leaves the machine. Every
 * side effect a test enqueues is tagged with the worker-excluded `QTEST-` prefix.
 */

// `_test_` in the marker keeps any revenue row this file records classified as
// test volume by the ledger (isTestExternalId), so it can never inflate the
// headline revenue a parallel test file reads. `QTEST-17` keeps the production
// worker from ever claiming a task this file enqueues.
const MARK = `QTEST-17_test_${Date.now().toString(36)}`;
const SECRET = `whsec_test_${randomUUID()}`;
const realSecret = process.env.STRIPE_WEBHOOK_SECRET;
const realStripeKey = process.env.STRIPE_SECRET_KEY;
const realFetch = globalThis.fetch;
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.TAREQ_PUBLIC_URL = 'https://example.test';
// A dummy key so the checkout code path runs without ever touching the live
// Stripe account. The one place a Stripe call is made (`stubStripe`) intercepts
// fetch entirely, so no real request is ever sent.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_phase17';

const orderIds: string[] = [];

async function purgePreviousRuns(): Promise<void> {
  const stale = await prisma.order.findMany({ where: { customerEmail: { startsWith: 'QTEST-17' } }, select: { id: true } });
  for (const o of stale) {
    await prisma.ledgerEntry.deleteMany({ where: { kind: 'DELIVERY_COST', evidence: { path: ['orderId'], equals: o.id } } });
  }
  await prisma.order.deleteMany({ where: { customerEmail: { startsWith: 'QTEST-17' } } });
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: 'QTEST-17' } } });
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { contains: 'QTEST-17' } } });
}

test.before(async () => {
  await purgePreviousRuns();
  await seedProducts();
});

// Restore the real fetch and the limiter windows between tests, so a test that
// stubs Stripe can never leak into another test or the network.
test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetRateLimits();
});

test.after(async () => {
  globalThis.fetch = realFetch;
  for (const id of orderIds) {
    await prisma.ledgerEntry.deleteMany({ where: { kind: 'DELIVERY_COST', evidence: { path: ['orderId'], equals: id } } });
    await prisma.order.delete({ where: { id } }).catch(() => {});
  }
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: MARK } } });
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { contains: MARK } } });
  if (realSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = realSecret;
  if (realStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = realStripeKey;
  await prisma.$disconnect();
});

/** Stub Stripe's Checkout Session endpoint; returns the last request body. */
function stubStripe(): { lastBody: () => string | null } {
  let last: string | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('api.stripe.com/v1/checkout/sessions')) {
      last = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: `cs_test_${randomUUID().slice(0, 8)}`, url: 'https://checkout.stripe.com/c/pay/TEST' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  }) as typeof fetch;
  return { lastBody: () => last };
}

function fakeDemand(topic: string): DemandScan {
  return {
    topic,
    signals: [{ source: 'hackernews', title: 'Ask HN', url: 'https://news.ycombinator.com/item?id=1', points: 42, comments: 8, createdAt: new Date().toISOString(), text: 'x' }],
    volume: 12,
    recentCount: 5,
    avgPoints: 37,
    confidence: 0.4,
    interpretation: '12 discussions, 5 recent.',
    scannedAt: new Date().toISOString(),
  };
}

function emptyDemand(topic: string): DemandScan {
  return { topic, signals: [], volume: 0, recentCount: 0, avgPoints: 0, confidence: 0, interpretation: 'none', scannedAt: new Date().toISOString() };
}

/** An AWAITING_PAYMENT order created through the public checkout (Stripe stubbed). */
async function newAwaitingOrder(email: string): Promise<string> {
  const res = await createPublicCheckout({ slug: 'market-opportunity-report', email, requirements: { topic: 'AI bookkeeping' }, baseUrl: 'https://example.test' });
  orderIds.push(res.orderId);
  return res.orderId;
}

/**
 * An AWAITING_PAYMENT order created directly, without the checkout or Stripe.
 * Used by tests that only care about webhook/delivery behaviour, so the Stripe
 * checkout path is exercised in exactly the tests that assert on it.
 */
async function newDirectOrder(email: string): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'market-opportunity-report' } });
  const order = await prisma.order.create({
    data: { productId: product.id, status: 'AWAITING_PAYMENT', customerEmail: email.toLowerCase(), amountUsd: product.priceUsd, currency: product.currency, requirements: { topic: 'x' } as never },
  });
  orderIds.push(order.id);
  return order.id;
}

function sign(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function paidEvent(orderId: string, amountCents = 14900, currency = 'usd', email = `${MARK}@example.com`) {
  const eventId = `evt_${MARK}_${randomUUID().slice(0, 8)}`;
  return {
    eventId,
    body: JSON.stringify({
      id: eventId,
      type: 'checkout.session.completed',
      livemode: true,
      data: { object: { id: `cs_${randomUUID().slice(0, 8)}`, amount_total: amountCents, currency, payment_status: 'paid', payment_intent: `pi_${randomUUID().slice(0, 8)}`, client_reference_id: orderId, customer_details: { email } } },
    }),
  };
}

// --- input validation (pure) ------------------------------------------------

test('normalizeEmail accepts a valid address and rejects malformed ones', () => {
  assert.equal(normalizeEmail('  Buyer@Example.COM '), 'buyer@example.com');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'x'.repeat(300) + '@e.com']) {
    assert.throws(() => normalizeEmail(bad), /valid customer email/);
  }
});

test('sanitizeRequirements keeps only known keys and bounds length', () => {
  const out = sanitizeRequirements({ topic: 'x', evil: 'y', niche: 'z', notes: 'n'.repeat(999) });
  assert.deepEqual(Object.keys(out).sort(), ['niche', 'notes', 'topic']);
  assert.equal(out.notes!.length, 500);
});

test('the rate limiter blocks once the window allowance is spent', () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit('k', 3, 1000, now).ok, true);
  const blocked = rateLimit('k', 3, 1000, now);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(rateLimit('k', 3, 1000, now + 1000).ok, true, 'a new window resets the allowance');
});

// --- public checkout --------------------------------------------------------

test('a PUBLISHED product can be bought: order is AWAITING_PAYMENT at the server price', async () => {
  const { lastBody } = stubStripe();
  const orderId = await newAwaitingOrder(`${MARK}@example.com`);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'AWAITING_PAYMENT');
  assert.equal(Number(order?.amountUsd), 149, 'price comes from the product row');
  assert.ok(order?.stripeSessionId);
  assert.ok(order?.checkoutUrl);
  // The Stripe session was tied to the order and priced server-side.
  const body = new URLSearchParams(lastBody() ?? '');
  assert.equal(body.get('client_reference_id'), orderId);
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '14900');
  globalThis.fetch = realFetch;
});

test('a browser-supplied price cannot change what is charged', async () => {
  stubStripe();
  const res = await createPublicCheckout({
    slug: 'market-opportunity-report',
    email: `${MARK}.price@example.com`,
    // A malicious client tries to inject a price; it is not a known key and is dropped.
    requirements: { topic: 'x', priceUsd: '1', amount: '0.01' } as never,
    baseUrl: 'https://example.test',
  });
  orderIds.push(res.orderId);
  const order = await prisma.order.findUnique({ where: { id: res.orderId } });
  assert.equal(Number(order?.amountUsd), 149);
  globalThis.fetch = realFetch;
});

test('a DRAFT product cannot be bought', async () => {
  await assert.rejects(() => createPublicCheckout({ slug: 'competitor-white-space-scan', email: `${MARK}@example.com`, baseUrl: 'https://example.test' }), /not available/);
});

test('an invalid email is refused before any order is created', async () => {
  const before = await prisma.order.count({ where: { customerEmail: { startsWith: MARK } } });
  await assert.rejects(() => createPublicCheckout({ slug: 'market-opportunity-report', email: 'not-an-email', baseUrl: 'https://example.test' }), /valid customer email/);
  const after = await prisma.order.count({ where: { customerEmail: { startsWith: MARK } } });
  assert.equal(before, after);
});

test('a repeat checkout within the window reuses the same order (no duplicate)', async () => {
  stubStripe();
  const email = `${MARK}.dup@example.com`;
  const first = await createPublicCheckout({ slug: 'market-opportunity-report', email, baseUrl: 'https://example.test' });
  orderIds.push(first.orderId);
  const second = await createPublicCheckout({ slug: 'market-opportunity-report', email, baseUrl: 'https://example.test' });
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.reused, true);
  // Stored emails are normalised to lower case by the checkout.
  const count = await prisma.order.count({ where: { customerEmail: email.toLowerCase() } });
  assert.equal(count, 1, 'only one order exists for the repeat');
  globalThis.fetch = realFetch;
});

// --- webhook recognition ----------------------------------------------------

test('a valid signed LIVE webhook activates the order', async () => {
  const orderId = await newDirectOrder(`${MARK}.hook@example.com`);
  const { body } = paidEvent(orderId);
  const res = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, true);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'PAID');
});

test('a forged signature is rejected and records no revenue', async () => {
  const orderId = await newDirectOrder(`${MARK}.forge@example.com`);
  const { body } = paidEvent(orderId);
  const res = await handleWebhook(body, 't=1,v1=deadbeef', { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, false);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'AWAITING_PAYMENT', 'a bad signature never activates the order');
});

test('a replayed webhook does not double-activate or double-enqueue delivery', async () => {
  const orderId = await newDirectOrder(`${MARK}.replay@example.com`);
  const { body } = paidEvent(orderId);
  await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  const tasks = await prisma.task.count({ where: { idempotencyKey: `${MARK}:order.deliver:${orderId}` } });
  assert.equal(tasks, 1);
});

test('an unpaid completed session is ignored', async () => {
  const orderId = await newDirectOrder(`${MARK}.unpaid@example.com`);
  const eventId = `evt_${MARK}_unpaid`;
  const body = JSON.stringify({ id: eventId, type: 'checkout.session.completed', livemode: true, data: { object: { id: 'cs_x', amount_total: 14900, currency: 'usd', payment_status: 'unpaid', client_reference_id: orderId } } });
  const res = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, true);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'AWAITING_PAYMENT');
});

test('an amount mismatch records revenue but does not activate the order', async () => {
  const orderId = await newDirectOrder(`${MARK}.mismatch@example.com`);
  const { body } = paidEvent(orderId, 100); // $1 instead of $149
  const res = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, true);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'AWAITING_PAYMENT');
});

test('a currency mismatch does not activate the order', async () => {
  const orderId = await newDirectOrder(`${MARK}.cur@example.com`);
  const { body } = paidEvent(orderId, 14900, 'eur');
  await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'AWAITING_PAYMENT');
});

// --- delivery ---------------------------------------------------------------

async function paidOrder(email: string): Promise<string> {
  const orderId = await newDirectOrder(email);
  const { body } = paidEvent(orderId, 14900, 'usd', email.toLowerCase());
  await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  return orderId;
}

test('delivery refuses an order that is not paid', async () => {
  const orderId = await newDirectOrder(`${MARK}.nodeliver@example.com`);
  await assert.rejects(() => deliverOrder(orderId, { scan: async (t) => fakeDemand(t) }), /only a PAID order/);
});

test('delivery of a paid order generates a validated artifact, emails the buyer and marks DELIVERED', async () => {
  const orderId = await paidOrder(`${MARK}.deliver@example.com`);
  let sentTo: string | null = null;
  const res = await deliverOrder(orderId, {
    scan: async (t) => fakeDemand(t),
    summarize: async (t) => `Signals for ${t} show interest only.`,
    sendEmail: async (input) => {
      sentTo = input.to;
      assert.match(input.text, /\/download\//, 'the email carries a download link');
      return { sent: true };
    },
  });
  assert.equal(res.emailSent, true);
  assert.equal(res.status, 'DELIVERED');
  assert.equal(sentTo, `${MARK}.deliver@example.com`.toLowerCase());

  const artifact = await prisma.deliveryArtifact.findUnique({ where: { id: res.artifactId } });
  assert.equal(artifact?.validated, true);
  assert.equal(artifact?.emailStatus, 'SENT');
  assert.ok(artifact?.emailSentAt);
  assert.ok(artifact?.downloadTokenHash, 'the download token hash is stored');
  const report = JSON.parse(artifact?.ref ?? '{}');
  assert.ok(report.demand.sources.length > 0);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'DELIVERED');
});

test('delivery QA failure marks the order FAILED and does not email', async () => {
  const orderId = await paidOrder(`${MARK}.qafail@example.com`);
  let emailed = false;
  await assert.rejects(
    () => deliverOrder(orderId, { scan: async (t) => emptyDemand(t), summarize: async () => 'no sources', sendEmail: async () => { emailed = true; return { sent: true }; } }),
    /QA failed/,
  );
  assert.equal(emailed, false);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'FAILED');
});

test('an email failure keeps the artifact, sets EMAIL_FAILED, and a retry sends without regenerating', async () => {
  const orderId = await paidOrder(`${MARK}.mailfail@example.com`);
  const first = await deliverOrder(orderId, { scan: async (t) => fakeDemand(t), summarize: async () => 's', sendEmail: async () => ({ sent: false, reason: 'provider down' }) });
  assert.equal(first.emailSent, false);
  assert.equal(first.status, 'EMAIL_FAILED');

  let order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'EMAIL_FAILED');
  const artifactsAfterFail = await prisma.deliveryArtifact.count({ where: { orderId } });
  assert.equal(artifactsAfterFail, 1);

  const retry = await deliverOrder(orderId, { sendEmail: async () => ({ sent: true }) });
  assert.equal(retry.artifactId, first.artifactId, 'the same artifact is reused');
  assert.equal(retry.emailSent, true);
  const artifactsAfterRetry = await prisma.deliveryArtifact.count({ where: { orderId } });
  assert.equal(artifactsAfterRetry, 1, 'no duplicate artifact on retry');

  order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order?.status, 'DELIVERED');
});

// --- download links ---------------------------------------------------------

test('a valid download token returns only its own order artifact; expired and foreign tokens fail', async () => {
  // Deliver a paid order so a real artifact exists, then take control of its token.
  async function deliveredArtifact(email: string): Promise<{ orderId: string; artifactId: string }> {
    const orderId = await paidOrder(email);
    const res = await deliverOrder(orderId, { scan: async (t) => fakeDemand(t), summarize: async () => 's', sendEmail: async () => ({ sent: true }) });
    return { orderId, artifactId: res.artifactId };
  }
  const a = await deliveredArtifact(`${MARK}.dl@example.com`);
  const token = mintDownloadToken();
  await prisma.deliveryArtifact.update({ where: { id: a.artifactId }, data: { downloadTokenHash: hashToken(token), downloadExpiresAt: new Date(Date.now() + 3600_000) } });

  const found = await redeemDownloadToken(token);
  assert.ok(found);
  assert.equal(found?.orderId, a.orderId);

  assert.equal(await redeemDownloadToken('x'.repeat(43)), null, 'an unknown token fails');
  assert.equal(await redeemDownloadToken('short'), null, 'a too-short token fails');

  // A second order's token never returns the first order's artifact.
  const b = await deliveredArtifact(`${MARK}.dl2@example.com`);
  const otherToken = mintDownloadToken();
  await prisma.deliveryArtifact.update({ where: { id: b.artifactId }, data: { downloadTokenHash: hashToken(otherToken) } });
  const otherFound = await redeemDownloadToken(otherToken);
  assert.equal(otherFound?.orderId, b.orderId);
  assert.notEqual(otherFound?.artifactId, a.artifactId);

  // Expiry.
  await prisma.deliveryArtifact.update({ where: { id: a.artifactId }, data: { downloadExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await redeemDownloadToken(token), null, 'an expired token fails');
});

// --- customer-facing pages --------------------------------------------------

test('the thanks page shows the real status and never claims a pre-emptive email', () => {
  assert.match(thanksHtml('o1', 'AWAITING_PAYMENT'), /being verified/i);
  assert.match(thanksHtml('o1', 'DELIVERED'), /emailed/i);
  assert.match(thanksHtml('o1', 'EMAIL_FAILED'), /delayed|could not be sent/i);
  // The unknown/blank case must not assert the product was sent.
  assert.doesNotMatch(thanksHtml('', null), /has been emailed to you/i);
});

test('the buy page posts to the public checkout route at the server price', () => {
  const html = buyHtml({ slug: 'market-opportunity-report', name: 'Market Opportunity Report', tagline: 't', priceUsd: 149, currency: 'USD', requirements: ['niche'] });
  assert.match(html, /action="\/checkout\/market-opportunity-report"/);
  assert.match(html, /\$149/);
});

test('the public order status never exposes the buyer email', async () => {
  const orderId = await newDirectOrder(`${MARK}.status@example.com`);
  const st = await getPublicOrderStatus(orderId);
  assert.ok(st);
  assert.equal(st?.orderId, orderId);
  assert.equal(JSON.stringify(st).includes('@example.com'), false);
});
