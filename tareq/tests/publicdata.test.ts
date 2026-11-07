import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSignals, type DemandSignal } from '../src/lib/integrations/publicdata.ts';

/**
 * These tests exercise the pure aggregation logic deterministically. The live
 * network connectors (hnSearch/wikiSummary) are exercised by the end-to-end
 * acceptance test, not here, so the suite never depends on the public internet.
 */

function sig(over: Partial<DemandSignal>): DemandSignal {
  return {
    source: 'hackernews',
    title: 't',
    url: 'https://example.com',
    points: 0,
    comments: 0,
    createdAt: null,
    text: '',
    ...over,
  };
}

test('summarizeSignals counts only hackernews rows toward volume', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const scan = summarizeSignals('x', [
    sig({ points: 10, createdAt: '2025-12-01T00:00:00Z' }),
    sig({ points: 30, createdAt: '2025-06-01T00:00:00Z' }),
    sig({ source: 'wikipedia', text: 'background' }),
  ], now);
  assert.equal(scan.volume, 2);
  assert.equal(scan.recentCount, 2);
  assert.equal(scan.avgPoints, 20);
});

test('summarizeSignals counts only the last year as recent', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const scan = summarizeSignals('x', [
    sig({ createdAt: '2025-12-31T00:00:00Z' }),
    sig({ createdAt: '2020-01-01T00:00:00Z' }),
  ], now);
  assert.equal(scan.volume, 2);
  assert.equal(scan.recentCount, 1);
});

test('confidence is capped at 0.5 — discussion is not proof of demand', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const many = Array.from({ length: 50 }, () => sig({ points: 500, createdAt: '2025-12-01T00:00:00Z' }));
  const scan = summarizeSignals('x', many, now);
  assert.ok(scan.confidence <= 0.5, `confidence ${scan.confidence} must not exceed 0.5`);
});

test('an empty scan reports no signals and warns that absence is not evidence', () => {
  const scan = summarizeSignals('x', []);
  assert.equal(scan.volume, 0);
  assert.equal(scan.confidence, 0);
  assert.match(scan.interpretation, /not evidence of demand/i);
});

test('interpretation always states the willingness-to-pay limitation', () => {
  const scan = summarizeSignals('x', [sig({ points: 5 })]);
  assert.match(scan.interpretation, /willingness to pay/i);
});
