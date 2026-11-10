import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { server } from '../src/app/server.ts';

/**
 * Regression: an obsolete TAREQ_AUTH_BYPASS setting must never unlock
 * privileged routes, even on a fresh database with no owner created.
 */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const previous = process.env.TAREQ_AUTH_BYPASS;
  process.env.TAREQ_AUTH_BYPASS = '1';
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = previous;
  }
}

test('obsolete bypass setting cannot authorize owner POST requests', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/payments/link`, { method: 'POST' });
    assert.equal(res.status, 401);
  });
});

test('obsolete bypass setting cannot authorize owner GET requests', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mode`);
    assert.equal(res.status, 401);
  });
});

test('owner dashboard never signals an authentication bypass', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /data-auth-bypass="1"/);
    assert.match(html, /id="login"/);
  });
});
