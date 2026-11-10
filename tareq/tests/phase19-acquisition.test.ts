import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/core/db.ts';
import { articleProductSlug, publishArticle, getPublishedArticle } from '../src/lib/commercial/publishing.ts';
import { createInquiry, answerInquiry } from '../src/lib/commercial/inquiries.ts';
import { getControls, setControls } from '../src/lib/security/controls.ts';
import { publishDraftWithinOwnerScope, registerAllHandlers } from '../src/lib/core/handlers.ts';
import { registeredKinds } from '../src/lib/core/orchestrator.ts';

/**
 * Phase 19 — organic publishing and inbound handling.
 *
 * Proves the two new acquisition legs are real and correctly gated:
 *  - an article cannot be published without the owner's content permission, and
 *    cannot pass QA without a traceable source;
 *  - an inbound inquiry is answered from verified product data (no invention)
 *    and is NOT emailed unless the owner has granted email permission.
 */

const SOURCE = [{ title: 'Hacker News discussion', url: 'https://news.ycombinator.com/item?id=1' }];

async function withContent(allow: boolean, fn: () => Promise<void>): Promise<void> {
  const before = await getControls();
  await setControls({ contentPublishingAllowed: allow }, 'test');
  try {
    await fn();
  } finally {
    await setControls({ contentPublishingAllowed: before.contentPublishingAllowed }, 'test');
  }
}

test('an article is refused while content publishing is off', async () => {
  await withContent(false, async () => {
    const art = await prisma.article.create({
      data: { slug: `t-off-${Date.now()}`, title: 'T', summary: 'S', bodyHtml: '<p>x</p>', sources: SOURCE as never },
    });
    try {
      await assert.rejects(() => publishArticle(art.slug, 'test'), /content publishing is not permitted/);
    } finally {
      await prisma.article.delete({ where: { id: art.id } });
    }
  });
});

test('an article with a traceable source publishes when permitted and becomes public', async () => {
  await withContent(true, async () => {
    const slug = `t-on-${Date.now()}`;
    const art = await prisma.article.create({
      data: { slug, title: 'Real title', summary: 'Real summary', bodyHtml: '<p>x</p>', sources: SOURCE as never },
    });
    try {
      const res = await publishArticle(slug, 'test');
      assert.equal(res.status, 'PUBLISHED');
      const pub = await getPublishedArticle(slug);
      assert.ok(pub, 'a published article is retrievable for the public page');
    } finally {
      await prisma.article.delete({ where: { id: art.id } });
    }
  });
});

test('an article with no traceable source fails QA and cannot be published', async () => {
  await withContent(true, async () => {
    const art = await prisma.article.create({
      data: { slug: `t-nosrc-${Date.now()}`, title: 'T', summary: 'S', bodyHtml: '<p>x</p>', sources: [] as never },
    });
    try {
      await assert.rejects(() => publishArticle(art.slug, 'test'), /fails QA/);
    } finally {
      await prisma.article.delete({ where: { id: art.id } });
    }
  });
});

test('an article with a non-HTTPS source fails QA and cannot be published', async () => {
  await withContent(true, async () => {
    const art = await prisma.article.create({
      data: {
        slug: `t-badsrc-${Date.now()}`,
        title: 'T',
        summary: 'S',
        bodyHtml: '<p>x</p>',
        sources: [{ title: 'Untrusted link', url: 'javascript:alert(1)' }] as never,
      },
    });
    try {
      await assert.rejects(() => publishArticle(art.slug, 'test'), /at least one titled HTTPS source/);
    } finally {
      await prisma.article.delete({ where: { id: art.id } });
    }
  });
});

test('organic article defaults to the flagship checkout only while the offer is published', async () => {
  const product = await prisma.product.findUnique({ where: { slug: 'market-opportunity-report' } });
  assert.ok(product, 'isolated bootstrap seeds the flagship product');
  const before = product!.status;
  try {
    await prisma.product.update({ where: { id: product!.id }, data: { status: 'PUBLISHED' } });
    assert.equal(await articleProductSlug(), 'market-opportunity-report');
    await prisma.product.update({ where: { id: product!.id }, data: { status: 'DRAFT' } });
    assert.equal(await articleProductSlug(), null, 'a draft product must not be advertised');
  } finally {
    await prisma.product.update({ where: { id: product!.id }, data: { status: before } });
  }
});

