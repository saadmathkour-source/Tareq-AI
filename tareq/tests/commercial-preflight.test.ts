import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCommercialConnections } from '../src/lib/integrations/commercial-preflight.ts';

const originalFetch = globalThis.fetch;
const names = ['EMAIL_PROVIDER','RESEND_API_KEY','EMAIL_FROM','GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN','GMAIL_SENDER','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TAREQ_PUBLIC_URL','APP_URL','RAILWAY_PUBLIC_DOMAIN'];
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
test.beforeEach(() => { for (const name of names) delete process.env[name]; });
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

function configure() {
  Object.assign(process.env, {
    EMAIL_PROVIDER: 'gmail', GMAIL_CLIENT_ID:'dummy-id', GMAIL_CLIENT_SECRET:'dummy-secret',
    GMAIL_REFRESH_TOKEN:'dummy-refresh', GMAIL_SENDER:'sender@example.test',
    STRIPE_SECRET_KEY:'sk_test_dummy', STRIPE_WEBHOOK_SECRET:'dummy-webhook', TAREQ_PUBLIC_URL:'https://tareq.example.test',
  });
}

test('missing credentials do not trigger an external call', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network call'); };
  const result = await verifyCommercialConnections();
  assert.equal(result.email.connectionVerified, false);
  assert.equal(result.stripe.accountVerified, false);
  assert.equal(calls, 0);
});

test('preflight uses OAuth and Stripe reads only; never creates payments or sends mail', async () => {
  configure();
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token:'dummy-access'});
    assert.equal(init?.method ?? 'GET', 'GET');
    if (url.endsWith('/account')) return Response.json({id:'acct_tareq_test',charges_enabled:true,payouts_enabled:true});
    if (url.includes('/webhook_endpoints?')) return Response.json({data:[{url:'https://tareq.example.test/webhooks/stripe',status:'enabled',enabled_events:['checkout.session.completed']}]});
    throw new Error('Unexpected side effect');
  };
  const result = await verifyCommercialConnections();
  assert.equal(requests.length, 3);
  assert.equal(result.email.connectionVerified, true);
  assert.equal(result.email.deliveryVerified, false);
  assert.equal(result.stripe.accountId, 'acct_tareq_test');
  assert.equal(result.stripe.matchingWebhookEnabled, true);
  assert.equal(result.stripe.webhookSignatureVerified, false);
  assert.equal(JSON.stringify(result).includes('dummy-secret'), false);
});

test('a webhook for another application is not accepted as TAREQ verification', async () => {
  configure();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('oauth2')) return Response.json({access_token:'dummy-access'});
    if (url.endsWith('/account')) return Response.json({id:'acct_tareq_test',charges_enabled:false});
    return Response.json({data:[{url:'https://other.example.test/webhooks/stripe',status:'enabled',enabled_events:['*']}]});
  };
  const result = await verifyCommercialConnections();
  assert.equal(result.stripe.chargesEnabled, false);
  assert.equal(result.stripe.matchingWebhookEnabled, false);
});

test('provider errors never persist arbitrary response text', async () => {
  configure();
  globalThis.fetch = async () => { throw new Error('private-dummy-secret'); };
  const result = await verifyCommercialConnections();
  assert.equal(result.email.connectionVerified, false);
  assert.equal(result.stripe.accountVerified, false);
  assert.equal(JSON.stringify(result).includes('private-dummy-secret'), false);
});

test('the actual Railway host takes precedence over an unrelated legacy APP_URL', async () => {
  configure();
  delete process.env.TAREQ_PUBLIC_URL;
  process.env.RAILWAY_PUBLIC_DOMAIN = 'tareq-railway.example.test';
  process.env.APP_URL = 'https://legacy.example.test';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('oauth2')) return Response.json({access_token:'dummy-access'});
    if (url.endsWith('/account')) return Response.json({id:'acct_tareq_test',charges_enabled:true});
    return Response.json({data:[{url:'https://tareq-railway.example.test/webhooks/stripe',status:'enabled',enabled_events:['checkout.session.completed']}]});
  };
  assert.equal((await verifyCommercialConnections()).stripe.matchingWebhookEnabled, true);
});
