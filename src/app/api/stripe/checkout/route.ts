import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { serverEnv } from '@/lib/env';
import { authenticatedUser } from '@/lib/supabase/auth';

export const runtime = 'nodejs';

export async function POST() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: 'Verified email required' }, { status: 400 });

  // Never accept arbitrary Stripe price IDs, account emails or redirect URLs
  // from a client. The subscription belongs to the authenticated user.
  const { STRIPE_PRO_PRICE_ID, APP_URL } = serverEnv();
  if (!STRIPE_PRO_PRICE_ID) {
    return NextResponse.json({ error: 'No subscription price configured' }, { status: 503 });
  }
  const baseUrl = APP_URL.replace(/\/+$/, '');

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { userId: user.id },
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
    });
    return NextResponse.json({ id: session.id, url: session.url });
  } catch {
    return NextResponse.json({ error: 'Checkout unavailable' }, { status: 502 });
  }
}