test('scheduled article publishing stays draft by default and publishes only with owner content permission', async () => {
  const slug = `t-scheduled-${Date.now()}`;
  const art = await prisma.article.create({
    data: { slug, title: 'Market evidence', summary: 'A sourced summary', bodyHtml: '<p>Useful guidance</p>', sources: SOURCE as never },
  });
  try {
    await withContent(false, async () => {
      const result = await publishDraftWithinOwnerScope(slug);
      assert.equal(result.status, 'DRAFT');
      assert.equal(result.skipped, 'owner content-publishing permission is off');
      assert.equal(await getPublishedArticle(slug), null);
    });
    await withContent(true, async () => {
      const result = await publishDraftWithinOwnerScope(slug);
      assert.equal(result.status, 'PUBLISHED');
      assert.equal(result.publicPath, `/insights/${slug}`);
      assert.ok(await getPublishedArticle(slug));
    });
  } finally {
    await prisma.article.delete({ where: { id: art.id } });
  }
});

test('an inquiry requires a valid email and a non-trivial message', async () => {
  await assert.rejects(() => createInquiry({ email: 'not-an-email', message: 'hello there' }), /valid email/);
  await assert.rejects(() => createInquiry({ email: 'a@b.com', message: 'x' }), /short question/);
});

test('an inbound inquiry is answered from verified product data and not emailed while outreach is off', async () => {
  const before = await getControls();
  await setControls({ outreachAllowed: false }, 'test');
  const product = await prisma.product.create({
    data: {
      slug: `t-prod-${Date.now()}`,
      name: 'Test Opportunity Report',
      tagline: 'A fixed-scope research report',
      problem: 'unclear demand',
      solution: 'source-cited research',
      priceUsd: 149,
      status: 'PUBLISHED',
      deliverables: ['A source-cited report'] as never,
      requirements: ['Your target niche'] as never,
      limitations: ['Not financial advice'] as never,
    },
  });
  const { id } = await createInquiry({ email: 'buyer@example.com', message: 'What exactly do I receive?', productSlug: product.slug });
  try {
    const res = await answerInquiry(id);
    assert.equal(res.answered, true);
    assert.equal(res.sent, false, 'no email may be sent while outreach is off');
    const row = await prisma.inquiry.findUnique({ where: { id } });
    assert.ok(row?.answer, 'an answer is stored');
    assert.ok(row!.answer!.includes(product.name), 'the answer quotes the real product name');
    assert.ok(row!.answer!.includes('A source-cited report'), 'the answer uses the product\u2019s verified deliverables');
    assert.equal(row?.replySentAt, null, 'no reply is recorded as sent');
  } finally {
    await prisma.inquiry.delete({ where: { id } });
    await prisma.product.delete({ where: { id: product.id } });
    await setControls({ outreachAllowed: before.outreachAllowed }, 'test');
  }
});

test('an answered but undelivered inquiry can retry delivery without regenerating its answer', async () => {
  const before = await getControls();
  await setControls({ outreachAllowed: false }, 'test');
  const storedAnswer = 'Previously prepared reply from verified product data.';
  const { id } = await createInquiry({ email: 'retry@example.com', message: 'Please answer my question.' });
  try {
    await prisma.inquiry.update({
      where: { id },
      data: { status: 'ANSWERED', answer: storedAnswer, answeredAt: new Date() },
    });

    const result = await answerInquiry(id);
    const row = await prisma.inquiry.findUnique({ where: { id } });
    assert.equal(result.answered, true);
    assert.equal(result.sent, false, 'retry remains gated while owner email permission is off');
    assert.equal(row?.answer, storedAnswer, 'retry reuses the existing answer');
    assert.equal(row?.replySentAt, null, 'a blocked retry is not recorded as sent');
  } finally {
    await prisma.inquiry.delete({ where: { id } });
    await setControls({ outreachAllowed: before.outreachAllowed }, 'test');
  }
});

test('the emergency stop blocks public inquiry handling before it changes the inquiry', async () => {
  const before = await getControls();
  const { id } = await createInquiry({ email: 'stopped@example.com', message: 'Please answer this question.' });
  await setControls({ emergencyStop: true }, 'test');
  try {
    await assert.rejects(() => answerInquiry(id), /emergency stop is engaged/);
    const row = await prisma.inquiry.findUnique({ where: { id } });
    assert.equal(row?.status, 'NEW', 'the inquiry remains untouched while stopped');
    assert.equal(row?.answer, null);
  } finally {
    await prisma.inquiry.delete({ where: { id } });
    await setControls({ emergencyStop: before.emergencyStop }, 'test');
  }
});

test('the new acquisition handlers are registered', () => {
  registerAllHandlers();
  const kinds = new Set(registeredKinds());
  assert.ok(kinds.has('content.draft_article'), 'content.draft_article handler must exist');
  assert.ok(kinds.has('content.publish_article'), 'reviewed drafts can use the real publisher without a model call');
  assert.ok(kinds.has('inquiry.answer'), 'inquiry.answer handler must exist');
});
