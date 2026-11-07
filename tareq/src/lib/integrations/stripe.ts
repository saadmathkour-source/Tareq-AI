import { hasSecret } from '../env.ts';
import { prisma } from '../core/db.ts';
import { recordRevenue, record } from '../finance/ledger.ts';
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

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { handled: false, recorded: false, reason: 'invalid JSON' };
  }
  if (event.type !== 'checkout.session.completed') {
    return { handled: true, recorded: false, reason: `ignored event type ${event.type}` };
  }

  const session = event.data?.object ?? {};
  const amountTotal = Number(session['amount_total'] ?? 0) / 100;
  const externalId = String(event.id ?? session['id'] ?? '');
  if (!externalId) return { handled: false, recorded: false, reason: 'event has no id' };

  // Idempotency: an externalId already in the ledger means this webhook was
  // already processed; do not record it twice.
  const existing = await prisma.ledgerEntry.findUnique({ where: { externalId } });
  if (existing) return { handled: true, recorded: false, reason: 'already recorded', amountUsd: amountTotal };

  const dealId = typeof session['client_reference_id'] === 'string' ? session['client_reference_id'] : undefined;
  await recordRevenue({
    amountUsd: amountTotal,
    externalId,
    provider: 'stripe',
    dealId,
    evidence: { webhookEventId: event.id, sessionId: session['id'], amountTotal, signatureVerified: true },
  });
  // Stripe's own fee is a separate ledger kind, estimated at 2.9% + $0.30.
  await record({
    kind: 'FEE',
    amountUsd: Number((amountTotal * 0.029 + 0.3).toFixed(4)),
    provider: 'stripe',
    externalId: `${externalId}:fee`,
    evidence: { note: 'estimated Stripe processing fee' },
  });
  logger.info('stripe revenue recorded', { eventId: event.id, amountTotal });
  return { handled: true, recorded: true, amountUsd: amountTotal };
}
