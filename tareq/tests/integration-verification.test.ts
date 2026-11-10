import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { server, routes } from '../src/app/server.ts';
import { prisma, usingTestDatabase } from '../src/lib/core/db.ts';
import { hashPassword, login, logout } from '../src/lib/security/owner-auth.ts';
import type { AddressInfo } from 'node:net';

test('manual integration preflight is authenticated and deduplicated; it never sends mail', async () => {
  assert.equal(usingTestDatabase(), true, 'must use isolated test database');
  const registered = routes.find(r => r.path === '/integrations/verify');
  assert.ok(registered);
  assert.equal(registered.auth, true);
  assert.equal(registered.method, 'POST');
  const email = 'ci-verify-' + randomUUID() + '@example.test';
  const password = randomUUID() + '-CI-Test1!';
  const owner = await prisma.owner.create({ data: { email, passwordHash: hashPassword(password), isPrimary: false } });
  const session = await login(email, password);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const anonymous = await fetch(base + '/integrations/verify', { method: 'POST' });
    assert.equal(anonymous.status, 401);
    const options = { method: 'POST', headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' }, body: '{}' };
    const first = await fetch(base + '/integrations/verify', options);
    const second = await fetch(base + '/integrations/verify', options);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    const a = await first.json() as { taskId: string; readOnly: boolean };
    const b = await second.json() as { taskId: string };
    assert.equal(a.taskId, b.taskId, 'duplicate within five minutes must reuse one task');
    assert.equal(a.readOnly, true);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
    assert.equal(task.kind, 'integration.verify_commercial');
    assert.equal(task.status, 'PENDING');
    assert.equal(task.attempts, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await logout(session.token);
    await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: 'owner:integration.verify:' } } });
    await prisma.owner.delete({ where: { id: owner.id } });
  }
});
