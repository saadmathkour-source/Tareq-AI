import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { server } from '../src/app/server.ts';

/**
 * Owner-auth bypass is a temporary lockout-recovery switch. It must be off by
 * default and only open owner-only routes when TAREQ_AUTH_BYPASS=1.
 */

async function withServer<T>(bypass: boolean, fn: (base: string) => Promise<T>): Promise<T> {
  const prev = process.env.TAREQ_AUTH_BYPASS;
  if (bypass) process.env.TAREQ_AUTH_BYPASS = '1';
  else delete process.env.TAREQ_AUTH_BYPASS;
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (prev === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = prev;
  }
}

test('by default an owner-only route without a token is 401', async () => {
  await withServer(false, async (base) => {
    const res = await fetch(`${base}/payments/link`, { method: 'POST' });
    assert.equal(res.status, 401, 'auth is enforced when bypass is off');
  });
});

test('the dashboard shell carries no bypass marker by default', async () => {
  await withServer(false, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /data-auth-bypass="1"/, 'no bypass marker when disabled');
  });
});

test('with TAREQ_AUTH_BYPASS=1 the owner-only gate opens (no 401)', async () => {
  await withServer(true, async (base) => {
    const res = await fetch(`${base}/payments/link`, { method: 'POST' });
    assert.notEqual(res.status, 401, 'the auth gate is bypassed');
  });
});

test('with TAREQ_AUTH_BYPASS=1 the dashboard shell is marked for bypass', async () => {
  await withServer(true, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<body data-auth-bypass="1">/, 'bypass marker present so the login screen is skipped');
  });
});
