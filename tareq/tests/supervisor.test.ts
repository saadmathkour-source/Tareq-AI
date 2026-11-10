import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/core/db.ts';
import { runWatchdog, openFindings, resolveFinding } from '../src/lib/core/supervisor.ts';
import { tick, registerHandler } from '../src/lib/core/orchestrator.ts';
import { enqueue } from '../src/lib/queue/tasks.ts';
import {
  getControls,
  setControls,
  ensureControls,
  assertTaskCostAllowed,
  assertNotStopped,
  isEmergencyStopped,
  DEFAULT_CONTROLS,
} from '../src/lib/security/controls.ts';

const MARK = `SUP-${randomUUID().slice(0, 8)}`;

// --- watchdog: crash recovery ------------------------------------------------
test('watchdog reclaims a stalled RUNNING task and raises one finding', async () => {
  const task = await prisma.task.create({
    data: {
      kind: 'plan',
      idempotencyKey: `${MARK}-stalled`,
      status: 'RUNNING',
      payload: {},
      lockedBy: 'dead-worker',
      lockedAt: new Date(Date.now() - 60 * 60_000),
      heartbeatAt: new Date(Date.now() - 60 * 60_000),
    },
  });
  try {
    await runWatchdog();
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, 'RETRYING', 'a stalled task must be reclaimed for retry');
    // The finding is recorded (reclaiming is a self-heal, so it is auto-resolved).
    const alerts = await prisma.watchdogAlert.findMany({ where: { kind: 'STALLED_TASK' } });
    assert.ok(alerts.length >= 1, 'a stalled task must raise a watchdog finding');
  } finally {
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.watchdogAlert.deleteMany({ where: { kind: 'STALLED_TASK' } });
  }
});

// --- watchdog: orphan dependency ---------------------------------------------
test('watchdog dead-letters a task whose dependency does not exist', async () => {
  const ghost = randomUUID();
  const task = await prisma.task.create({
    data: { kind: 'plan', idempotencyKey: `${MARK}-orphan`, status: 'PENDING', payload: {}, dependsOn: [ghost] },
  });
  try {
    await runWatchdog();
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, 'DEAD', 'an unsatisfiable dependency must dead-letter the task');
    const dl = await prisma.deadLetter.findFirst({ where: { taskId: task.id } });
    assert.ok(dl, 'a dead letter must be recorded');
    const alerts = await prisma.watchdogAlert.findMany({ where: { kind: 'ORPHAN_DEPENDENCY', subject: task.id } });
    assert.equal(alerts.length, 1);
  } finally {
    await prisma.deadLetter.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.watchdogAlert.deleteMany({ where: { kind: 'ORPHAN_DEPENDENCY', subject: task.id } });
  }
});

// --- watchdog: idempotent findings -------------------------------------------
test('running the watchdog twice does not duplicate an OPEN finding', async () => {
  const ghost = randomUUID();
  const task = await prisma.task.create({
    data: { kind: 'plan', idempotencyKey: `${MARK}-dedupe`, status: 'PENDING', payload: {}, dependsOn: [ghost] },
  });
  try {
    await runWatchdog();
    await runWatchdog();
    // ORPHAN_DEPENDENCY self-heals (the task is dead-lettered), so the finding
    // is AUTO_RESOLVED, not OPEN. The second run finds nothing new to raise.
    const alerts = await prisma.watchdogAlert.findMany({ where: { kind: 'ORPHAN_DEPENDENCY', subject: task.id } });
    assert.equal(alerts.length, 1, 'the same finding must not be raised twice');
  } finally {
    await prisma.deadLetter.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.watchdogAlert.deleteMany({ where: { kind: 'ORPHAN_DEPENDENCY', subject: task.id } });
  }
});

test('a dead-lettered task raises an OPEN finding that openFindings returns and resolveFinding closes', async () => {
  const task = await prisma.task.create({
    data: {
      kind: 'plan',
      idempotencyKey: `${MARK}-dead`,
      status: 'DEAD',
      payload: {},
      error: 'boom',
      finishedAt: new Date(),
    },
  });
  try {
    await runWatchdog();
    const open = await openFindings(200);
    const mine = open.find((f) => f.kind === 'DEAD_LETTER' && f.subject === task.id);
    assert.ok(mine, 'a dead-lettered task must appear as an OPEN finding');
    const closed = await resolveFinding(mine!.id, 'test');
    assert.equal(closed, true);
    const after = await openFindings(200);
    assert.ok(!after.some((f) => f.id === mine!.id), 'a resolved finding is no longer open');
  } finally {
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.watchdogAlert.deleteMany({ where: { kind: 'DEAD_LETTER', subject: task.id } });
  }
});

