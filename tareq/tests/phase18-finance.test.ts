import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/core/db.ts';
import { record } from '../src/lib/finance/ledger.ts';
import { financialReport } from '../src/lib/finance/report.ts';

/**
 * Phase 18 finance: an AI cost recorded on the ledger must show up in the
 * report's AI-spend line (it was always 0 before, because model spend only ever
 * hit the budget counter). Also proves the new acquisition / budget / obligation
 * sections are present and internally consistent.
 */

test('an AI_COST ledger row is reflected in the financial report', async () => {
  const before = await financialReport('all');
  const rowId = await record({ kind: 'AI_COST', amountUsd: 1.2345, provider: 'openai', evidence: { test: 'phase18' } });
  try {
    const after = await financialReport('all');
    assert.ok(after.aiSpendUsd >= before.aiSpendUsd + 1.2345 - 0.0001, 'AI spend must include the new cost');
  } finally {
    await prisma.ledgerEntry.delete({ where: { id: rowId } });
  }
});

test('the financial report exposes acquisition, budget windows and obligations', async () => {
  const report = await financialReport('daily');
  assert.ok(report.acquisition, 'acquisition section present');
  assert.equal(typeof report.acquisition.leads, 'number');
  assert.ok(report.budget, 'budget window section present');
  assert.equal(typeof report.budget.withinDaily, 'boolean');
  assert.equal(typeof report.budget.withinMonthly, 'boolean');
  assert.equal(typeof report.budget.withinCallCap, 'boolean');
  assert.ok(report.obligations, 'obligations section present');
  assert.equal(typeof report.obligations.pendingUsd, 'number');
  assert.equal(typeof report.obligations.refundsUsd, 'number');
  assert.equal(typeof report.obligations.disputesUsd, 'number');
});

test('a marketing cost is captured as CAC input, not as revenue', async () => {
  const before = await financialReport('all');
  const rowId = await record({ kind: 'MARKETING_COST', amountUsd: 3, provider: 'test', evidence: { test: 'phase18' } });
  try {
    const after = await financialReport('all');
    assert.equal(after.summary.grossRevenueUsd, before.summary.grossRevenueUsd, 'marketing spend must never be revenue');
    assert.ok(after.acquisition.marketingSpendUsd >= before.acquisition.marketingSpendUsd + 3 - 0.0001);
    assert.ok(after.summary.operatingCostsUsd >= before.summary.operatingCostsUsd + 3 - 0.0001, 'marketing is an operating cost');
  } finally {
    await prisma.ledgerEntry.delete({ where: { id: rowId } });
  }
});
