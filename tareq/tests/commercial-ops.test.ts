import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/core/db.ts';
import { seedProducts, listProducts, getPublishedProduct } from '../src/lib/commercial/products.ts';
import { renderLandingHtml, generateLanding } from '../src/lib/commercial/landing.ts';
import { createOrder, markPaid } from '../src/lib/commercial/orders.ts';
import { deliverOrder, buildReport, validateReport } from '../src/lib/commercial/delivery.ts';
import { classifyStripeEvent } from '../src/lib/integrations/stripe.ts';
import { commercialOverview } from '../src/lib/commercial/overview.ts';
import type { DemandScan } from '../src/lib/integrations/publicdata.ts';

/**
 * Phase 16 commercial operation.
 *
 * These tests exercise the real DB code paths (products, orders, delivery,
 * overview) with injected deterministic research so they need no network and no
 * provider call. Stripe classification is tested as a pure function.
 */

const MARK = `QTEST-16-${Date.now().toString(36)}`;
const orderIds: string[] = [];

test.after(async () => {
  for (const id of orderIds) await prisma.order.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect();
});

function fakeDemand(topic: string): DemandScan {
  return {
    topic,
    signals: [
      { source: 'hackernews', title: 'Ask HN: niche pain', url: 'https://news.ycombinator.com/item?id=1', points: 42, comments: 18, createdAt: new Date().toISOString(), text: 'discussion' },
      { source: 'wikipedia', title: topic, url: 'https://en.wikipedia.org/wiki/X', points: null, comments: null, createdAt: null, text: 'summary' },
    ],
    volume: 12,
    recentCount: 5,
    avgPoints: 37,
    confidence: 0.4,
    interpretation: '12 discussions, 5 recent.',
    scannedAt: new Date().toISOString(),
  };
}

test('the catalog seeds and exposes exactly one published product', async () => {
  const n = await seedProducts();
  assert.ok(n >= 1);
  const products = await listProducts(false);
  const published = products.filter((p) => p.status === 'PUBLISHED');
  assert.equal(published.length, 1, 'exactly one product is published for the first launch');
  assert.equal(published[0]!.slug, 'market-opportunity-report');
  const again = await seedProducts();
  assert.equal(again, n, 'seeding is idempotent');
});

test('the landing page states price, deliverables, requirements and honest limits', async () => {
  const p = await getPublishedProduct('market-opportunity-report');
  assert.ok(p);
  const html = renderLandingHtml({
    slug: p!.slug,
    name: p!.name,
    tagline: p!.tagline,
    problem: p!.problem,
    solution: p!.solution,
    deliverables: p!.deliverables,
    deliverySteps: p!.deliverySteps,
    requirements: p!.requirements,
    limitations: p!.limitations,
    priceUsd: Number(p!.priceUsd),
  });
  assert.match(html, /\$149/);
  assert.match(html, /Honest limitations/);
  assert.match(html, /What you get/);
  // No fabricated trust signals.
  assert.doesNotMatch(html, /testimonial|trusted by|certified|award/i);
});

test('generateLanding persists HTML on the product', async () => {
  await generateLanding('market-opportunity-report');
  const p = await prisma.product.findUnique({ where: { slug: 'market-opportunity-report' } });
  assert.ok(p?.landingHtml && p.landingHtml.includes('Market Opportunity Report'));
});

test('a draft order can be created only for a published product', async () => {
  const order = await createOrder({
    productSlug: 'market-opportunity-report',
    customerEmail: `${MARK}@example.com`,
    requirements: { topic: 'AI bookkeeping for dental clinics' },
  });
  orderIds.push(order.id);
  assert.equal(order.status, 'CREATED');
  assert.equal(Number(order.amountUsd), 149);

  await assert.rejects(
    () => createOrder({ productSlug: 'competitor-white-space-scan' }),
    /not available/,
    'a DRAFT product cannot be ordered',
  );
});

