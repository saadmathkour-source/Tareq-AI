import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/core/db.ts';
import { enqueue, claimNext, succeed, fail } from '../src/lib/queue/tasks.ts';

/**
 * Queue scheduling guarantees. These exercise the real claim SQL against the
 * database, because the bugs they guard against only appear in the query:
 *
 *  - head-of-line blocking: a task whose dependencies are unmet must not stop
 *    the worker from claiming other, ready work.
 *  - dead dependencies: when a task dies, its dependents must not wait forever.
 *
 * The tests create their own rows and remove them. Rows are tagged with the
 * `QTEST-` idempotency prefix, which the production worker excludes by default,
 * so these tests are safe to run even while a live worker is running.
 */

const MARK = `QTEST-${Date.now().toString(36)}`;
const ids: string[] = [];

/** Claim only this test's own rows, so a live worker or other rows can't interfere. */
function claimOwn(workerId: string) {
  return claimNext(workerId, 5 * 60_000, {
    excludeIdempotencyPrefix: null,
    includeIdempotencyPrefix: MARK,
  });
}

async function make(kind: string, opts: Parameters<typeof enqueue>[0] extends infer T ? Omit<T, 'kind'> : never): Promise<string> {
  const id = await enqueue({ kind, idempotencyKey: `${MARK}:${ids.length}`, ...opts });
  ids.push(id);
  return id;
}

async function cleanup(): Promise<void> {
  await prisma.deadLetter.deleteMany({ where: { taskId: { in: ids } } }).catch(() => {});
  await prisma.task.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.event.deleteMany({ where: { type: { in: ['task.succeeded', 'task.dead', 'task.failed'] } } }).catch(() => {});
}

test('an unmet-dependency task does not block ready work (head-of-line)', async () => {
  try {
    // A is oldest and ready. B depends on A and is older than C.
    const a = await make('commercial.economic_analysis', { runAt: new Date(Date.now() - 3000), priority: 'CRITICAL' });
    const b = await make('commercial.risk_review', { runAt: new Date(Date.now() - 2000), dependsOn: [a], priority: 'CRITICAL' });
    const c = await make('commercial.economic_analysis', { runAt: new Date(Date.now() - 1000), priority: 'CRITICAL' });

    const first = await claimOwn(`${MARK}-w1`);
    assert.equal(first?.id, a, 'oldest ready task is claimed first');

    // A is now RUNNING, so B's dependency is unmet. The worker must skip B and
    // take C, not spin on B forever.
    const second = await claimOwn(`${MARK}-w1`);
    assert.ok(second, 'a ready task must still be claimable while a blocked task sits at the head');
    assert.notEqual(second!.id, b, 'the blocked task must not be claimed');
    assert.equal(second!.id, c, 'the next ready task is claimed');
  } finally {
    await cleanup();
  }
});

test('a dead task dead-letters its dependents instead of stranding them', async () => {
  try {
    const parent = await make('commercial.economic_analysis', { runAt: new Date(Date.now() - 2000), maxAttempts: 1, priority: 'CRITICAL' });
    const child = await make('commercial.risk_review', { runAt: new Date(Date.now() - 1000), dependsOn: [parent], priority: 'CRITICAL' });

    // Fail the parent for good (no retries).
    await fail(parent, 'boom', { retryable: false });

    const childRow = await prisma.task.findUniqueOrThrow({ where: { id: child } });
    assert.equal(childRow.status, 'DEAD', 'dependent is dead-lettered, not left pending forever');
    assert.match(childRow.error ?? '', /dependency failed/);
  } finally {
    await cleanup();
  }
});

test('a task with satisfied dependencies is claimable', async () => {
  try {
    const dep = await make('commercial.economic_analysis', { runAt: new Date(Date.now() - 2000), priority: 'CRITICAL' });
    const after = await make('commercial.risk_review', { runAt: new Date(Date.now() - 1000), dependsOn: [dep], priority: 'CRITICAL' });
    await succeed(dep, { ok: true });

    const claimed = await claimOwn(`${MARK}-w2`);
    assert.equal(claimed?.id, after, 'task runs once its dependency succeeded');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
});

test('the production worker skips test-owned rows (QTEST- prefix)', async () => {
  try {
    const id = await make('commercial.economic_analysis', { runAt: new Date(Date.now() - 2000), priority: 'CRITICAL' });
    // A production worker uses the default claim (excludes the test prefix) and
    // must therefore never pick this row up.
    const prodClaim = await claimNext(`${MARK}-prod`);
    assert.notEqual(prodClaim?.id, id, 'production claim must not take a QTEST- row');
    // The row is still claimable by a test that opts out of the exclusion.
    const ownClaim = await claimOwn(`${MARK}-own`);
    assert.equal(ownClaim?.id, id, 'test can still claim its own row');
  } finally {
    await cleanup();
  }
});
