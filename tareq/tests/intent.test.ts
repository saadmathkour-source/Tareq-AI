import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, routeByKeyword, extractTopic } from '../src/lib/planner/intent.ts';

const TEMPLATES = ['opportunity.discover', 'opportunity.to_offer', 'opportunity.to_sale', 'maintenance.cycle'];

test('exact template names are accepted verbatim', () => {
  const m = interpret('opportunity.discover', TEMPLATES);
  assert.equal(m.template, 'opportunity.discover');
  assert.equal(m.method, 'exact');
  assert.equal(m.confidence, 1);
});

test('english research phrasing routes to discovery', () => {
  const m = interpret('Research profitable problems in the US software market', TEMPLATES);
  assert.equal(m.template, 'opportunity.discover');
  assert.ok(m.confidence >= 0.5);
});

test('english buyer phrasing routes to sale', () => {
  const m = interpret('Find real buyers and qualified leads for our service', TEMPLATES);
  assert.equal(m.template, 'opportunity.to_sale');
});

test('english offer phrasing routes to offer', () => {
  const m = interpret('Design a productized service and price the offer', TEMPLATES);
  assert.equal(m.template, 'opportunity.to_offer');
});

test('arabic research phrasing routes to discovery', () => {
  const m = interpret('ابحث عن مشاكل مربحة في سوق البرمجيات', TEMPLATES);
  assert.equal(m.template, 'opportunity.discover');
});

test('arabic buyer phrasing routes to sale', () => {
  const m = interpret('ابحث عن مشترين وعملاء محتملين', TEMPLATES);
  assert.equal(m.template, 'opportunity.to_sale');
});

test('unrecognised text defaults to read-only discovery', () => {
  const m = interpret('zzz qqq', TEMPLATES);
  assert.equal(m.template, 'opportunity.discover');
  assert.ok(m.confidence <= 0.5);
});

test('topic extraction strips command verbs and stop-words', () => {
  const t = extractTopic('Research profitable problems in the US software market');
  assert.ok(t && t.includes('us'));
  assert.ok(t && !t.includes('research'));
});

test('keyword routing is deterministic', () => {
  const a = routeByKeyword('find buyers for our product');
  const b = routeByKeyword('find buyers for our product');
  assert.deepEqual(a, b);
  assert.equal(a?.template, 'opportunity.to_sale');
});
