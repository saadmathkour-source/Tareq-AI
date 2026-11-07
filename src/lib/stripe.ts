import Stripe from 'stripe';
import { serverEnv } from '@/lib/env';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  client = new Stripe(serverEnv().STRIPE_SECRET_KEY, {
    apiVersion: '2026-10-15.preview' as Stripe.LatestApiVersion,
    typescript: true,
  });
  return client;
}

export const PLANS = {
  free: { label: 'Free', priceCents: 0 },
  pro: { label: 'Pro', priceCents: 2900 },
  enterprise: { label: 'Enterprise', priceCents: 9900 },
} as const;
