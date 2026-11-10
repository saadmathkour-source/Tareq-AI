import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAllHandlers } from '../src/lib/core/handlers.ts';
import { registeredKinds } from '../src/lib/core/orchestrator.ts';
import { knownTemplates, templateFor } from '../src/lib/planner/index.ts';
import { DEFAULT_SCHEDULES } from '../src/lib/queue/scheduler.ts';

/**
 * Every task kind the system can enqueue must have a handler. A kind with no
 * handler is claimed, dead-lettered and shows as a failed task — a silent break
 * of the whole autonomous loop. These tests make that impossible to ship.
 */

registerAllHandlers();
const kinds = new Set(registeredKinds());

test('every plan-template step has a registered handler', () => {
  for (const goal of knownTemplates()) {
    const plan = templateFor(goal)!;
    for (const step of plan.steps) {
      assert.ok(kinds.has(step.kind), `template "${goal}" step "${step.key}" enqueues "${step.kind}" with no handler`);
    }
  }
});

test('the plan parent task itself has a handler', () => {
  // The planner enqueues a `plan` parent for every command; without a handler it
  // is dead-lettered and the owner sees a failed plan even when children run.
  assert.ok(kinds.has('plan'), 'plan parent task must have a handler');
});

test('every scheduled kind has a handler', () => {
  // Derived from the schedule definitions, not a hand-kept list: adding a new
  // scheduled kind without a handler would otherwise dead-letter silently every
  // time its cron fires (exactly what happened to supervisor.watchdog before
  // Phase 18 landed).
  for (const s of DEFAULT_SCHEDULES) {
    assert.ok(kinds.has(s.taskKind), `scheduled kind "${s.taskKind}" (${s.name}) has no handler`);
  }
});

test('a healthy number of handlers is registered', () => {
  assert.ok(kinds.size >= 20, `expected the full handler set, got ${kinds.size}`);
});
