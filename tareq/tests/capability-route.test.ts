import test from 'node:test';
import assert from 'node:assert/strict';
import { server, routes } from '../src/app/server.ts';
import type { AddressInfo } from 'node:net';

test('analytical invocation is a strictly owner-authenticated POST route', () => {
  const entry = routes.find((r) => r.path === '/capabilities/evaluate');
  assert.ok(entry);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.auth, true);
  assert.equal(routes.filter((r) => r.path === '/capabilities/evaluate').length, 1);
});

test('anonymous users and obsolete owner bypass cannot evaluate analytical capabilities', async () => {
  const old = process.env.TAREQ_AUTH_BYPASS;
  process.env.TAREQ_AUTH_BYPASS = '1';
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const response = await fetch(base + '/capabilities/evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 65, args: [[{priceUsd:100, impressions:10, trials:1, purchases:0}]] }),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (old === undefined) delete process.env.TAREQ_AUTH_BYPASS;
    else process.env.TAREQ_AUTH_BYPASS = old;
  }
});
