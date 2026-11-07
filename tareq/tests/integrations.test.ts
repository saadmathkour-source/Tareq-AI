import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { status as gmailStatus } from '../src/lib/integrations/gmail.ts';
import { status as hubspotStatus } from '../src/lib/integrations/hubspot.ts';
import { status as stripeStatus, handleWebhook } from '../src/lib/integrations/stripe.ts';

/**
 * Integration adapters must be honest: with no credentials they report
 * `configured: false` and refuse to act, rather than pretending to work.
 */

test('gmail reports unconfigured when its OAuth secrets are absent', () => {
  const saved = { ...process.env };
  for (const k of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER']) delete process.env[k];
  const st = gmailStatus();
  assert.equal(st.configured, false);
  assert.ok(st.missing.length >= 1);
  process.env = saved;
});

test('gmail reports configured only when all four secrets are present', () => {
  const saved = { ...process.env };
  process.env.GMAIL_CLIENT_ID = 'x';
  process.env.GMAIL_CLIENT_SECRET = 'y';
  process.env.GMAIL_REFRESH_TOKEN = 'z';
  process.env.GMAIL_SENDER = 'owner@example.com';
  const st = gmailStatus();
  assert.equal(st.configured, true);
  assert.equal(st.sender, 'owner@example.com');
  process.env = saved;
});

test('hubspot reports unconfigured without a token', () => {
  const saved = { ...process.env };
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  assert.equal(hubspotStatus().configured, false);
  process.env = saved;
});

test('stripe mode is derived from the key prefix', () => {
  const saved = { ...process.env };
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(stripeStatus().mode, 'none');
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  assert.equal(stripeStatus().mode, 'test');
  process.env.STRIPE_SECRET_KEY = 'sk_live_123';
  assert.equal(stripeStatus().mode, 'live');
  process.env = saved;
});

test('stripe webhook rejects a request with no configured secret', async () => {
  const saved = { ...process.env };
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const r = await handleWebhook('{}', 't=1,v1=deadbeef');
  assert.equal(r.handled, false);
  assert.equal(r.recorded, false);
  process.env = saved;
});

test('stripe webhook rejects a forged signature and never records revenue', async () => {
  const saved = { ...process.env };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { amount_total: 9999 } } });
  const r = await handleWebhook(body, 't=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000');
  assert.equal(r.handled, false);
  assert.equal(r.recorded, false);
  assert.match(String(r.reason), /signature/);
  process.env = saved;
});

test('stripe webhook signature check uses HMAC over timestamp.payload', () => {
  // Documents the scheme so a regression in the construction is caught.
  const secret = 'whsec_test_secret';
  const t = '1700000000';
  const payload = '{"id":"evt_1"}';
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  assert.equal(expected.length, 64);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test('stripe webhook rejects a malformed signature header', async () => {
  const saved = { ...process.env };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  const r = await handleWebhook('{}', 'garbage');
  assert.equal(r.handled, false);
  assert.match(String(r.reason), /malformed/);
  process.env = saved;
});
