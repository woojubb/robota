import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreTrial, type ITrialReport } from './outcome-coding-score.js';
import type { ICodingObservation } from './outcome-coding-verify.js';

const report: ITrialReport = { completed: true, interrupted: false, toolCalls: 3 };
const observation: ICodingObservation = {
  taskId: 'feature',
  exitCode: 0,
  timedOut: false,
  protectedFilesUnchanged: true,
  changedProtectedFiles: [],
  noUnexpectedFiles: true,
  unexpectedFiles: [],
  noEscapes: true,
  escapes: [],
  manifest: [],
};

test('a completed, uninterrupted trial that used tools and verified clean passes', () => {
  assert.deepEqual(scoreTrial(report, observation), { passed: true, failures: [] });
});

test('every rule fails the trial on its own', () => {
  const cases: Array<[string, ITrialReport, ICodingObservation]> = [
    ['not-completed', { ...report, completed: false }, observation],
    ['interrupted', { ...report, interrupted: true }, observation],
    ['no-tools-used', { ...report, toolCalls: 0 }, observation],
    ['verifier-failed', report, { ...observation, exitCode: 1 }],
    ['verifier-failed', report, { ...observation, exitCode: null, timedOut: true }],
    ['protected-files-changed', report, { ...observation, protectedFilesUnchanged: false }],
    ['unexpected-files', report, { ...observation, noUnexpectedFiles: false }],
    ['escaping-entries', report, { ...observation, noEscapes: false }],
  ];
  for (const [rule, trial, observed] of cases) {
    assert.deepEqual(scoreTrial(trial, observed), { passed: false, failures: [rule] }, rule);
  }
});

test('all failures are listed in a fixed order', () => {
  const score = scoreTrial(
    { completed: false, interrupted: true, toolCalls: 0 },
    {
      ...observation,
      exitCode: 2,
      protectedFilesUnchanged: false,
      noUnexpectedFiles: false,
      noEscapes: false,
    },
  );
  assert.deepEqual(score.failures, [
    'not-completed',
    'interrupted',
    'no-tools-used',
    'verifier-failed',
    'protected-files-changed',
    'unexpected-files',
    'escaping-entries',
  ]);
  assert.equal(score.passed, false);
});

test('scoring does not mutate its inputs and repeats exactly', () => {
  const before = JSON.stringify([report, observation]);
  const first = scoreTrial(report, observation);
  const second = scoreTrial(report, observation);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify([report, observation]), before);
});
