import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook receiver. Verifies the signature against STRIPE_WEBHOOK_SECRET
 * and records every event in the audit log.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = serverEnv().STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header or STRIPE_WEBHOOK_SECRET' },
      { status: 400 },
    );
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid signature' },
      { status: 400 },
    );
  }

  try {
    await prisma.eventLog.create({
      data: {
        source: 'stripe',
        type: event.type,
        payload: JSON.parse(payload),
      },
    });

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await prisma.eventLog.create({
          data: {
            source: 'stripe',
            type: 'checkout.session.completed:handled',
            payload: {
              id: session.id,
              customer:
                typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
            },
          },
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // Report processing failure so Stripe retries instead of silently losing the event.
    return NextResponse.json({ received: false, error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
