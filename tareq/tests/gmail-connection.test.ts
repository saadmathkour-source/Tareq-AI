import test from 'node:test';
import assert from 'node:assert/strict';
import { probeToken } from '../src/lib/integrations/gmail.ts';
import { verifyEmailConnection } from '../src/lib/integrations/commercial-preflight.ts';

const names = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER', 'EMAIL_PROVIDER', 'RESEND_API_KEY'] as const;
const saved = Object.fromEntries(names.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  for (const key of names) delete process.env[key];
  Object.assign(process.env, {GMAIL_CLIENT_ID: 'dummy-id', GMAIL_CLIENT_SECRET: 'dummy-secret', GMAIL_REFRESH_TOKEN: 'dummy-refresh', GMAIL_SENDER: 'owner@example.test'});
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of names) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('missing Gmail credentials make no network request', async () => {
  delete process.env.GMAIL_REFRESH_TOKEN;
  globalThis.fetch = async () => { throw new Error('must not run'); };
  const result = await probeToken();
  assert.equal(result.code, 'missing_config');
  assert.equal(result.ok, false);
});

test('Gmail probe exposes only connection and send-scope metadata without sending', async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    assert.equal(init?.method, 'POST');
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('grant_type'), 'refresh_token');
    return Response.json({access_token: 'private-access-token', refresh_token: 'private-refreshed-token', scope: 'https://www.googleapis.com/auth/gmail.send'});
  };
  const result = await verifyEmailConnection();
  assert.equal(calls, 1);
  assert.equal(result.email.connectionVerified, true);
  assert.equal(result.email.sendPermission, 'granted');
  assert.equal(result.email.deliveryVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|dummy-secret|dummy-refresh/);
});

test('a token response with no scopes does not invent send permission', async () => {
  globalThis.fetch = async () => Response.json({access_token: 'dummy-access'});
  const result = await probeToken();
  assert.equal(result.ok, true);
  assert.equal(result.sendPermission, 'not_reported');
});

test('read-only Gmail scope is not classified as permission to send', async () => {
  globalThis.fetch = async () => Response.json({access_token: 'dummy-access', scope: 'https://www.googleapis.com/auth/gmail.readonly'});
  assert.equal((await probeToken()).sendPermission, 'missing');
});

test('invalid refresh grant preserves the code but drops upstream descriptions', async () => {
  globalThis.fetch = async () => Response.json({error: 'invalid_grant', error_description: 'private-dummy-refresh'}, {status: 400});
  const result = await verifyEmailConnection();
  assert.equal(result.email.connectionVerified, false);
  assert.equal(result.email.failureCode, 'invalid_grant');
  assert.equal(result.email.httpStatus, 400);
  assert.doesNotMatch(JSON.stringify(result), /private-dummy-refresh/);
});

test('invalid OAuth client is distinguished from a revoked grant', async () => {
  globalThis.fetch = async () => Response.json({error: 'invalid_client'}, {status: 401});
  const result = await probeToken();
  assert.equal(result.code, 'invalid_client');
  assert.equal(result.httpStatus, 401);
});

test('unknown upstream errors are never copied into diagnostics', async () => {
  globalThis.fetch = async () => Response.json({error: 'private-dummy-secret', error_description: 'private-mailbox'}, {status: 403});
  const result = await probeToken();
  assert.equal(result.code, 'provider_error');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('transport failures and timeout failures have separate safe codes', async () => {
  globalThis.fetch = async () => { throw new Error('private-network-detail'); };
  assert.equal((await probeToken()).code, 'network_error');
  globalThis.fetch = async () => { const error = new Error('private-timeout-detail'); error.name = 'TimeoutError'; throw error; };
  const result = await probeToken();
  assert.equal(result.code, 'timeout');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('malformed success responses are not reported as a working connection', async () => {
  globalThis.fetch = async () => new Response('not-json', {status: 200});
  assert.equal((await probeToken()).code, 'invalid_response');
  globalThis.fetch = async () => Response.json({access_token: 42});
  assert.equal((await probeToken()).code, 'invalid_response');
});

test('Google session-policy reauthentication is identified without account details', async () => {
  globalThis.fetch = async () => Response.json({error: 'invalid_grant', error_subtype: 'invalid_rapt'}, {status: 400});
  assert.equal((await probeToken()).code, 'invalid_rapt');
});
