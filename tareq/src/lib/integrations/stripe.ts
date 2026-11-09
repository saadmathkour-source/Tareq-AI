import { hasSecret } from '../env.ts';
import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { recordRevenue, record } from '../finance/ledger.ts';
import { markPaid } from '../commercial/orders.ts';
import { logger } from '../core/logger.ts';

/**
 * Stripe adapter (section 20).
 *
 * Two independent halves:
 *  - `createTestPaymentLink()` uses the Stripe API to create a real, payable
 *    checkout link (test mode when the key is `sk_test_…`).
 *  - `handleWebhook()` verifies a `checkout.session.completed` event's signature
 *    and only then records REVENUE_CONFIRMED, keyed by the Stripe event id so a
 *    replayed webhook cannot double-count.
 *
 * Money is recorded ONLY from a signature-verified webhook — never from a link
 * being created, opened or returned by the browser.
 */

export interface StripeStatus {
  configured: boolean;
  mode: 'test' | 'live' | 'none';
  webhookConfigured: boolean;
}

export function status(): StripeStatus {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return {
    configured: key.length > 0,
    mode: key.startsWith('sk_live') ? 'live' : key.startsWith('sk_test') ? 'test' : key ? 'live' : 'none',
    webhookConfigured: hasSecret('STRIPE_WEBHOOK_SECRET'),
  };
}

export interface PaymentLinkResult {
  ok: boolean;
  url?: string;
  id?: string;
  mode?: 'test' | 'live';
  reason?: string;
}

/** Create a Stripe Checkout payment link for a one-off price. */
export async function createTestPaymentLink(input: {
  amountUsd: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId?: string;
}): Promise<PaymentLinkResult> {
  const st = status();
  if (!st.configured) return { ok: false, reason: 'Stripe not configured (missing: STRIPE_SECRET_KEY)' };
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(input.amountUsd * 100)),
    'line_items[0][price_data][product_data][name]': input.productName,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (input.clientReferenceId) body.set('client_reference_id', input.clientReferenceId);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) return { ok: false, reason: data.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, url: data.url, id: data.id, mode: st.mode === 'none' ? undefined : st.mode };
}

export interface WebhookResult {
  handled: boolean;
  recorded: boolean;
  reason?: string;
  amountUsd?: number;
}

/** Tolerance (USD) when comparing a Stripe amount to the stored order amount. */
const AMOUNT_TOLERANCE_USD = 0.01;

/**
 * Pure classification of a verified Stripe event, so the revenue rules can be
 * unit-tested without a database. `livemode` is authoritative: a test-mode
 * payment is never revenue, whatever the key prefix says.
 *
 * Classification is deliberately strict for `checkout.session.completed`: money
 * is only ever recognised when `payment_status === 'paid'`. Async payment
 * methods that complete later (`checkout.session.async_payment_succeeded`) are
 * treated the same way. A session that completed without being paid is ignored
 * (it stays outstanding) rather than counted.
 */
export type StripeEventAction =
  | { action: 'revenue'; amountUsd: number; externalId: string; orderRef?: string; currency: string }
  | { action: 'test'; amountUsd: number; externalId: string; orderRef?: string; currency: string }
  | { action: 'failed'; amountUsd: number; externalId: string }
  | { action: 'refund'; amountUsd: number; externalId: string; orderRef?: string; refunded: boolean }
  | { action: 'dispute'; amountUsd: number; externalId: string; orderRef?: string }
  | { action: 'ignore'; reason: string };

const REFUND_EVENTS = new Set(['charge.refunded', 'charge.refund.updated', 'refund.updated']);
const DISPUTE_EVENTS = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);

