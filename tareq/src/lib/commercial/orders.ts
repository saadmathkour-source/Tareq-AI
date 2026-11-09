import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { ValidationError } from '../core/errors.ts';
import { enqueue } from '../queue/tasks.ts';

/**
 * Order lifecycle (Phase 16, groups 6 and 7).
 *
 * CUSTOMER -> PRODUCT SELECTION -> CHECKOUT -> VERIFIED PAYMENT -> ORDER ->
 * DELIVERY -> CONFIRMATION -> REVENUE.
 *
 * The hard rule: an order only becomes PAID inside `markPaid`, which is called
 * exclusively by the signature-verified Stripe webhook. Creating a checkout link
 * never marks anything paid, and delivery is only enqueued from `markPaid`.
 */

export interface OrderInput {
  productSlug: string;
  customerEmail?: string;
  customerName?: string;
  requirements?: Record<string, unknown>;
}

/** Create a draft order for a published product. */
export async function createOrder(input: OrderInput) {
  const product = await prisma.product.findUnique({ where: { slug: input.productSlug } });
  if (!product || product.status !== 'PUBLISHED') throw new ValidationError(`Product not available: ${input.productSlug}`);
  const order = await prisma.order.create({
    data: {
      productId: product.id,
      status: 'CREATED',
      customerEmail: input.customerEmail ?? null,
      customerName: input.customerName ?? null,
      amountUsd: product.priceUsd,
      currency: product.currency,
      requirements: (input.requirements ?? {}) as never,
    },
  });
  await audit({ actorType: 'agent', action: 'order.created', target: order.id, metadata: { productSlug: input.productSlug } });
  return order;
}

/** Attach a Stripe checkout session id to an order and mark it awaiting payment. */
export async function attachCheckout(orderId: string, sessionId: string, url: string) {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'AWAITING_PAYMENT', stripeSessionId: sessionId, checkoutUrl: url || null },
  });
  await audit({ actorType: 'agent', action: 'order.checkout_created', target: orderId, metadata: { sessionId } });
  return { order, url };
}

/**
 * Mark an order paid after a verified webhook, then enqueue delivery. Idempotent:
 * a second call for an already-paid order is a no-op, so a replayed webhook can
 * never start two deliveries or double-record.
 */
export async function markPaid(input: {
  orderId: string;
  sessionId?: string;
  paymentIntentId?: string;
  amountUsd?: number;
  /** Override the delivery idempotency key (tests use a QTEST- key). */
  idempotencyKey?: string;
}): Promise<{ orderId: string; alreadyPaid: boolean; deliveryTaskId: string | null }> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new ValidationError(`Order not found: ${input.orderId}`);

  // Any post-payment state (including the delivery/email retry states) is
  // already activated: a replayed webhook must never re-enqueue delivery.
  if (['PAID', 'IN_DELIVERY', 'DELIVERY_PENDING', 'EMAIL_FAILED', 'DELIVERED'].includes(order.status)) {
    return { orderId: order.id, alreadyPaid: true, deliveryTaskId: null };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      stripeSessionId: input.sessionId ?? order.stripeSessionId,
      stripePaymentIntentId: input.paymentIntentId ?? order.stripePaymentIntentId,
      ...(input.amountUsd != null ? { amountUsd: input.amountUsd } : {}),
    },
  });

  // Enqueue delivery exactly once, keyed by the order so a replay cannot duplicate it.
  const taskId = await enqueue({
    kind: 'order.deliver',
    payload: { orderId: order.id },
    idempotencyKey: input.idempotencyKey ?? `order.deliver:${order.id}`,
    priority: 'HIGH',
  });

  await audit({ actorType: 'system', action: 'order.paid', target: order.id, severity: 'warn', metadata: { sessionId: input.sessionId, amountUsd: input.amountUsd } });
  return { orderId: order.id, alreadyPaid: false, deliveryTaskId: taskId };
}

export async function listOrders(limit = 100) {
  return prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { product: true, artifacts: true } });
}

export async function orderStats() {
  const grouped = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  const stats: Record<string, number> = {};
  for (const g of grouped) stats[g.status] = g._count._all;
  return stats;
}
