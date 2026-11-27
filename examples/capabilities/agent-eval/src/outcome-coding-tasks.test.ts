import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { CODING_TASKS, serializeCodingTasks } from './outcome-coding-tasks.js';

/**
 * Digest of the canonical serialization of the frozen tasks. Change it only on purpose, together
 * with the task data (see the README for the update steps).
 */
const FROZEN_TASKS_DIGEST = 'f3f2b11c181f001a2b6492085f40dd6377a95c8eec328387db8be57294856bf3';

test('the five tasks match their frozen digest', () => {
  const digest = createHash('sha256').update(serializeCodingTasks()).digest('hex');
  assert.equal(digest, FROZEN_TASKS_DIGEST);
});

test('the digest covers every part of a task', () => {
  const [first, ...rest] = CODING_TASKS;
  assert.ok(first);
  const digestOf = (tasks: typeof CODING_TASKS): string =>
    createHash('sha256').update(serializeCodingTasks(tasks)).digest('hex');
  const mutations = [
    { ...first, prompt: `${first.prompt} ` },
    { ...first, verifier: `${first.verifier} ` },
    { ...first, allowed: [] },
    { ...first, solved: { ...first.solved, extra: 'x' } },
    { ...first, files: { ...first.files, extra: 'x' } },
  ];
  for (const mutated of mutations) {
    assert.notEqual(digestOf([mutated, ...rest]), FROZEN_TASKS_DIGEST);
  }
});

test('tasks keep their order, ids and protected files', () => {
  assert.deepEqual(
    CODING_TASKS.map((task) => [task.id, task.protectedFiles]),
    [
      ['navigation', ['src/main.mjs', 'src/catalog.mjs', 'src/display.mjs']],
      ['bug-repair', []],
      ['feature', []],
      ['multi-file', []],
      ['test-diagnosis', ['tests/range.test.mjs']],
    ],
  );
});