export function classifyStripeEvent(event: { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } }): StripeEventAction {
  const session = event.data?.object ?? {};
  const amountUsd = Number(session['amount_total'] ?? session['amount'] ?? 0) / 100;
  const currency = typeof session['currency'] === 'string' ? (session['currency'] as string).toLowerCase() : 'usd';
  const externalId = String(event.id ?? session['id'] ?? '');
  if (!externalId) return { action: 'ignore', reason: 'event has no id' };
  const orderRef = typeof session['client_reference_id'] === 'string' ? (session['client_reference_id'] as string) : undefined;

  if (event.type === 'payment_intent.payment_failed' || event.type === 'checkout.session.async_payment_failed') {
    return { action: 'failed', amountUsd, externalId };
  }

  if (event.type && REFUND_EVENTS.has(event.type)) {
    const refunded = session['refunded'] === true || session['amount_refunded'] != null;
    const refundedUsd = Number(session['amount_refunded'] ?? session['amount'] ?? 0) / 100;
    return { action: 'refund', amountUsd: refundedUsd, externalId, orderRef, refunded };
  }

  if (event.type && DISPUTE_EVENTS.has(event.type)) {
    const disputedUsd = Number(session['amount'] ?? 0) / 100;
    return { action: 'dispute', amountUsd: disputedUsd, externalId, orderRef };
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { action: 'ignore', reason: `ignored event type ${event.type}` };
  }

  // A completed session that is not actually paid must never be recognised.
  const paymentStatus = session['payment_status'];
  if (paymentStatus !== undefined && paymentStatus !== 'paid') {
    return { action: 'ignore', reason: `session not paid (payment_status=${String(paymentStatus)})` };
  }

  if (event.livemode !== true) return { action: 'test', amountUsd, externalId, orderRef, currency };
  return { action: 'revenue', amountUsd, externalId, orderRef, currency };
}

/**
 * Resolve the internal order a verified event refers to. The trusted reference
 * is the Checkout Session's `client_reference_id` (set to the order id when the
 * link was created). Refund/dispute events, which describe a charge rather than
 * a session, are matched by the stored PaymentIntent id instead.
 */
async function findOrderForEvent(
  orderRef: string | undefined,
  session: Record<string, unknown>,
): Promise<{ id: string; amountUsd: number; currency: string; status: string; stripePaymentIntentId: string | null } | null> {
  const shape = (o: { id: string; amountUsd: unknown; currency: string; status: string; stripePaymentIntentId: string | null }) => ({
    id: o.id,
    amountUsd: Number(o.amountUsd),
    currency: o.currency,
    status: o.status,
    stripePaymentIntentId: o.stripePaymentIntentId,
  });
  if (orderRef) {
    const byRef = await prisma.order.findUnique({ where: { id: orderRef } });
    if (byRef) return shape(byRef);
  }
  const pi = typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined;
  if (pi) {
    const byPi = await prisma.order.findFirst({ where: { stripePaymentIntentId: pi } });
    if (byPi) return shape(byPi);
  }
  return null;
}

/**
 * Activate a product order from a verified, paid session. Consistency is
 * enforced before the transition: the order must exist, the currency must match
 * and the amount must match to within a cent. A mismatch is logged and audited
 * and the order is NOT marked paid (so no delivery is triggered); the collected
 * money is still recorded by the caller, because it is real.
 */
