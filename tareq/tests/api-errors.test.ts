import test from 'node:test';
import assert from 'node:assert/strict';
import { server, statusForError } from '../src/app/server.ts';
import type { AddressInfo } from 'node:net';
import { ForbiddenError, ValidationError, LimitExceededError } from '../src/lib/core/errors.ts';
import { prisma, usingTestDatabase } from '../src/lib/core/db.ts';
import { hashPassword } from '../src/lib/security/owner-auth.ts';
import { randomUUID } from 'node:crypto';

/**
 * The API must report honest status codes. A bad password is 401, not 500 —
 * otherwise an authentication failure looks like a server crash and hides the
 * real cause from the owner and from monitoring.
 */

test('a bad login (ForbiddenError) maps to 401, never 500', () => {
  const r = statusForError(new ForbiddenError('Invalid credentials'));
  assert.equal(r.status, 401);
  // The message is deliberately generic so it cannot confirm whether an email exists.
  assert.equal(r.body.error, 'unauthorized');
});

test('a validation failure maps to 400 with its message', () => {
  const r = statusForError(new ValidationError('bad input'));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad input');
});

test('other typed errors map to 422', () => {
  const r = statusForError(new LimitExceededError('budget', 'over cap'));
  assert.equal(r.status, 422);
});

test('an unexpected error still maps to 500 and hides internals', () => {
  const r = statusForError(new Error('connection reset by peer'));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal error');
});

test('owner sign-in is restored at both original and dedicated entry points', async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const home = await fetch(base, { redirect: 'manual' });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Owner sign-in/);
    const owner = await fetch(`${base}/dashboard`);
    assert.equal(owner.status, 200);
    assert.match(await owner.text(), /Owner sign-in/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('real owner login, protected integration evidence and logout work in the isolated database', async () => {
  assert.equal(usingTestDatabase(), true, 'must never create this fixture in production');
  const id = randomUUID();
  const password = randomUUID();
  const email = `QTEST-owner-${id}@example.test`.toLowerCase();
  await prisma.owner.create({ data: { id, email, passwordHash: hashPassword(password) } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/integrations`)).status, 401);
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email, password}),
    });
    assert.equal(login.status, 200);
    const {token} = await login.json() as {token: string};
    const headers = {authorization: `Bearer ${token}`};
    const integrations = await fetch(`${base}/integrations`, {headers});
    assert.equal(integrations.status, 200);
    assert.ok('commercialVerification' in (await integrations.json() as Record<string, unknown>));
    assert.equal((await fetch(`${base}/auth/logout`, {method: 'POST', headers})).status, 200);
    assert.equal((await fetch(`${base}/integrations`, {headers})).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.owner.delete({where: {id}});
  }
});

test.after(async () => { await prisma.$disconnect(); });
