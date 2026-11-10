import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/core/db.ts';
import { MARKET_OPPORTUNITY_REPORT, seedProducts, listProducts, getPublishedProduct, publishProduct } from '../src/lib/commercial/products.ts';
import { renderLandingHtml, generateLanding } from '../src/lib/commercial/landing.ts';
import { createOrder, markPaid } from '../src/lib/commercial/orders.ts';
import { deliverOrder, buildReport, validateReport } from '../src/lib/commercial/delivery.ts';
import { classifyStripeEvent } from '../src/lib/integrations/stripe.ts';
import { commercialOverview } from '../src/lib/commercial/overview.ts';
import { getControls, setControls } from '../src/lib/security/controls.ts';
import { currentMode, setMode } from '../src/lib/security/permissions.ts';
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

/**
 * Remove any residue a previously-killed run of this file left in the shared
 * test database: delivery tasks, orders and their DELIVERY_COST ledger rows.
 * Keys are the broad `QTEST-16-` prefix so an earlier run's timestamp is caught.
 */
async function purgePreviousRuns(): Promise<void> {
  const stale = await prisma.order.findMany({ where: { customerEmail: { startsWith: 'QTEST-16-' } }, select: { id: true } });
  for (const o of stale) {
    await prisma.ledgerEntry.deleteMany({ where: { kind: 'DELIVERY_COST', evidence: { path: ['orderId'], equals: o.id } } });
  }
  await prisma.order.deleteMany({ where: { customerEmail: { startsWith: 'QTEST-16-' } } });
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: 'QTEST-16-' } } });
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { contains: 'QTEST-16-' } } });
  // Gate products from the publish-control tests (created with the QTEST-16- prefix).
  await prisma.product.deleteMany({ where: { slug: { startsWith: 'QTEST-16-' } } });
}

test.before(purgePreviousRuns);

test.after(async () => {
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: MARK } } });
  for (const id of orderIds) {
    await prisma.ledgerEntry.deleteMany({ where: { kind: 'DELIVERY_COST', evidence: { path: ['orderId'], equals: id } } });
    await prisma.order.delete({ where: { id } }).catch(() => {});
  }
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

/**
 * A throwaway DRAFT product for the publish-gate tests, so they never change the
 * real catalog row's status (other files depend on it being PUBLISHED).
 */
const GATE_SLUG = `${MARK}-gate-product`;

async function withGateProduct<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.product.create({
    data: {
      slug: GATE_SLUG,
      name: 'Gate Test Product',
      tagline: 't',
      problem: 'p',
      solution: 's',
      deliverables: [] as never,
      deliverySteps: [] as never,
      requirements: [] as never,
      limitations: [] as never,
      qaChecklist: [] as never,
      priceUsd: 10,
      costUsd: 1,
      marginPct: 90,
      status: 'DRAFT',
      claimRefs: [] as never,
    },
  });
  try {
    return await fn();
  } finally {
    await prisma.product.deleteMany({ where: { slug: GATE_SLUG } });
  }
}

test('the catalog seeds every product as DRAFT — seeding never publishes', async () => {
  // Deterministic proof, independent of shared-DB state left by other files:
  //   (a) the create path writes DRAFT, and
  //   (b) seeding never CHANGES an existing product's status.
  // Together these mean seeding can never introduce a PUBLISHED product.
  const before = await listProducts(false);
  const statusBefore = new Map(before.map((p) => [p.slug, p.status]));

  // Remove one candidate so the create path is exercised for a missing row.
  const candidate = 'competitor-white-space-scan';
  await prisma.product.deleteMany({ where: { slug: candidate } });

  const n = await seedProducts();
  assert.ok(n >= 1);

  const after = await listProducts(false);
  const recreated = after.find((p) => p.slug === candidate);
  assert.ok(recreated, 'the removed candidate is re-seeded');
  assert.equal(recreated!.status, 'DRAFT', 'a freshly seeded product is DRAFT, never PUBLISHED');

  // No product that existed before seeding changed status because of seeding.
  for (const [slug, status] of statusBefore) {
    const now = after.find((p) => p.slug === slug);
    if (now) assert.equal(now.status, status, `seeding must not change the status of ${slug}`);
  }

  const again = await seedProducts();
  assert.equal(again, n, 'seeding is idempotent');
});

