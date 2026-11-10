import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentReliability,
  dependencyIntegrity,
  duplicateSuppression,
  allocateResources,
  optimizationReport,
  commercialReadiness,
  budgetWindows,
  type ModelProfile,
  type PendingTask,
} from '../src/lib/commercial/optimization.ts';

// --- agent reliability -------------------------------------------------------
test('a single failure is not enough to call an agent degraded', () => {
  const r = agentReliability('a', [{ ok: true, costUsd: 0.01 }, { ok: false, costUsd: 0.01 }], 3);
  assert.equal(r.degraded, false);
  assert.equal(r.recommendation, 'watch');
});

test('an agent failing at least half its recent runs is degraded and paused', () => {
  const runs = [{ ok: false, costUsd: 0.02 }, { ok: false, costUsd: 0.02 }, { ok: true, costUsd: 0.02 }, { ok: false, costUsd: 0.02 }];
  const r = agentReliability('b', runs);
  assert.equal(r.degraded, true);
  assert.equal(r.recommendation, 'pause');
  assert.equal(r.failureRate, 0.75);
});

test('a healthy agent reports healthy with its average cost', () => {
  const r = agentReliability('c', [{ ok: true, costUsd: 0.01 }, { ok: true, costUsd: 0.03 }, { ok: true, costUsd: 0.02 }]);
  assert.equal(r.recommendation, 'healthy');
  assert.equal(r.avgCostUsd, 0.02);
});

// --- dependency integrity ----------------------------------------------------
test('dependencyIntegrity finds orphan and failed-blocked tasks', () => {
  const nodes = [
    { id: 'a', dependsOn: ['ghost'], status: 'PENDING' },
    { id: 'b', dependsOn: ['c'], status: 'PENDING' },
    { id: 'c', dependsOn: [], status: 'DEAD' },
    { id: 'd', dependsOn: [], status: 'PENDING' },
  ];
  const res = dependencyIntegrity(nodes);
  assert.equal(res.ok, false);
  assert.deepEqual(res.orphans, [{ id: 'a', missing: ['ghost'] }]);
  assert.deepEqual(res.blockedByFailed, [{ id: 'b', failed: ['c'] }]);
});

test('dependencyIntegrity is ok when every prerequisite exists and is healthy', () => {
  const res = dependencyIntegrity([
    { id: 'a', dependsOn: [], status: 'SUCCEEDED' },
    { id: 'b', dependsOn: ['a'], status: 'PENDING' },
  ]);
  assert.equal(res.ok, true);
});

// --- duplicate suppression ---------------------------------------------------
test('duplicateSuppression keeps the earliest and flags later copies', () => {
  const tasks: PendingTask[] = [
    { id: '2', kind: 'x', payload: { a: 1, b: 2 }, createdAt: '2020-01-02T00:00:00Z' },
    { id: '1', kind: 'x', payload: { b: 2, a: 1 }, createdAt: '2020-01-01T00:00:00Z' },
    { id: '3', kind: 'y', payload: { a: 1 }, createdAt: '2020-01-01T00:00:00Z' },
  ];
  const { keep, duplicates } = duplicateSuppression(tasks);
  // Key order must not matter: the two `x` payloads are the same job.
  assert.deepEqual(duplicates, ['2']);
  assert.ok(keep.includes('1'));
  assert.ok(keep.includes('3'));
});

test('duplicateSuppression never touches keyed tasks (queue already dedupes them)', () => {
  const tasks: PendingTask[] = [
    { id: '1', kind: 'x', payload: {}, idempotencyKey: 'k1', createdAt: '2020-01-01T00:00:00Z' },
    { id: '2', kind: 'x', payload: {}, idempotencyKey: 'k2', createdAt: '2020-01-02T00:00:00Z' },
  ];
  const { duplicates } = duplicateSuppression(tasks);
  assert.deepEqual(duplicates, []);
});

// --- resource allocation -----------------------------------------------------
const MODELS: ModelProfile[] = [
  { name: 'cheap', quality: 0.5, costPer1k: 0.001 },
  { name: 'mid', quality: 0.75, costPer1k: 0.005 },
  { name: 'strong', quality: 0.95, costPer1k: 0.02 },
];

test('allocateResources picks the cheapest model that clears the quality bar', () => {
  const a = allocateResources({ kind: 'research', requiredQuality: 0.7, tokens: 1000 }, MODELS);
  assert.equal(a.model, 'mid');
  assert.ok(a.estimatedCostUsd > 0);
});

test('allocateResources refuses to downgrade below the quality bar', () => {
  const a = allocateResources({ kind: 'legal', requiredQuality: 0.99, tokens: 1000 }, MODELS);
  assert.equal(a.model, null);
  assert.match(a.reason, /no model meets quality/);
});

// --- optimization report -----------------------------------------------------
test('optimizationReport classifies products by realised margin', () => {
  const report = optimizationReport([
    { slug: 'win', name: 'Win', priceUsd: 100, unitCostUsd: 10, orders: 10, revenueUsd: 1000, costUsd: 100 },
    { slug: 'loss', name: 'Loss', priceUsd: 100, unitCostUsd: 120, orders: 3, revenueUsd: 300, costUsd: 360 },
    { slug: 'thin', name: 'Thin', priceUsd: 100, unitCostUsd: 90, orders: 4, revenueUsd: 400, costUsd: 360 },
    { slug: 'new', name: 'New', priceUsd: 100, unitCostUsd: 10, orders: 0, revenueUsd: 0, costUsd: 0 },
  ]);
  const byslug = Object.fromEntries(report.products.map((p) => [p.slug, p.verdict]));
  assert.equal(byslug['win'], 'scale');
  assert.equal(byslug['loss'], 'stop');
  assert.equal(byslug['thin'], 'fix');
  // No sales is not evidence of failure: it is held, never stopped.
  assert.equal(byslug['new'], 'hold');
  assert.ok(report.requiresOwnerApproval.some((s) => s.includes('Loss')));
});

// --- readiness ---------------------------------------------------------------
test('commercialReadiness never upgrades an unverified item and lists blockers', () => {
  const r = commercialReadiness([
    { n: 1, name: 'discover', verified: true, evidence: 'claims>0' },
    { n: 8, name: 'live payment', verified: false, evidence: 'none', blockedBy: 'no live payment received yet' },
  ]);
  assert.equal(r.verified, 1);
  assert.equal(r.complete, false);
  assert.equal(r.blockers.length, 1);
  assert.match(r.blockers[0]!, /no live payment/);
});

// --- budget windows ----------------------------------------------------------
test('budgetWindows flags which limits are breached', () => {
  const ok = budgetWindows({ todayUsd: 1, dailyCapUsd: 5, monthUsd: 10, monthlyCapUsd: 20, callsToday: 10, callCapPerDay: 100 });
  assert.ok(ok.withinDaily && ok.withinMonthly && ok.withinCallCap);
  const breach = budgetWindows({ todayUsd: 6, dailyCapUsd: 5, monthUsd: 25, monthlyCapUsd: 20, callsToday: 101, callCapPerDay: 100 });
  assert.equal(breach.withinDaily, false);
  assert.equal(breach.withinMonthly, false);
  assert.equal(breach.withinCallCap, false);
  assert.equal(breach.utilisation, 1);
});
