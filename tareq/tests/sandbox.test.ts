import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRun, runSandbox, staticScreen } from '../src/lib/sandbox/exec.ts';

test('a pure computation returns a JSON value', () => {
  const r = safeRun('const xs = [1,2,3,4]; return { sum: xs.reduce((a,b)=>a+b,0), mean: 2.5 };');
  assert.equal(r.ok, true);
  assert.deepEqual(r.output, { sum: 10, mean: 2.5 });
});

test('print() is captured and returned as logs', () => {
  const r = safeRun('print("hello", 42); return 1;');
  assert.equal(r.ok, true);
  assert.deepEqual(r.logs, ['hello 42']);
});

test('the sandbox has no access to require, process or fetch', () => {
  for (const code of ['return typeof require;', 'return typeof process;', 'return typeof fetch;']) {
    const r = runSandbox(code);
    assert.equal(r.ok, true);
    assert.equal(r.output, 'undefined', `${code} must be undefined`);
  }
});

test('host-power references are refused before execution', () => {
  for (const code of [
    'return require("fs").readFileSync("/etc/passwd","utf8");',
    'return process.env.SECRET;',
    'return fetch("http://x");',
    'return globalThis;',
    'return eval("1+1");',
    'return new Function("return 1")();',
  ]) {
    const r = safeRun(code);
    assert.equal(r.ok, false, `${code} must be rejected`);
    assert.equal(r.screened, true);
    assert.match(r.error ?? '', /blocked pattern/);
  }
});

test('eval and Function are unavailable even if the static screen is bypassed', () => {
  // runSandbox has no screen; the context itself must still block code generation.
  const a = runSandbox('return eval("1+1");');
  assert.equal(a.ok, false);
  const b = runSandbox('return Function("return 1")();');
  assert.equal(b.ok, false);
});

test('an infinite loop is stopped by the timeout, not allowed to hang', () => {
  const r = safeRun('while (true) {}', { timeoutMs: 150 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.ok(r.durationMs < 3000, 'the run returns promptly after the timeout');
});

test('a thrown error is reported, not leaked as a crash', () => {
  const r = safeRun('throw new Error("boom");');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /boom/);
});

test('a function cannot be smuggled out of the sandbox', () => {
  const r = safeRun('return { fn: function () { return "secret"; } };');
  assert.equal(r.ok, true);
  // JSON round-trip drops the function: nothing callable crosses the boundary.
  assert.deepEqual(r.output, {});
  assert.equal(typeof (r.output as Record<string, unknown>).fn, 'undefined');
});

test('static screen accepts ordinary computation', () => {
  assert.equal(staticScreen('const x = [1,2]; return x.length;').allowed, true);
});