test('publishing is refused while the publishingAllowed control is off (default)', async () => {
  const original = await getControls();
  try {
    await setControls({ publishingAllowed: false, emergencyStop: false }, 'test');
    await withGateProduct(async () => {
      await assert.rejects(
        () => publishProduct(GATE_SLUG, { actorType: 'owner' }),
        /not permitted by the owner controls/,
        'the owner control must block publishing even for an owner',
      );
      const row = await prisma.product.findUniqueOrThrow({ where: { slug: GATE_SLUG } });
      assert.equal(row.status, 'DRAFT', 'a refused publish must leave the product as DRAFT');
    });
  } finally {
    await setControls({ publishingAllowed: original.publishingAllowed }, 'test');
  }
});

test('an autonomous actor cannot publish even when publishing is allowed (approval required)', async () => {
  const original = await getControls();
  const prevMode = await currentMode();
  try {
    // Reach the approval gate, not the mode gate: an autonomous run only gets
    // this far in SUPERVISED/AUTONOMOUS mode. The point is that even then, an
    // agent with no approved offer.publish approval is refused.
    await setMode('SUPERVISED', 'test');
    await setControls({ publishingAllowed: true, emergencyStop: false }, 'test');
    await withGateProduct(async () => {
      await assert.rejects(() => publishProduct(GATE_SLUG, { actorType: 'agent' }), /approval/i);
      const row = await prisma.product.findUniqueOrThrow({ where: { slug: GATE_SLUG } });
      assert.equal(row.status, 'DRAFT', 'an unapproved autonomous publish must not go live');
    });
  } finally {
    await setMode(prevMode, 'test');
    await setControls({ publishingAllowed: original.publishingAllowed }, 'test');
  }
});

test('the emergency stop blocks publishing', async () => {
  const original = await getControls();
  try {
    await setControls({ publishingAllowed: true, emergencyStop: true }, 'test');
    await withGateProduct(async () => {
      await assert.rejects(() => publishProduct(GATE_SLUG, { actorType: 'owner' }), /emergency stop/);
    });
  } finally {
    await setControls({ publishingAllowed: original.publishingAllowed, emergencyStop: original.emergencyStop }, 'test');
  }
});

test('the owner can publish only when the control is on and the action is authorised', async () => {
  const original = await getControls();
  try {
    await setControls({ publishingAllowed: true, emergencyStop: false }, 'test');
    await withGateProduct(async () => {
      await publishProduct(GATE_SLUG, { actorType: 'owner', actorId: 'test-owner' });
      const row = await prisma.product.findUniqueOrThrow({ where: { slug: GATE_SLUG } });
      assert.equal(row.status, 'PUBLISHED', 'an authorised publish goes live');
    });
  } finally {
    await setControls({ publishingAllowed: original.publishingAllowed }, 'test');
  }
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

test('replayed payment recreates a delivery task missing after a worker crash, once', async () => {
  const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: 'recover' } });
  orderIds.push(order.id);
  const key = `${MARK}:deliver-recovered:${order.id}`;
  // Simulate the exact crash window: PAID committed, but the worker queue has
  // not yet received its task. No Stripe API or real payment is used.
  await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
  assert.equal(await prisma.task.count({ where: { idempotencyKey: key } }), 0);
  const restored = await markPaid({ orderId: order.id, idempotencyKey: key });
  assert.equal(restored.alreadyPaid, true);
  assert.ok(restored.deliveryTaskId);
  assert.equal(await prisma.task.count({ where: { idempotencyKey: key } }), 1);
  const again = await markPaid({ orderId: order.id, idempotencyKey: key });
  assert.equal(again.deliveryTaskId, restored.deliveryTaskId);
  assert.equal(await prisma.task.count({ where: { idempotencyKey: key } }), 1);
});

