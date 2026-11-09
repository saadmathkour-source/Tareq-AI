import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuneConnectionUrl, resolveDatabaseUrl, usingTestDatabase } from '../src/lib/core/db.ts';

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

test('resolveDatabaseUrl uses the isolated test DB when TAREQ_USE_TEST_DB=1', () => {
  const saved = { t: process.env.TAREQ_USE_TEST_DB, td: process.env.TEST_DATABASE_URL, d: process.env.DATABASE_URL };
  try {
    process.env.DATABASE_URL = 'postgresql://u:p@prod:6543/postgres';
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@test:6543/tareq_test';
    process.env.TAREQ_USE_TEST_DB = '1';
    assert.equal(usingTestDatabase(), true);
    assert.equal(new URL(resolveDatabaseUrl()!).pathname, '/tareq_test');
  } finally {
    if (saved.t === undefined) delete process.env.TAREQ_USE_TEST_DB; else process.env.TAREQ_USE_TEST_DB = saved.t;
    if (saved.td === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = saved.td;
    if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
  }
});

test('resolveDatabaseUrl refuses to run tests without an isolated test DB', () => {
  const saved = { t: process.env.TAREQ_USE_TEST_DB, td: process.env.TEST_DATABASE_URL, d: process.env.DATABASE_URL };
  try {
    process.env.DATABASE_URL = 'postgresql://u:p@prod:6543/postgres';
    delete process.env.TEST_DATABASE_URL;
    process.env.TAREQ_USE_TEST_DB = '1';
    assert.throws(() => resolveDatabaseUrl(), /TEST_DATABASE_URL is not set/);

    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    assert.throws(() => resolveDatabaseUrl(), /equals DATABASE_URL/);
  } finally {
    if (saved.t === undefined) delete process.env.TAREQ_USE_TEST_DB; else process.env.TAREQ_USE_TEST_DB = saved.t;
    if (saved.td === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = saved.td;
    if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
  }
});

test('the application (no flag) uses DATABASE_URL, never the test DB', () => {
  const saved = { t: process.env.TAREQ_USE_TEST_DB, td: process.env.TEST_DATABASE_URL, d: process.env.DATABASE_URL };
  try {
    process.env.DATABASE_URL = 'postgresql://u:p@prod:6543/postgres';
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@test:6543/tareq_test';
    delete process.env.TAREQ_USE_TEST_DB;
    assert.equal(usingTestDatabase(), false);
    assert.equal(new URL(resolveDatabaseUrl()!).pathname, '/postgres');
  } finally {
    if (saved.t === undefined) delete process.env.TAREQ_USE_TEST_DB; else process.env.TAREQ_USE_TEST_DB = saved.t;
    if (saved.td === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = saved.td;
    if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
  }
});
