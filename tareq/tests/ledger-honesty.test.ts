import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/core/db.ts';
import { isTestExternalId, recordRevenue, summary } from '../src/lib/finance/ledger.ts';

test('isTestExternalId flags Stripe test object ids and not live ids', () => {
  assert.equal(isTestExternalId('it_test_pi_1'), true);
  assert.equal(isTestExternalId('cs_test_a1b2'), true);
  assert.equal(isTestExternalId('evt_test_9'), true);
  assert.equal(isTestExternalId('pi_3NliveReal'), false);
  assert.equal(isTestExternalId('cs_live_a1b2'), false);
  assert.equal(isTestExternalId(null), false);
  assert.equal(isTestExternalId(undefined), false);
});

test('a revenue row carrying a Stripe test marker is never counted as revenue', async () => {
  const externalId = `it_test_${randomUUID()}`;
  const before = await summary();
  const rowId = await recordRevenue({
    amountUsd: 4242,
    externalId,
    provider: 'stripe',
    evidence: { webhookEventId: 'evt_test_fixture', signatureVerified: true },
  });
  try {
    const after = await summary();
    // The fixture must not move the headline revenue number...
    assert.equal(after.grossRevenueUsd, before.grossRevenueUsd, 'test fixture must not inflate gross revenue');
    // ...but it must be visible as test volume.
    assert.equal(after.testTransactionsUsd, before.testTransactionsUsd + 4242);
  } finally {
    await prisma.ledgerEntry.delete({ where: { id: rowId } });
  }
});
