import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES } from '../src/lib/capabilities/index.ts';
import {
  ANALYTICAL_CAPABILITY_IDS,
  analyticalCapabilityInfo,
  evaluateAnalyticalCapability,
} from '../src/lib/capabilities/execution.ts';

test('every analytical capability 29–100 has exactly one explicit execution mapping', () => {
  assert.deepEqual(ANALYTICAL_CAPABILITY_IDS, Array.from({ length: 72 }, (_, i) => i + 29));
  for (const id of ANALYTICAL_CAPABILITY_IDS) {
    assert.ok(analyticalCapabilityInfo(id), 'missing engine for capability ' + id);
    assert.equal(CAPABILITIES.find(c => c.n === id)?.status, 'BACKEND_ONLY',
      'evaluation does not constitute production verification');
  }
  assert.equal(analyticalCapabilityInfo(28), null);
  assert.equal(analyticalCapabilityInfo(101), null);
});

test('capability 65 runs real deterministic willingness-to-pay analysis and reports zero sales', () => {
  const report = evaluateAnalyticalCapability(65, [[{
    priceUsd: 100, impressions: 100, trials: 10, purchases: 0,
  }]]);
  assert.equal(report.productionVerified, false);
  assert.equal(report.externalActionPerformed, false);
  assert.equal((report.result as Array<{ purchaseRate: number }>)[0]?.purchaseRate, 0);
});

test('breaker 57 and budget governor 91 are local simulations, not real permission or spend changes', () => {
  const breaker = evaluateAnalyticalCapability(57, [2, 60000, [false, false]]);
  assert.equal((breaker.result as {finalState: string}).finalState, 'open');
  const budget = evaluateAnalyticalCapability(91, [5, [1, 3, 3]]);
  assert.equal((budget.result as {remainingUsd: number}).remainingUsd, 1);
  assert.deepEqual((budget.result as {decisions: Array<{permitted: boolean}>}).decisions.map(x => x.permitted), [true, true, false]);
});

test('no privileged capabilities or unsupported IDs can run through the analytical router', () => {
  for (const id of [-1, 0, 1, 10, 28, 101, 999]) {
    assert.throws(() => evaluateAnalyticalCapability(id, []), /analytical engine/);
  }
});

test('rejects oversized and malformed untrusted inputs before execution', () => {
  assert.throws(() => evaluateAnalyticalCapability(65, {} as never), /JSON array/);
  assert.throws(() => evaluateAnalyticalCapability(65, Array(9).fill(1)), /at most 8/);
  assert.throws(() => evaluateAnalyticalCapability(65, [Infinity]), /non-finite/);
  assert.throws(() => evaluateAnalyticalCapability(65, ['x'.repeat(2049)]), /string too long/);
  assert.throws(() => evaluateAnalyticalCapability(65, [[...Array(101).fill(0)]]), /array too long/);
});

test('mismatched inputs surface failure and are never treated as a successful execution', () => {
  assert.throws(() => evaluateAnalyticalCapability(91, [-1, []]), /budget input/);
  assert.throws(() => evaluateAnalyticalCapability(57, [0, 100, []]), /breaker input/);
});