test('refunded and cancelled orders cannot be marked paid by replay', async () => {
  for (const terminal of ['REFUNDED', 'CANCELLED'] as const) {
    const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: terminal } });
    orderIds.push(order.id);
    await prisma.order.update({ where: { id: order.id }, data: { status: terminal } });
    const key = `${MARK}:terminal:${order.id}`;
    await assert.rejects(() => markPaid({ orderId: order.id, idempotencyKey: key }), /cannot reactivate/);
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(unchanged.status, terminal);
    assert.equal(await prisma.task.count({ where: { idempotencyKey: key } }), 0);
  }
});

test('delivery refuses an order that is not paid', async () => {
  const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: 'unpaid' } });
  orderIds.push(order.id);
  await assert.rejects(() => deliverOrder(order.id, { scan: async (t) => fakeDemand(t) }), /only a PAID order/);
});

test('delivery of a paid order produces a validated artifact, emails the buyer and marks DELIVERED', async () => {
  const order = await createOrder({
    productSlug: 'market-opportunity-report',
    customerEmail: `${MARK}@example.com`,
    requirements: { topic: 'invoice reconciliation for freelance designers' },
  });
  orderIds.push(order.id);
  await markPaid({ orderId: order.id, idempotencyKey: `${MARK}:deliver:${order.id}` });

  // Phase 17: delivery now includes emailing the buyer. Inject the sender so the
  // test needs no network and asserts the message was actually produced.
  let sent = false;
  const res = await deliverOrder(order.id, {
    scan: async (t) => fakeDemand(t),
    summarize: async (t) => `Public signals for ${t} show interest only, not proven willingness to pay.`,
    sendEmail: async (input) => {
      sent = true;
      assert.match(input.text, /\/download\//);
      return { sent: true };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(sent, true);

  const artifact = await prisma.deliveryArtifact.findUnique({ where: { id: res.artifactId } });
  assert.ok(artifact);
  assert.equal(artifact!.validated, true);
  const report = JSON.parse(artifact!.ref ?? '{}');
  assert.ok(report.demand.sources.length > 0, 'the report cites real sources');
  assert.ok(report.notProven.length > 0, 'the report states what is not proven');

  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row?.status, 'DELIVERED');
  assert.ok(row?.deliveredAt);

  // Idempotent re-delivery does not create a second artifact and does not resend.
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

test('flagship offer promises only the report the delivery engine creates', () => {
  const offerCopy = [MARKET_OPPORTUNITY_REPORT.tagline, MARKET_OPPORTUNITY_REPORT.problem, MARKET_OPPORTUNITY_REPORT.solution,
    ...MARKET_OPPORTUNITY_REPORT.deliverables, ...MARKET_OPPORTUNITY_REPORT.deliverySteps].join(' ').toLowerCase();
  for (const unsupported of ['pdf-ready', 'competitor analysis', 'pricing benchmark', 'scored shortlist', 'white space']) {
    assert.equal(offerCopy.includes(unsupported), false, `offer must not promise unsupported ${unsupported}`);
  }
  assert.match(offerCopy, /hacker news/);
  assert.match(offerCopy, /wikipedia/);
  assert.match(offerCopy, /structured report/);
});

test('delivery QA checks the declared source and evidence limitations', () => {
  const report = buildReport('x', fakeDemand('x'), 'summary');
  const checklist = [...MARKET_OPPORTUNITY_REPORT.qaChecklist];
  assert.equal(validateReport(report, checklist).ok, true);

  const malformed = { ...report, demand: { ...report.demand, sources: [{ ...report.demand.sources[0]!, url: 'javascript:alert(1)' }] } };
  assert.equal(validateReport(malformed, checklist).ok, false, 'invalid source URL must fail QA');
  assert.equal(validateReport(report, ['Unrecognized product claim']).ok, false, 'unknown QA requirements fail closed');
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