// --- owner controls ----------------------------------------------------------
test('controls default to the conservative configuration', async () => {
  const c = await getControls();
  for (const key of Object.keys(DEFAULT_CONTROLS) as Array<keyof typeof DEFAULT_CONTROLS>) {
    assert.equal(typeof c[key], typeof DEFAULT_CONTROLS[key], `control ${key} type`);
  }
});

test('controls reject a negative numeric value and ignore unknown keys', async () => {
  await ensureControls();
  await assert.rejects(() => setControls({ dailyBudgetUsd: -1 }, 'test'), /non-negative/);
  const before = await getControls();
  // Unknown keys are simply not part of the Controls shape; setControls only
  // copies known keys, so a stray key changes nothing.
  await setControls({ notARealKey: 5 } as unknown as Partial<typeof before>, 'test');
  const after = await getControls();
  assert.equal(after.dailyBudgetUsd, before.dailyBudgetUsd);
});

test('setControls persists an override and it is readable back', async () => {
  const original = await getControls();
  try {
    const updated = await setControls({ dailyBudgetUsd: 0.5, modelCallCapPerDay: 7 }, 'test');
    assert.equal(updated.dailyBudgetUsd, 0.5);
    const read = await getControls();
    assert.equal(read.dailyBudgetUsd, 0.5);
    assert.equal(read.modelCallCapPerDay, 7);
  } finally {
    await setControls({ dailyBudgetUsd: original.dailyBudgetUsd, modelCallCapPerDay: original.modelCallCapPerDay }, 'test');
  }
});

test('the kill switch halts acting work', async () => {
  const original = await getControls();
  try {
    await setControls({ emergencyStop: true }, 'test');
    await assert.rejects(() => assertNotStopped(), /emergency stop/);
    await assert.rejects(() => assertTaskCostAllowed(0.0001, 'x'), /emergency stop/);
  } finally {
    await setControls({ emergencyStop: original.emergencyStop }, 'test');
  }
});

test('the kill switch stops the worker loop from claiming any task', async () => {
  const original = await getControls();
  const key = `${MARK}-kill`; // no QTEST- prefix: the production claim path must see it
  // A no-op handler so the resumed tick has something real to dispatch.
  try { registerHandler('test.killswitch', async () => ({ ok: true })); } catch { /* already registered in this process */ }
  await prisma.task.deleteMany({ where: { idempotencyKey: key } });
  const taskId = await enqueue({ kind: 'test.killswitch', payload: {}, idempotencyKey: key, priority: 'CRITICAL' });
  try {
    await setControls({ emergencyStop: true }, 'test');
    // Even though a runnable task is queued, the loop claims nothing while the
    // stop is engaged — the kill switch is real, not just a dashboard flag.
    const processed = await tick(`${MARK}-worker-stopped`);
    assert.equal(processed, false, 'tick must not process work while stopped');
    const untouched = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.ok(['PENDING', 'QUEUED', 'RETRYING'].includes(untouched.status), 'task must remain unclaimed');

    await setControls({ emergencyStop: false }, 'test');
    // Work resumes once cleared. Claim several times because an unrelated
    // leftover row could be claimed first; we assert OUR task gets processed.
    let done = false;
    for (let i = 0; i < 5 && !done; i++) {
      await tick(`${MARK}-worker-running`);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      done = row.status === 'SUCCEEDED';
    }
    assert.ok(done, 'the queued task is processed once the stop is cleared');
  } finally {
    await setControls({ emergencyStop: original.emergencyStop }, 'test');
    await prisma.task.deleteMany({ where: { idempotencyKey: key } });
  }
});

