import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAllHandlers } from '../src/lib/core/handlers.ts';
import { registeredKinds } from '../src/lib/core/orchestrator.ts';
import { knownTemplates, templateFor } from '../src/lib/planner/index.ts';

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

test('the scheduler seed kinds all have handlers', () => {
  for (const kind of ['maintenance.cycle', 'maintenance.evidence_freshness']) {
    assert.ok(kinds.has(kind), `scheduled kind "${kind}" has no handler`);
  }
});

test('a healthy number of handlers is registered', () => {
  assert.ok(kinds.size >= 20, `expected the full handler set, got ${kinds.size}`);
});
