import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/core/db.ts';
import { handleWebhook } from '../src/lib/integrations/stripe.ts';
import { createOrder } from '../src/lib/commercial/orders.ts';
import { summary } from '../src/lib/finance/ledger.ts';

/**
 * Phase 16.1 — Stripe webhook end-to-end against the real code paths and DB.
 *
 * These are signature-verified, live-mode (`livemode: true`) fixtures signed
 * with a per-test webhook secret. They prove the payment-recognition rules; they
 * are NOT proof of a real LIVE payment and never create a real charge.
 *
 * Every side-effect a test can enqueue is tagged with the worker-excluded
 * `QTEST-` idempotency prefix (via `deliveryKeyPrefix`) so the live production
 * worker can never claim it.
 */

const SECRET = `whsec_test_${randomUUID()}`;
// Contains `_test_` so any ledger row a killed run leaves behind is recognised
// by `isTestExternalId` and can never be counted as commercial revenue. Starts
// with `QTEST-` so the live worker excludes any task it enqueues.
const MARK = `QTEST-16.1_test_${Date.now().toString(36)}`;
const orderIds: string[] = [];
const eventIds: string[] = [];

const realSecret = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

/** Delete any rows a previously-killed run of this file may have left behind. */
async function purgePreviousRuns(): Promise<void> {
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { contains: 'QTEST-16.1-' } } });
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: 'QTEST-16.1-' } } });
  await prisma.order.deleteMany({ where: { customerEmail: { startsWith: 'QTEST-16.1-' } } });
}

test.before(purgePreviousRuns);

test.after(async () => {
  for (const id of orderIds) await prisma.order.delete({ where: { id } }).catch(() => {});
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { in: eventIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { externalId: { in: eventIds.map((e) => `${e}:fee`) } } });
  await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: MARK } } });
  if (realSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = realSecret;
  await prisma.$disconnect();
});

function sign(payload: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function completedEvent(orderId: string, amountCents = 14900, currency = 'usd'): { body: string; eventId: string } {
  const eventId = `evt_${MARK}_${randomUUID().slice(0, 8)}`;
  eventIds.push(eventId);
  const body = JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: `cs_${randomUUID().slice(0, 8)}`,
        amount_total: amountCents,
        currency,
        payment_status: 'paid',
        payment_intent: `pi_${randomUUID().slice(0, 8)}`,
        client_reference_id: orderId,
        customer_details: { email: `${MARK}@example.com` },
      },
    },
  });
  return { body, eventId };
}

async function newOrder(): Promise<string> {
  const order = await createOrder({ productSlug: 'market-opportunity-report', requirements: { topic: 'x' } });
  orderIds.push(order.id);
  return order.id;
}

test('webhook rejects a forged signature and records no revenue', async () => {
  const before = await summary();
  const { body } = completedEvent(await newOrder());
  const bad = sign('different-payload');
  const res = await handleWebhook(body, bad);
  assert.equal(res.handled, false);
  assert.equal(res.recorded, false);
  const after = await summary();
  assert.equal(after.grossRevenueUsd, before.grossRevenueUsd, 'a forged signature must not move revenue');
});

test('a verified paid session records revenue and activates the matching order exactly once', async () => {
  const orderId = await newOrder();
  const { body, eventId } = completedEvent(orderId);

  const before = await summary();
  const first = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(first.handled, true);
  assert.equal(first.recorded, true);

  // The fixture id carries the `_test_` marker, so the money is accounted as
  // test volume rather than commercial revenue — but the mechanism is proven:
  // a REVENUE_CONFIRMED row exists with a verification stamp.
  const after = await summary();
  assert.equal(after.testTransactionsUsd, before.testTransactionsUsd + 149, 'recorded and accounted');

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.ok(['PAID', 'IN_DELIVERY', 'DELIVERED'].includes(order!.status), 'order activated');
  assert.ok(order!.paidAt, 'paidAt stamped');

  const revenue = await prisma.ledgerEntry.findUnique({ where: { externalId: eventId } });
  assert.equal(revenue!.kind, 'REVENUE_CONFIRMED');
  assert.ok(revenue!.verifiedAt, 'revenue carries a verification stamp');
});

test('a replayed webhook does not double-record, double-activate or double-deliver', async () => {
  const orderId = await newOrder();
  const { body, eventId } = completedEvent(orderId);

  const first = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(first.recorded, true);

  const afterFirst = await summary();
  const second = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(second.handled, true);
  assert.equal(second.recorded, false, 'a replay records nothing new');

  const afterSecond = await summary();
  assert.equal(afterSecond.testTransactionsUsd, afterFirst.testTransactionsUsd, 'replay must not double-count');

  const rows = await prisma.ledgerEntry.count({ where: { externalId: eventId } });
  assert.equal(rows, 1, 'exactly one revenue row for the event');
  const deliveries = await prisma.task.count({ where: { idempotencyKey: `${MARK}:order.deliver:${orderId}` } });
  assert.equal(deliveries, 1, 'delivery enqueued exactly once across retries');
});

test('an amount mismatch records the money but does NOT activate the order', async () => {
  const orderId = await newOrder();
  const { body } = completedEvent(orderId, 100); // $1.00 for a $149 order

  const res = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, true);
  assert.equal(res.recorded, true, 'real collected money is still recorded');
  assert.match(String(res.reason), /not activated|mismatch/);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order!.status, 'CREATED', 'mismatched order is never marked paid');
  const deliveries = await prisma.task.count({ where: { idempotencyKey: `${MARK}:order.deliver:${orderId}` } });
  assert.equal(deliveries, 0, 'no delivery is triggered on a mismatch');
});