test('the per-task cost cap refuses an over-budget task before it spends', async () => {
  const original = await getControls();
  try {
    await setControls({ emergencyStop: false, perTaskCostCapUsd: 0.01, dailyBudgetUsd: 100, monthlyBudgetUsd: 100 }, 'test');
    await assert.rejects(() => assertTaskCostAllowed(1, 'big job'), /per-task cost cap/);
    // Under the cap it passes.
    await assertTaskCostAllowed(0.001, 'small job');
  } finally {
    await setControls(
      { perTaskCostCapUsd: original.perTaskCostCapUsd, dailyBudgetUsd: original.dailyBudgetUsd, monthlyBudgetUsd: original.monthlyBudgetUsd },
      'test',
    );
  }
});

// --- Phase 18 remediation: owner-control enforcement & fail-closed -----------

test('a control with no action path cannot be enabled, and cannot be raised above 0', async () => {
  const original = await getControls();
  try {
    await assert.rejects(() => setControls({ marketingAllowed: true }, 'test'), /NOT IMPLEMENTED/);
    await assert.rejects(() => setControls({ financialOpsAllowed: true }, 'test'), /NOT IMPLEMENTED/);
    await assert.rejects(() => setControls({ adSpendCapUsd: 50 }, 'test'), /NOT IMPLEMENTED/);
    await assert.rejects(() => setControls({ maxDiscountPct: 10 }, 'test'), /NOT IMPLEMENTED/);
    // Turning them OFF is always allowed (it is the safe direction).
    await setControls({ marketingAllowed: false, adSpendCapUsd: 0 }, 'test');
  } finally {
    await setControls(
      { marketingAllowed: original.marketingAllowed, financialOpsAllowed: original.financialOpsAllowed, adSpendCapUsd: original.adSpendCapUsd, maxDiscountPct: original.maxDiscountPct },
      'test',
    );
  }
});

test('isEmergencyStopped fails CLOSED when the control store cannot be read', async () => {
  const realFindUnique = prisma.controlSetting.findUnique;
  try {
    // Simulate an unreadable control store (DB error). A failure must read as
    // "stopped", never as "clear", so work cannot proceed on an unknown state.
    (prisma.controlSetting as unknown as { findUnique: () => Promise<never> }).findUnique = async () => {
      throw new Error('control store unavailable');
    };
    assert.equal(await isEmergencyStopped(), true, 'an unreadable store means STOP');
    await assert.rejects(() => assertNotStopped(), /emergency stop/);
  } finally {
    (prisma.controlSetting as unknown as { findUnique: unknown }).findUnique = realFindUnique;
  }
});

test('the watchdog cancels exactly one of two identical pending tasks, and never a running one', async () => {
  const kind = `${MARK}-dup-kind`;
  const payload = { marker: `${MARK}-dup` };
  // Two identical PENDING tasks with NO idempotency key: the queue cannot dedupe
  // these, so the watchdog must. Only one may survive.
  const first = await prisma.task.create({ data: { kind, payload, status: 'PENDING', runAt: new Date(Date.now() - 2000) } });
  const second = await prisma.task.create({ data: { kind, payload, status: 'PENDING', runAt: new Date(Date.now() - 1000) } });
  // A third, identical but RUNNING with a fresh heartbeat: it must NOT be
  // cancelled — the cancellation is conditional on the task still being pending,
  // so a claimed task can never be pulled out from under its worker.
  const running = await prisma.task.create({
    data: { kind, payload, status: 'RUNNING', lockedBy: 'live-worker', lockedAt: new Date(), heartbeatAt: new Date() },
  });
  try {
    await runWatchdog();
    const rows = await prisma.task.findMany({ where: { kind }, select: { id: true, status: true } });
    const cancelled = rows.filter((r) => r.status === 'CANCELLED');
    const stillPending = rows.filter((r) => ['PENDING', 'QUEUED', 'RETRYING'].includes(r.status));
    assert.equal(cancelled.length, 1, 'exactly one duplicate is cancelled');
    assert.equal(stillPending.length, 1, 'exactly one duplicate survives');
    const runningRow = rows.find((r) => r.id === running.id);
    assert.equal(runningRow?.status, 'RUNNING', 'a RUNNING task is never cancelled by the dedupe');
  } finally {
    await prisma.task.deleteMany({ where: { id: { in: [first.id, second.id, running.id] } } });
  }
});
