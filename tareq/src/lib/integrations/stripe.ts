import { hasSecret } from '../env.ts';
import { prisma } from '../core/db.ts';
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

/**
 * Pure classification of a verified Stripe event, so the revenue rules can be
 * unit-tested without a database. `livemode` is authoritative: a test-mode
 * payment is never revenue, whatever the key prefix says.
 */
export type StripeEventAction =
  | { action: 'revenue'; amountUsd: number; externalId: string; dealId?: string }
  | { action: 'test'; amountUsd: number; externalId: string; dealId?: string }
  | { action: 'failed'; amountUsd: number; externalId: string }
  | { action: 'ignore'; reason: string };

export function classifyStripeEvent(event: { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } }): StripeEventAction {
  const session = event.data?.object ?? {};
  const amountUsd = Number(session['amount_total'] ?? session['amount'] ?? 0) / 100;
  const externalId = String(event.id ?? session['id'] ?? '');
  if (!externalId) return { action: 'ignore', reason: 'event has no id' };
  const dealId = typeof session['client_reference_id'] === 'string' ? session['client_reference_id'] : undefined;

  if (event.type === 'payment_intent.payment_failed' || event.type === 'checkout.session.async_payment_failed') {
    return { action: 'failed', amountUsd, externalId };
  }
  if (event.type !== 'checkout.session.completed') {
    return { action: 'ignore', reason: `ignored event type ${event.type}` };
  }
  if (event.livemode !== true) return { action: 'test', amountUsd, externalId, dealId };
  return { action: 'revenue', amountUsd, externalId, dealId };
}

/**
 * Handle a raw Stripe webhook body. Verifies the signature, then records revenue
 * exactly once per Stripe event id.
 *
 * Signature verification follows Stripe's scheme: HMAC-SHA256 over
 * `${timestamp}.${payload}` with the webhook secret, compared in constant time.
 * Implemented with node:crypto so no Stripe SDK is required.
 */
export async function handleWebhook(rawBody: string, signatureHeader: string): Promise<WebhookResult> {
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

  // Idempotency: an externalId already in the ledger means this webhook was
  // already processed; do not record it twice.
  const existing = await prisma.ledgerEntry.findUnique({ where: { externalId } });
  if (existing) return { handled: true, recorded: false, reason: 'already recorded', amountUsd };

  if (decision.action === 'failed') {
    await record({
      kind: 'PAYMENT_FAILED',
      amountUsd,
      provider: 'stripe',
      externalId,
      evidence: { webhookEventId: event.id, signatureVerified: true, reason: event.data?.object?.['last_payment_error'] ?? null },
    });
    logger.warn('stripe payment failed', { eventId: event.id, amountUsd });
    return { handled: true, recorded: false, reason: 'payment failed', amountUsd };
  }

  // Test-mode payments are recorded for the audit trail but are NOT revenue.
  if (decision.action === 'test') {
    await record({
      kind: 'TEST_TRANSACTION',
      amountUsd,
      provider: 'stripe',
      externalId,
      dealId: decision.dealId,
      evidence: { webhookEventId: event.id, sessionId: event.data?.object?.['id'], amountUsd, signatureVerified: true, mode: 'test' },
    });
    logger.info('stripe TEST transaction recorded (not revenue)', { eventId: event.id, amountUsd });
    return { handled: true, recorded: false, reason: 'test-mode payment recorded as TEST_TRANSACTION, not revenue', amountUsd };
  }

  await recordRevenue({
    amountUsd,
    externalId,
    provider: 'stripe',
    dealId: decision.dealId,
    evidence: { webhookEventId: event.id, sessionId: event.data?.object?.['id'], amountUsd, signatureVerified: true, livemode: true },
  });
  // Stripe's own fee is a separate ledger kind, estimated at 2.9% + $0.30.
  await record({
    kind: 'FEE',
    amountUsd: Number((amountUsd * 0.029 + 0.3).toFixed(4)),
    provider: 'stripe',
    externalId: `${externalId}:fee`,
    evidence: { note: 'estimated Stripe processing fee' },
  });

  // Activate a product order if this checkout carried one as its reference.
  // This is the ONLY place an order is marked PAID, and it is idempotent.
  if (decision.dealId) {
    const session = event.data?.object ?? {};
    const customerEmail =
      (session['customer_details'] as { email?: string } | undefined)?.email ??
      (typeof session['customer_email'] === 'string' ? (session['customer_email'] as string) : undefined);
    try {
      const order = await prisma.order.findUnique({ where: { id: decision.dealId } });
      if (order) {
        await markPaid({
          orderId: order.id,
          sessionId: typeof session['id'] === 'string' ? (session['id'] as string) : undefined,
          paymentIntentId: typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined,
          amountUsd,
        });
        if (customerEmail && !order.customerEmail) {
          await prisma.order.update({ where: { id: order.id }, data: { customerEmail } });
        }
        logger.info('order activated from verified payment', { orderId: order.id, amountUsd });
      }
    } catch (err) {
      logger.error('failed to activate order from webhook', { ref: decision.dealId, error: (err as Error).message });
    }
  }

  logger.info('stripe revenue recorded', { eventId: event.id, amountUsd });
  return { handled: true, recorded: true, amountUsd };
}