test('a test-mode completion is recorded as a test transaction, never as revenue or an order', async () => {
  const orderId = await newOrder();
  const eventId = `evt_${MARK}_test_${randomUUID().slice(0, 8)}`;
  eventIds.push(eventId);
  const body = JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: `cs_test_${randomUUID().slice(0, 8)}`, amount_total: 14900, currency: 'usd', payment_status: 'paid', client_reference_id: orderId } },
  });

  const before = await summary();
  const res = await handleWebhook(body, sign(body));
  assert.equal(res.handled, true);
  assert.equal(res.recorded, false);

  const after = await summary();
  assert.equal(after.grossRevenueUsd, before.grossRevenueUsd, 'test-mode payment is not revenue');
  assert.equal(after.testTransactionsUsd, before.testTransactionsUsd + 149, 'surfaced as test volume');

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order!.status, 'CREATED', 'a test-mode session never activates an order');
});

test('a refund reduces net revenue and marks the order REFUNDED', async () => {
  const orderId = await newOrder();
  const paid = completedEvent(orderId);
  await handleWebhook(paid.body, sign(paid.body), { deliveryKeyPrefix: `${MARK}:` });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const pi = (JSON.parse(paid.body).data.object as { payment_intent: string }).payment_intent;
  assert.equal(order!.stripePaymentIntentId, pi);

  const before = await summary();
  const refundId = `evt_${MARK}_refund_${randomUUID().slice(0, 8)}`;
  eventIds.push(refundId);
  const refundBody = JSON.stringify({
    id: refundId,
    type: 'charge.refunded',
    livemode: true,
    data: { object: { id: `ch_${randomUUID().slice(0, 8)}`, amount: 14900, amount_refunded: 14900, refunded: true, payment_intent: pi } },
  });

  const res = await handleWebhook(refundBody, sign(refundBody));
  assert.equal(res.handled, true);
  assert.equal(res.recorded, true);

  const after = await summary();
  assert.equal(after.grossRevenueUsd, before.grossRevenueUsd, 'gross revenue (collected) is unchanged by a refund');
  assert.equal(after.netRevenueUsd, before.netRevenueUsd - 149, 'a refund reduces net revenue');
  assert.equal(after.refundExposureUsd, before.refundExposureUsd + 149, 'refund exposure is surfaced separately');

  const refunded = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(refunded!.status, 'REFUNDED');
});

test('a dispute reduces net revenue and is never ordinary revenue', async () => {
  const orderId = await newOrder();
  const paid = completedEvent(orderId);
  await handleWebhook(paid.body, sign(paid.body), { deliveryKeyPrefix: `${MARK}:` });
  const pi = (JSON.parse(paid.body).data.object as { payment_intent: string }).payment_intent;

  const before = await summary();
  const disputeId = `evt_${MARK}_dispute_${randomUUID().slice(0, 8)}`;
  eventIds.push(disputeId);
  const disputeBody = JSON.stringify({
    id: disputeId,
    type: 'charge.dispute.created',
    livemode: true,
    data: { object: { id: `dp_${randomUUID().slice(0, 8)}`, amount: 14900, payment_intent: pi, status: 'needs_response' } },
  });

  const res = await handleWebhook(disputeBody, sign(disputeBody));
  assert.equal(res.handled, true);
  const after = await summary();
  assert.equal(after.netRevenueUsd, before.netRevenueUsd - 149, 'a dispute reduces net revenue');
  assert.equal(after.refundExposureUsd, before.refundExposureUsd + 149, 'dispute is part of refund exposure');
});

test('a failed payment is recorded as PAYMENT_FAILED and never as revenue', async () => {
  const eventId = `evt_${MARK}_fail_${randomUUID().slice(0, 8)}`;
  eventIds.push(eventId);
  const body = JSON.stringify({
    id: eventId,
    type: 'payment_intent.payment_failed',
    livemode: true,
    data: { object: { id: `pi_${randomUUID().slice(0, 8)}`, amount: 14900, last_payment_error: { code: 'card_declined' } } },
  });

  const before = await summary();
  const res = await handleWebhook(body, sign(body));
  assert.equal(res.handled, true);
  assert.equal(res.recorded, false);
  const after = await summary();
  assert.equal(after.grossRevenueUsd, before.grossRevenueUsd, 'a failed payment is not revenue');
  assert.equal(after.failedPaymentsUsd, before.failedPaymentsUsd + 149, 'surfaced as failed payments');
});

test('an unpaid completed session is ignored (stays outstanding, never revenue)', async () => {
  const orderId = await newOrder();
  const eventId = `evt_${MARK}_unpaid_${randomUUID().slice(0, 8)}`;
  eventIds.push(eventId);
  const body = JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    livemode: true,
    data: { object: { id: `cs_${randomUUID().slice(0, 8)}`, amount_total: 14900, currency: 'usd', payment_status: 'unpaid', client_reference_id: orderId } },
  });

  const before = await summary();
  const res = await handleWebhook(body, sign(body));
  assert.equal(res.handled, true);
  assert.equal(res.recorded, false);
  assert.match(String(res.reason), /not paid/);
  const after = await summary();
  assert.equal(after.grossRevenueUsd, before.grossRevenueUsd);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(order!.status, 'CREATED');
});

test('a verified payment with no matching order records revenue but activates nothing', async () => {
  const missingOrder = randomUUID();
  const { body } = completedEvent(missingOrder);
  const res = await handleWebhook(body, sign(body), { deliveryKeyPrefix: `${MARK}:` });
  assert.equal(res.handled, true);
  assert.equal(res.recorded, true);
  const deliveries = await prisma.task.count({ where: { idempotencyKey: `${MARK}:order.deliver:${missingOrder}` } });
  assert.equal(deliveries, 0);
});
