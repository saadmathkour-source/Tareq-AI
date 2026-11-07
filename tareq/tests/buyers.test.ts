import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanComment, relevance } from '../src/lib/integrations/buyers.ts';

/**
 * Deterministic tests for the pure parts of the buyer-discovery connector. The
 * live Hacker News fetch is exercised by the end-to-end test, so this suite
 * never depends on the public internet.
 */

test('cleanComment strips tags and decodes common entities', () => {
  const html = 'Hi <b>there</b> &#x2F; use &quot;this&quot; &amp; that&#x27;s it';
  const out = cleanComment(html);
  assert.equal(out, 'Hi there / use "this" & that\'s it');
});

test('cleanComment collapses whitespace', () => {
  assert.equal(cleanComment('a   \n  b'), 'a b');
});

test('relevance is 1 when all meaningful terms appear', () => {
  assert.equal(relevance('invoicing freelancers', 'I build invoicing tools for freelancers'), 1);
});

test('relevance is 0 when no meaningful terms appear', () => {
  assert.equal(relevance('invoicing freelancers', 'completely unrelated content here'), 0);
});

test('relevance is fractional for partial term overlap', () => {
  // 'invoicing' matches, 'freelancers' does not -> 1/2
  assert.equal(relevance('invoicing freelancers', 'invoicing for teams'), 0.5);
});

test('relevance ignores short filler words', () => {
  // only 'invoice' (>=3 chars) is meaningful; 'a' and 'of' are ignored
  assert.equal(relevance('a of invoice', 'an invoice example'), 1);
});

test('relevance of an empty topic is 0, not NaN', () => {
  assert.equal(relevance('a b', 'anything'), 0);
});
