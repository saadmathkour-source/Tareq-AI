import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuneConnectionUrl } from '../src/lib/core/db.ts';

/**
 * The owner dashboard fires ~13 parallel reads on load. A Supabase template
 * `connection_limit=1` starves that burst and every extra query dies with
 * "Timed out fetching a new connection from the connection pool", which the
 * UI shows as a failed sign-in. tuneConnectionUrl raises the floor.
 */

test('tuneConnectionUrl raises connection_limit=1 to the floor', () => {
  const out = tuneConnectionUrl('postgresql://u:p@h:5432/postgres?schema=tareq&pgbouncer=true&connection_limit=1');
  const u = new URL(out!);
  assert.equal(u.searchParams.get('connection_limit'), '10');
  assert.equal(u.searchParams.get('schema'), 'tareq');
  assert.equal(u.searchParams.get('pgbouncer'), 'true');
});

test('tuneConnectionUrl adds a limit when none is set', () => {
  const u = new URL(tuneConnectionUrl('postgresql://u:p@h:5432/postgres')!);
  assert.equal(u.searchParams.get('connection_limit'), '10');
  assert.equal(u.searchParams.get('pool_timeout'), '20');
});

test('tuneConnectionUrl never lowers a larger configured limit', () => {
  const u = new URL(tuneConnectionUrl('postgresql://u:p@h:5432/postgres?connection_limit=25')!);
  assert.equal(u.searchParams.get('connection_limit'), '25');
});

test('tuneConnectionUrl leaves an unparseable URL untouched', () => {
  assert.equal(tuneConnectionUrl('not a url'), 'not a url');
  assert.equal(tuneConnectionUrl(undefined), undefined);
});