async function activateOrder(
  order: { id: string; amountUsd: number; currency: string; status: string },
  session: Record<string, unknown>,
  amountUsd: number,
  currency: string,
  deliveryKeyPrefix?: string,
): Promise<{ activated: boolean; reason: string }> {
  if (['PAID', 'IN_DELIVERY', 'DELIVERED'].includes(order.status)) {
    return { activated: true, reason: 'already activated' };
  }
  if (order.currency.toLowerCase() !== currency.toLowerCase()) {
    logger.error('webhook currency mismatch; order not activated', { orderId: order.id, orderCurrency: order.currency, paymentCurrency: currency });
    await audit({ actorType: 'system', action: 'stripe.currency_mismatch', target: order.id, severity: 'error', metadata: { orderCurrency: order.currency, paymentCurrency: currency } });
    return { activated: false, reason: 'currency mismatch' };
  }
  if (Math.abs(Number(order.amountUsd) - amountUsd) > AMOUNT_TOLERANCE_USD) {
    logger.error('webhook amount mismatch; order not activated', { orderId: order.id, orderAmountUsd: Number(order.amountUsd), paymentAmountUsd: amountUsd });
    await audit({ actorType: 'system', action: 'stripe.amount_mismatch', target: order.id, severity: 'error', metadata: { orderAmountUsd: Number(order.amountUsd), paymentAmountUsd: amountUsd } });
    return { activated: false, reason: 'amount mismatch' };
  }

  const customerEmail =
    (session['customer_details'] as { email?: string } | undefined)?.email ??
    (typeof session['customer_email'] === 'string' ? (session['customer_email'] as string) : undefined);
  await markPaid({
    orderId: order.id,
    sessionId: typeof session['id'] === 'string' ? (session['id'] as string) : undefined,
    paymentIntentId: typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined,
    amountUsd,
    ...(deliveryKeyPrefix ? { idempotencyKey: `${deliveryKeyPrefix}order.deliver:${order.id}` } : {}),
  });
  if (customerEmail) {
    await prisma.order.update({ where: { id: order.id }, data: { customerEmail } });
  }
  logger.info('order activated from verified payment', { orderId: order.id, amountUsd });
  return { activated: true, reason: 'activated' };
}

/** Mark the order behind a refunded/disputed charge as REFUNDED. Idempotent. */
async function markOrderRefunded(orderId: string, eventId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status === 'REFUNDED' || order.status === 'CANCELLED') return;
  await prisma.order.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });
  await audit({ actorType: 'system', action: 'order.refunded', target: orderId, severity: 'warn', metadata: { eventId } });
}

/**
 * Handle a raw Stripe webhook body. Verifies the signature, then records the
 * effect exactly once per Stripe event id.
 *
 * Signature verification follows Stripe's scheme: HMAC-SHA256 over
 * `${timestamp}.${payload}` with the webhook secret, compared in constant time.
 * Implemented with node:crypto so no Stripe SDK is required.
 *
 * Idempotency is durable and independent of any single table: the ledger's
 * unique `externalId`, `markPaid`'s status guard and the delivery task's
 * idempotency key each prevent duplicates, so a replayed or retried webhook can
 * never double-record revenue, double-activate an order or double-deliver —
 * even if the process died midway through a previous attempt.
 */