test('markPaid flips the order to PAID and enqueues delivery exactly once', async () => {
  const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: 'x' } });
  orderIds.push(order.id);
  const key = `${MARK}:deliver:${order.id}`;

  const first = await markPaid({ orderId: order.id, sessionId: `${MARK}_cs`, amountUsd: 149, idempotencyKey: key });
  assert.equal(first.alreadyPaid, false);
  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row?.status, 'PAID');
  assert.ok(row?.paidAt);

  const second = await markPaid({ orderId: order.id, idempotencyKey: key });
  assert.equal(second.alreadyPaid, true, 'a replay does not re-activate');
  const tasks = await prisma.task.count({ where: { idempotencyKey: key } });
  assert.equal(tasks, 1, 'delivery is enqueued exactly once');
});

test('delivery refuses an order that is not paid', async () => {
  const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: 'unpaid' } });
  orderIds.push(order.id);
  await assert.rejects(() => deliverOrder(order.id, { scan: async (t) => fakeDemand(t) }), /only a PAID order/);
});

test('delivery of a paid order produces a validated artifact and marks DELIVERED', async () => {
  const order = await createOrder({
    productSlug: 'market-opportunity-report',
    customerEmail: `${MARK}@example.com`,
    requirements: { topic: 'invoice reconciliation for freelance designers' },
  });
  orderIds.push(order.id);
  await markPaid({ orderId: order.id, idempotencyKey: `${MARK}:deliver:${order.id}` });

  const res = await deliverOrder(order.id, {
    scan: async (t) => fakeDemand(t),
    summarize: async (t) => `Public signals for ${t} show interest only, not proven willingness to pay.`,
  });
  assert.equal(res.ok, true);

  const artifact = await prisma.deliveryArtifact.findUnique({ where: { id: res.artifactId } });
  assert.ok(artifact);
  assert.equal(artifact!.validated, true);
  const report = JSON.parse(artifact!.ref ?? '{}');
  assert.ok(report.demand.sources.length > 0, 'the report cites real sources');
  assert.ok(report.notProven.length > 0, 'the report states what is not proven');

  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row?.status, 'DELIVERED');
  assert.ok(row?.deliveredAt);

  // Idempotent re-delivery does not create a second artifact.
  const before = await prisma.deliveryArtifact.count({ where: { orderId: order.id } });
  await deliverOrder(order.id, { scan: async (t) => fakeDemand(t) });
  const after = await prisma.deliveryArtifact.count({ where: { orderId: order.id } });
  assert.equal(before, after);
});

test('a report missing sources fails QA', () => {
  const empty = { ...fakeDemand('x'), signals: [] } as DemandScan;
  const report = buildReport('x', empty, 'summary');
  const qa = validateReport(report, []);
  assert.equal(qa.ok, false, 'no sources => not valid');
});

test('Stripe classification: live checkout with an order ref is revenue', () => {
  const d = classifyStripeEvent({
    id: 'evt_live_1',
    type: 'checkout.session.completed',
    livemode: true,
    data: { object: { id: 'cs_live_1', amount_total: 14900, client_reference_id: 'order-123' } },
  });
  assert.equal(d.action, 'revenue');
  if (d.action === 'revenue') {
    assert.equal(d.amountUsd, 149);
    assert.equal(d.orderRef, 'order-123');
  }
});

test('Stripe classification: a test-mode completion is never revenue', () => {
  const d = classifyStripeEvent({ id: 'evt_test_1', type: 'checkout.session.completed', livemode: false, data: { object: { amount_total: 14900 } } });
  assert.equal(d.action, 'test');
});

test('commercial overview is derived from real records', async () => {
  const ov = await commercialOverview();
  assert.ok(ov.products.length >= 1);
  assert.ok(ov.products.some((p) => p.published));
  assert.equal(typeof ov.ordersTotal, 'number');
  assert.ok(ov.deliveries.validated >= 1, 'at least one validated artifact exists from the delivery test');
  assert.equal(typeof ov.revenue.grossUsd, 'number');
});
