import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TITLE_LENGTH, validateTaskTitle } from '../src/task-title.ts';

test('accepts a normal title and trims it', () => {
  assert.deepEqual(validateTaskTitle('  Buy milk  '), { ok: true, title: 'Buy milk' });
});

test('rejects an empty title', () => {
  assert.equal(validateTaskTitle('').ok, false);
});

test('rejects a title that is only whitespace', () => {
  assert.equal(validateTaskTitle('   ').ok, false);
});

test('rejects a title longer than the limit', () => {
  assert.equal(validateTaskTitle('x'.repeat(MAX_TITLE_LENGTH + 1)).ok, false);
});
