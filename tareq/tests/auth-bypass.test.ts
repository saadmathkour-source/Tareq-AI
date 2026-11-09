import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { server, resolveAuthBypass } from '../src/app/server.ts';

/**
 * Owner-auth bypass is a temporary lockout-recovery switch. It must be off by
 * default, and even when TAREQ_AUTH_BYPASS=1 is set it must be REFUSED once an
 * owner exists (so a forgotten flag can never leave a live deployment open).
 */

async function withServer<T>(bypass: boolean, fn: (base: string) => Promise<T>, owners = 0): Promise<T> {
  const prev = process.env.TAREQ_AUTH_BYPASS;
  if (bypass) process.env.TAREQ_AUTH_BYPASS = '1';
  else delete process.env.TAREQ_AUTH_BYPASS;
  await resolveAuthBypass(async () => owners);
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

test('with TAREQ_AUTH_BYPASS=1 and no owner the gate opens (lockout recovery)', async () => {
  await withServer(
    true,
    async (base) => {
      const res = await fetch(`${base}/payments/link`, { method: 'POST' });
      assert.notEqual(res.status, 401, 'the auth gate is bypassed for lockout recovery');
    },
    0,
  );
});

test('with TAREQ_AUTH_BYPASS=1 and no owner the shell is marked for bypass', async () => {
  await withServer(
    true,
    async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<body data-auth-bypass="1">/, 'bypass marker present so the login screen is skipped');
    },
    0,
  );
});

test('TAREQ_AUTH_BYPASS=1 is REFUSED when an owner exists', async () => {
  await withServer(
    true,
    async (base) => {
      const res = await fetch(`${base}/payments/link`, { method: 'POST' });
      assert.equal(res.status, 401, 'owner-only route stays protected even with the flag set');
      const html = await (await fetch(`${base}/`)).text();
      assert.doesNotMatch(html, /data-auth-bypass="1"/, 'no bypass marker when an owner exists');
    },
    1,
  );
});

test('the bypass fails closed when the owner count cannot be read', async () => {
  const prev = process.env.TAREQ_AUTH_BYPASS;
  process.env.TAREQ_AUTH_BYPASS = '1';
  try {
    await resolveAuthBypass(async () => {
      throw new Error('db down');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/payments/link`, { method: 'POST' });
      assert.equal(res.status, 401, 'cannot verify owner state => gate stays closed');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    if (prev === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = prev;
  }
});