export async function handleWebhook(rawBody: string, signatureHeader: string, opts: { deliveryKeyPrefix?: string } = {}): Promise<WebhookResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { handled: false, recorded: false, reason: 'webhook secret not configured' };

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return { handled: false, recorded: false, reason: 'malformed signature header' };

  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { handled: false, recorded: false, reason: 'signature verification failed' };
  }

  let event: { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { handled: false, recorded: false, reason: 'invalid JSON' };
  }

  const decision = classifyStripeEvent(event);
  if (decision.action === 'ignore') {
    return { handled: true, recorded: false, reason: decision.reason };
  }

  const { amountUsd, externalId } = decision;
  const session = event.data?.object ?? {};

  // Durable idempotency: an externalId already in the ledger means this event's
  // ledger effect is already recorded. Side effects that must still be repaired
  // (an order left unpaid by a mid-flight crash) are re-run idempotently below.
  const existing = await prisma.ledgerEntry.findUnique({ where: { externalId } });

  if (decision.action === 'failed') {
    if (!existing) {
      await record({
        kind: 'PAYMENT_FAILED',
        amountUsd,
        provider: 'stripe',
        externalId,
        evidence: { webhookEventId: event.id, signatureVerified: true, reason: session['last_payment_error'] ?? null },
      });
      logger.warn('stripe payment failed', { eventId: event.id, amountUsd });
    }
    return { handled: true, recorded: false, reason: 'payment failed', amountUsd };
  }

  // Test-mode payments are recorded for the audit trail but are NOT revenue and
  // never activate an order.
  if (decision.action === 'test') {
    if (!existing) {
      await record({
        kind: 'TEST_TRANSACTION',
        amountUsd,
        provider: 'stripe',
        externalId,
        evidence: { webhookEventId: event.id, sessionId: session['id'], amountUsd, orderRef: decision.orderRef, signatureVerified: true, mode: 'test' },
      });
      logger.info('stripe TEST transaction recorded (not revenue)', { eventId: event.id, amountUsd });
    }
    return { handled: true, recorded: false, reason: 'test-mode payment recorded as TEST_TRANSACTION, not revenue', amountUsd };
  }

  if (decision.action === 'refund') {
    if (!existing) {
      await record({
        kind: 'REFUND',
        amountUsd: decision.amountUsd,
        provider: 'stripe',
        externalId,
        evidence: { webhookEventId: event.id, chargeId: session['id'], orderRef: decision.orderRef, refunded: decision.refunded, signatureVerified: true },
      });
      logger.warn('stripe refund recorded (reduces net revenue)', { eventId: event.id, amountUsd: decision.amountUsd });
    }
    const order = await findOrderForEvent(decision.orderRef, session);
    if (order) await markOrderRefunded(order.id, String(event.id));
    return { handled: true, recorded: !existing, reason: 'refund recorded', amountUsd: decision.amountUsd };
  }

  if (decision.action === 'dispute') {
    if (!existing) {
      await record({
        kind: 'DISPUTE',
        amountUsd: decision.amountUsd,
        provider: 'stripe',
        externalId,
        evidence: { webhookEventId: event.id, disputeId: session['id'], orderRef: decision.orderRef, status: session['status'], signatureVerified: true },
      });
      logger.warn('stripe dispute recorded (reduces net revenue)', { eventId: event.id, amountUsd: decision.amountUsd });
    }
    const order = await findOrderForEvent(decision.orderRef, session);
    if (order) await markOrderRefunded(order.id, String(event.id));
    return { handled: true, recorded: !existing, reason: 'dispute recorded', amountUsd: decision.amountUsd };
  }

  // action === 'revenue'
  if (!existing) {
    await recordRevenue({
      amountUsd,
      externalId,
      provider: 'stripe',
      evidence: { webhookEventId: event.id, sessionId: session['id'], amountUsd, currency: decision.currency, orderRef: decision.orderRef, signatureVerified: true, livemode: true },
    });
    // Stripe's own fee is a separate ledger kind, estimated at 2.9% + $0.30.
    const feeId = `${externalId}:fee`;
    if (!(await prisma.ledgerEntry.findUnique({ where: { externalId: feeId } }))) {
      await record({
        kind: 'FEE',
        amountUsd: Number((amountUsd * 0.029 + 0.3).toFixed(4)),
        provider: 'stripe',
        externalId: feeId,
        evidence: { note: 'estimated Stripe processing fee' },
      });
    }
    logger.info('stripe revenue recorded', { eventId: event.id, amountUsd });
  }

  // Activate the matching order. Runs on every attempt (not only the first) so a
  // crash between recording revenue and activating the order cannot strand a
  // paying customer; `markPaid` is idempotent, so retries never double-activate
  // or double-deliver.
  let activated: { activated: boolean; reason: string } | null = null;
  if (decision.orderRef) {
    const order = await findOrderForEvent(decision.orderRef, session);
    if (order) {
      activated = await activateOrder(order, session, amountUsd, decision.currency, opts.deliveryKeyPrefix);
    } else {
      logger.warn('verified payment had no matching order', { ref: decision.orderRef });
    }
  }

  return {
    handled: true,
    recorded: !existing,
    reason: activated && !activated.activated ? `revenue recorded; order not activated (${activated.reason})` : undefined,
    amountUsd,
  };
}
