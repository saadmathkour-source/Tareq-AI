import * as email from './email.ts';
import { status as stripeStatus } from './stripe.ts';

/** Verify the configured connections without a payment, message, or model call. */
export async function verifyCommercialConnections() {
  const emailStatus = email.status();
  const emailProbe = await email.verify();
  const st = stripeStatus();
  const stripe = {
    ...st,
    accountVerified: false,
    accountId: null as string | null,
    chargesEnabled: false,
    payoutsEnabled: false,
    matchingWebhookEnabled: false,
    webhookSignatureVerified: false,
    reason: undefined as string | undefined,
  };
  if (st.configured) {
    const get = async (path: string) => {
      const response = await fetch(`https://api.stripe.com/v1/${path}`, {
        headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Stripe HTTP ${response.status}`);
      return response.json();
    };
    try {
      const account = await get('account') as { id?: string; charges_enabled?: boolean; payouts_enabled?: boolean };
      stripe.accountVerified = Boolean(account.id);
      stripe.accountId = account.id ?? null;
      stripe.chargesEnabled = account.charges_enabled === true;
      stripe.payoutsEnabled = account.payouts_enabled === true;
      // Use TAREQ's actual Railway host before a legacy APP_URL from another app.
      const base = process.env.TAREQ_PUBLIC_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') || process.env.APP_URL || '';
      if (!base) {
        stripe.reason = 'Public application URL is not configured';
      } else {
        const expected = new URL('/webhooks/stripe', base).href;
        const endpoints = await get('webhook_endpoints?limit=100') as { data?: Array<{ url: string; status: string; enabled_events: string[] }> };
        stripe.matchingWebhookEnabled = (endpoints.data ?? []).some((endpoint) =>
          endpoint.url === expected && endpoint.status === 'enabled' &&
          (endpoint.enabled_events.includes('*') || endpoint.enabled_events.includes('checkout.session.completed')));
      }
    } catch (error) {
      // Never persist arbitrary upstream responses or credentials in task results.
      const message = error instanceof Error ? error.message : '';
      stripe.reason = /^Stripe HTTP \d{3}$/.test(message) ? message : 'Stripe connection verification failed';
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    email: {
      configured: emailStatus.configured,
      provider: emailStatus.provider,
      connectionVerified: emailProbe.ok,
      deliveryVerified: false,
      reason: emailProbe.ok ? undefined : 'Email connection verification failed',
    },
    stripe,
    note: 'Connection checks only. No message, checkout, payment or customer record was created.',
  };
}
