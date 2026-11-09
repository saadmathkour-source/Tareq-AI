import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { ValidationError } from '../core/errors.ts';
import { createCheckoutSession } from '../integrations/stripe.ts';
import { logger } from '../core/logger.ts';

/**
 * Public checkout (Phase 17).
 *
 * A buyer with no account can start a purchase for a PUBLISHED product. The
 * order and the price come exclusively from the server-side product row — the
 * browser can supply only an email and free-form requirements. The Stripe
 * Checkout Session is tied to the order by `client_reference_id`, which is the
 * order id, so the signature-verified webhook can activate exactly this order.
 *
 * Nothing here marks an order paid. Money is recognised only in the webhook.
 */

export interface PublicCheckoutInput {
  slug: string;
  email: string;
  requirements?: Record<string, unknown>;
  /** Public base URL used to build the success/cancel redirects. */
  baseUrl: string;
}

export interface PublicCheckoutResult {
  orderId: string;
  url: string;
  sessionId: string;
  mode?: 'test' | 'live';
  /** True when an existing pending order was reused instead of creating one. */
  reused: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject anything that is not a plausible, length-bounded email address. */
export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ValidationError('a valid customer email is required');
  }
  return email;
}

/** Only a small, known set of requirement keys is accepted from the browser. */
export function sanitizeRequirements(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  const allowed = new Set(['topic', 'niche', 'market', 'segment', 'geography', 'notes']);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    const s = String(v ?? '').trim();
    if (s.length === 0) continue;
    out[k] = s.slice(0, 500);
  }
  return out;
}

/**
 * Create (or safely reuse) a public order and its Stripe Checkout Session.
 *
 * Reuse rule: a double-click or a refresh within the reuse window returns the
 * existing pending order's link rather than creating a second order. Reuse is
 * keyed on (product, email) and only for an order that is still AWAITING_PAYMENT
 * and already has a checkout URL — a paid or failed order is never reused.
 */
export async function createPublicCheckout(
  input: PublicCheckoutInput,
  opts: { reuseWindowMs?: number } = {},
): Promise<PublicCheckoutResult> {
  const email = normalizeEmail(input.email);
  const product = await prisma.product.findUnique({ where: { slug: input.slug } });
  if (!product || product.status !== 'PUBLISHED') throw new ValidationError(`Product not available: ${input.slug}`);

  const reuseWindowMs = opts.reuseWindowMs ?? 15 * 60 * 1000;
  const since = new Date(Date.now() - reuseWindowMs);
  const reusable = await prisma.order.findFirst({
    where: {
      productId: product.id,
      customerEmail: email,
      status: 'AWAITING_PAYMENT',
      checkoutUrl: { not: null },
      stripeSessionId: { not: null },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (reusable?.checkoutUrl && reusable.stripeSessionId) {
    return { orderId: reusable.id, url: reusable.checkoutUrl, sessionId: reusable.stripeSessionId, reused: true };
  }

  const requirements = sanitizeRequirements(input.requirements);
  const order = await prisma.order.create({
    data: {
      productId: product.id,
      status: 'AWAITING_PAYMENT',
      customerEmail: email,
      // Price and currency are copied from the server-side product, never from
      // anything the browser sent.
      amountUsd: product.priceUsd,
      currency: product.currency,
      requirements: requirements as never,
    },
  });

  const session = await createCheckoutSession({
    amountUsd: Number(product.priceUsd),
    currency: product.currency,
    productName: product.name,
    successUrl: `${input.baseUrl}/thanks?order=${order.id}`,
    cancelUrl: `${input.baseUrl}/buy/${product.slug}?cancelled=1`,
    clientReferenceId: order.id,
    customerEmail: email,
  });

  if (!session.ok || !session.url || !session.id) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
    await audit({ actorType: 'agent', action: 'order.checkout_failed', target: order.id, severity: 'error', metadata: { reason: session.reason } });
    throw new ValidationError(session.reason ?? 'could not create a payment session');
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: session.id, checkoutUrl: session.url },
  });
  await audit({
    actorType: 'agent',
    action: 'order.checkout_created',
    target: order.id,
    metadata: { productSlug: product.slug, sessionId: session.id, mode: session.mode },
  });
  logger.info('public checkout created', { orderId: order.id, slug: product.slug });
  return { orderId: order.id, url: session.url, sessionId: session.id, mode: session.mode, reused: false };
}

/** Public, non-sensitive order status for the buyer's own order page. */
export interface PublicOrderStatus {
  orderId: string;
  status: string;
  productName: string;
  emailSent: boolean;
  downloadAvailable: boolean;
}

export async function getPublicOrderStatus(orderId: string): Promise<PublicOrderStatus | null> {
  // A non-UUID id (a mistyped or probe link) would make Prisma throw on a UUID
  // column; treat it as "not found" so the public page stays a clean 404.
  if (!UUID_RE.test(orderId)) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { product: true, artifacts: true },
  });
  if (!order) return null;
  const artifact = order.artifacts.find((a) => a.validated) ?? order.artifacts[0] ?? null;
  return {
    orderId: order.id,
    status: order.status,
    productName: order.product.name,
    emailSent: Boolean(artifact?.emailSentAt),
    downloadAvailable: order.status === 'DELIVERED' && Boolean(artifact?.downloadTokenHash),
  };
}
