import test from 'node:test';
import assert from 'node:assert/strict';
import { statusForError } from '../src/app/server.ts';
import { ForbiddenError, ValidationError, LimitExceededError } from '../src/lib/core/errors.ts';

/**
 * The API must report honest status codes. A bad password is 401, not 500 —
 * otherwise an authentication failure looks like a server crash and hides the
 * real cause from the owner and from monitoring.
 */

test('a bad login (ForbiddenError) maps to 401, never 500', () => {
  const r = statusForError(new ForbiddenError('Invalid credentials'));
  assert.equal(r.status, 401);
  // The message is deliberately generic so it cannot confirm whether an email exists.
  assert.equal(r.body.error, 'unauthorized');
});

test('a validation failure maps to 400 with its message', () => {
  const r = statusForError(new ValidationError('bad input'));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad input');
});

test('other typed errors map to 422', () => {
  const r = statusForError(new LimitExceededError('budget', 'over cap'));
  assert.equal(r.status, 422);
});

test('an unexpected error still maps to 500 and hides internals', () => {
  const r = statusForError(new Error('connection reset by peer'));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal error');
});
