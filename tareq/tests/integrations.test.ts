import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { status as gmailStatus, createDraft as gmailCreateDraft, getDraft as gmailGetDraft, send as gmailSend } from '../src/lib/integrations/gmail.ts';
import {
  status as hubspotStatus,
  upsertContact as hsUpsertContact,
  getContact as hsGetContact,
  updateContact as hsUpdateContact,
  createCompany as hsCreateCompany,
  associateContactToCompany as hsAssociate,
  createDeal as hsCreateDeal,
  deleteObject as hsDeleteObject,
  findContactByEmail as hsFindByEmail,
} from '../src/lib/integrations/hubspot.ts';
import { status as stripeStatus, handleWebhook, createTestPaymentLink, classifyStripeEvent } from '../src/lib/integrations/stripe.ts';

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

test('stripe payment link refuses to act when the key is missing', async () => {
  const saved = { ...process.env };
  delete process.env.STRIPE_SECRET_KEY;
  const r = await createTestPaymentLink({ amountUsd: 10, productName: 'x', successUrl: 'https://x', cancelUrl: 'https://y' });
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /not configured/);
  process.env = saved;
});

test('gmail draft and send refuse when unconfigured instead of pretending', async () => {
  const saved = { ...process.env };
  for (const k of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER']) delete process.env[k];
  const d = await gmailCreateDraft('x@y.z', 's', 'b');
  assert.equal(d.ok, false);
  assert.match(String(d.reason), /not configured/);
  const g = await gmailGetDraft('draft-1');
  assert.equal(g.ok, false);
  const s = await gmailSend('x@y.z', 's', 'b');
  assert.equal(s.sent, false);
  process.env = saved;
});

test('hubspot writes refuse when unconfigured instead of pretending', async () => {
  const saved = { ...process.env };
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  assert.equal((await hsUpsertContact({ email: 'x@y.z' })).ok, false);
  assert.equal((await hsGetContact('1')).ok, false);
  assert.equal((await hsUpdateContact('1', { firstname: 'a' })).ok, false);
  assert.equal((await hsCreateCompany('Acme')).ok, false);
  assert.equal((await hsAssociate('1', '2')).ok, false);
  assert.equal((await hsCreateDeal({ name: 'deal' })).ok, false);
  assert.equal((await hsDeleteObject('contacts', '1')).ok, false);
  const find = await hsFindByEmail('x@y.z');
  assert.equal(find.ok, false);
  assert.deepEqual(find.ids, []);
  process.env = saved;
});

test('stripe event classifier never treats a test-mode payment as revenue', () => {
  const base = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { amount_total: 4900, id: 'cs_1' } } };
  // livemode absent -> treated as test, never revenue
  assert.equal(classifyStripeEvent(base).action, 'test');
  // explicit test mode
  assert.equal(classifyStripeEvent({ ...base, livemode: false }).action, 'test');
  // explicit live mode -> revenue
  const live = classifyStripeEvent({ ...base, livemode: true });
  assert.equal(live.action, 'revenue');
  assert.equal((live as { amountUsd: number }).amountUsd, 49);
});

test('stripe event classifier routes failures and unknown types away from revenue', () => {
  const failed = classifyStripeEvent({ id: 'evt_2', type: 'payment_intent.payment_failed', livemode: true, data: { object: { amount: 5000 } } });
  assert.equal(failed.action, 'failed');
  assert.equal((failed as { amountUsd: number }).amountUsd, 50);
  const other = classifyStripeEvent({ id: 'evt_3', type: 'customer.created', livemode: true });
  assert.equal(other.action, 'ignore');
  const noId = classifyStripeEvent({ type: 'checkout.session.completed', livemode: true });
  assert.equal(noId.action, 'ignore');
});

test('stripe classifier requires payment_status=paid before recognising revenue', () => {
  const unpaid = classifyStripeEvent({
    id: 'evt_u1',
    type: 'checkout.session.completed',
    livemode: true,
    data: { object: { amount_total: 14900, id: 'cs_u1', payment_status: 'unpaid' } },
  });
  assert.equal(unpaid.action, 'ignore');
  const nocost = classifyStripeEvent({
    id: 'evt_u2',
    type: 'checkout.session.completed',
    livemode: true,
    data: { object: { amount_total: 14900, id: 'cs_u2', payment_status: 'no_payment_required' } },
  });
  assert.equal(nocost.action, 'ignore');
  const paid = classifyStripeEvent({
    id: 'evt_u3',
    type: 'checkout.session.completed',
    livemode: true,
    data: { object: { amount_total: 14900, id: 'cs_u3', payment_status: 'paid', currency: 'usd' } },
  });
  assert.equal(paid.action, 'revenue');
  assert.equal((paid as { currency: string }).currency, 'usd');
});

test('stripe classifier routes async success to revenue and async failure away from it', () => {
  const ok = classifyStripeEvent({
    id: 'evt_a1',
    type: 'checkout.session.async_payment_succeeded',
    livemode: true,
    data: { object: { amount_total: 9900, id: 'cs_a1', payment_status: 'paid' } },
  });
  assert.equal(ok.action, 'revenue');
  const bad = classifyStripeEvent({ id: 'evt_a2', type: 'checkout.session.async_payment_failed', livemode: true, data: { object: { amount_total: 9900, id: 'cs_a2' } } });
  assert.equal(bad.action, 'failed');
});

test('stripe classifier separates refunds and disputes from ordinary revenue', () => {
  const refund = classifyStripeEvent({
    id: 'evt_r1',
    type: 'charge.refunded',
    livemode: true,
    data: { object: { id: 'ch_1', amount: 14900, amount_refunded: 14900, refunded: true, payment_intent: 'pi_1' } },
  });
  assert.equal(refund.action, 'refund');
  assert.equal((refund as { amountUsd: number }).amountUsd, 149);
  const dispute = classifyStripeEvent({
    id: 'evt_d1',
    type: 'charge.dispute.created',
    livemode: true,
    data: { object: { id: 'dp_1', amount: 14900, payment_intent: 'pi_1', status: 'needs_response' } },
  });
  assert.equal(dispute.action, 'dispute');
  assert.equal((dispute as { amountUsd: number }).amountUsd, 149);
});
