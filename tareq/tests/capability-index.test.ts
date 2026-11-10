import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, summary, getCapability, type CapStatus } from '../src/lib/capabilities/index.ts';

const VALID: CapStatus[] = [
  'VERIFIED_PRODUCTION',
  'IMPLEMENTED_NOT_VERIFIED',
  'PARTIAL',
  'UI_ONLY',
  'BACKEND_ONLY',
  'BLOCKED_BY_CONFIG',
  'NOT_IMPLEMENTED',
  'DEPRECATED_OR_DUPLICATE',
];

test('capability index has exactly 100 groups with unique ids 1..100', () => {
  assert.equal(CAPABILITIES.length, 100);
  const ids = CAPABILITIES.map((c) => c.n).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, i) => i + 1));
});

test('every capability uses a valid five-value status', () => {
  for (const c of CAPABILITIES) assert.ok(VALID.includes(c.status), `cap ${c.n} has invalid status ${c.status}`);
});

test('every capability carries a description and at least one evidence reference', () => {
  for (const c of CAPABILITIES) {
    assert.ok(c.description && c.description.length > 3, `cap ${c.n} needs a description`);
    assert.ok((c.evidence ?? []).length >= 1, `cap ${c.n} needs evidence`);
  }
});

test('nothing is VERIFIED_PRODUCTION without a concrete evidence reference', () => {
  for (const c of CAPABILITIES) {
    if (c.status === 'VERIFIED_PRODUCTION') {
      assert.ok((c.evidence ?? []).length >= 1, `verified cap ${c.n} must name evidence`);
    }
  }
});

test('current registry does not promote source-only evidence to production status', () => {
  assert.deepEqual(summary(), {
    VERIFIED_PRODUCTION: 0,
    IMPLEMENTED_NOT_VERIFIED: 19,
    PARTIAL: 9,
    UI_ONLY: 0,
    BACKEND_ONLY: 72,
    BLOCKED_BY_CONFIG: 0,
    NOT_IMPLEMENTED: 0,
    DEPRECATED_OR_DUPLICATE: 0,
  });
});

test('summary counts add up to 100 and match the index', () => {
  const s = summary();
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), 100);
  for (const st of VALID) assert.equal(s[st], CAPABILITIES.filter((c) => c.status === st).length);
});

test('getCapability finds a group by number', () => {
  assert.equal(getCapability(1)?.n, 1);
  assert.equal(getCapability(100)?.n, 100);
  assert.equal(getCapability(999), undefined);
});
