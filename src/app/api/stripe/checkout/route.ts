import { NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/stripe';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';

const bodySchema = z.object({
  priceId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  successPath: z.string().default('/?checkout=success'),
  cancelPath: z.string().default('/?checkout=cancelled'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { email, successPath, cancelPath } = parsed.data;
  const priceId = parsed.data.priceId ?? serverEnv().STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    return NextResponse.json(
      { error: 'No price configured. Pass priceId or set STRIPE_PRO_PRICE_ID.' },
      { status: 400 },
    );
  }

  const appUrl = serverEnv().APP_URL;

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${appUrl}${successPath}`,
      cancel_url: `${appUrl}${cancelPath}`,
    });

    return NextResponse.json({ id: session.id, url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 502 },
    );
  }
}
