import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessTrust, sourceReliability, type TrustSource } from '../src/lib/commercial/engines.ts';

const base: TrustSource = { id: 'c1', statement: 'demand exists', source: 'wikipedia', confidence: 0.8, verified: true };

test('source reliability is declared and unknown sources are never trusted highly', () => {
  assert.equal(sourceReliability('wikipedia'), 0.8);
  assert.equal(sourceReliability('WIKIPEDIA'), 0.8, 'lookup is case-insensitive');
  assert.equal(sourceReliability('some_blog_we_never_saw'), 0.4, 'unknown source defaults low');
  assert.ok(sourceReliability('model_estimate') <= 0.4, 'estimates are low trust');
});

test('provenance records the supporting chain for each claim', () => {
  const r = assessTrust([
    { ...base, id: 'root', supporting: ['mid'] },
    { ...base, id: 'mid', supporting: ['leaf'] },
    { ...base, id: 'leaf' },
  ]);
  const root = r.provenance.find((p) => p.id === 'root');
  assert.deepEqual(root?.chain, ['mid', 'leaf'], 'chain is walked transitively');
});

test('provenance survives a support cycle without looping', () => {
  const r = assessTrust([
    { ...base, id: 'a', supporting: ['b'] },
    { ...base, id: 'b', supporting: ['a'] },
  ]);
  const a = r.provenance.find((p) => p.id === 'a');
  assert.ok((a?.chain.length ?? 0) <= 2, 'cycle is bounded');
});

test('confidence is propagated and weighted by source reliability', () => {
  const r = assessTrust([
    { ...base, id: 'strong', source: 'owner', confidence: 0.9 },
    { ...base, id: 'weak', source: 'model_estimate', confidence: 0.9 },
  ]);
  // owner(0.95)*0.9 + model(0.3)*0.9  / (0.95+0.3) = 0.9
  assert.equal(r.confidence, 0.9);
  // reliability mean = (0.95 + 0.3)/2 = 0.625
  assert.equal(r.sourceReliability, 0.63);
});

test('stale evidence is flagged and withheld', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const r = assessTrust([{ ...base, id: 'old', validUntil: past }]);
  assert.deepEqual(r.staleIds, ['old']);
  assert.equal(r.publishableIds.includes('old'), false);
  assert.ok(r.blockers.some((b) => b.includes('old') && b.includes('stale')));
});

test('contradictory evidence lowers confidence and raises uncertainty', () => {
  const clean = assessTrust([{ ...base, id: 'x', confidence: 0.9 }]);
  const contradicted = assessTrust([
    { ...base, id: 'x', confidence: 0.9, contradicting: ['y'] },
    { ...base, id: 'y', confidence: 0.9 },
  ]);
  assert.ok(contradicted.confidence < clean.confidence, 'a contradiction reduces confidence');
  assert.ok(contradicted.uncertainty > clean.uncertainty, 'a contradiction widens uncertainty');
  assert.ok(contradicted.contradictionIds.includes('x'));
  assert.ok(contradicted.blockers.some((b) => b.includes('contradicted')));
});

test('uncertainty is the complement of confidence, widened by contradictions', () => {
  const r = assessTrust([{ ...base, id: 'only', confidence: 1 }]);
  assert.equal(r.confidence, 1);
  assert.equal(r.uncertainty, 0);
});

test('unverified and low-confidence claims are never publishable', () => {
  const r = assessTrust([
    { ...base, id: 'unverified', verified: false, confidence: 0.9 },
    { ...base, id: 'lowconf', confidence: 0.5 },
    { ...base, id: 'good', confidence: 0.8 },
  ]);
  assert.deepEqual(r.publishableIds, ['good']);
  assert.ok(r.blockers.some((b) => b.includes('unverified') && b.includes('not verified')));
  assert.ok(r.blockers.some((b) => b.includes('lowconf') && b.includes('confidence below 0.6')));
});

test('an empty evidence set yields zero trust, not a default pass', () => {
  const r = assessTrust([]);
  assert.equal(r.confidence, 0);
  assert.equal(r.sourceReliability, 0);
  assert.deepEqual(r.publishableIds, []);
});
