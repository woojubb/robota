import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeTrials } from './outcome-report.js';

test('failed attempts contribute to the cost of successful tasks', () => {
  assert.deepEqual(
    summarizeTrials([
      { success: true, costUsd: 1 },
      { success: false, costUsd: 2 },
    ]),
    {
      sampleSize: 2,
      successes: 1,
      successRate: 0.5,
      totalCostUsd: 3,
      costPerSuccess: 3,
    },
  );
});

test('unknown pricing and zero successes remain undefined cost per success', () => {
  assert.equal(
    summarizeTrials([
      { success: true, costUsd: 1 },
      { success: false, costUsd: null },
    ]).costPerSuccess,
    null,
  );
  assert.equal(summarizeTrials([{ success: false, costUsd: 1 }]).costPerSuccess, null);
  assert.equal(summarizeTrials([]).successRate, null);
});

test('invalid cost cannot masquerade as measured spending', () => {
  for (const costUsd of [-1, NaN, Infinity]) {
    assert.throws(() => summarizeTrials([{ success: true, costUsd }]), /cost/);
  }
});
