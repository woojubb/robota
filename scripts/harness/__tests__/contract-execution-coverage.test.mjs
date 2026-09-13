import { expect, it } from 'vitest';
import { summarizeContractExecution } from '../harness-contract-execution.mjs';

it('distinguishes cache reuse, invoked shards and tests never invoked after failure', () => {
  const summary = summarizeContractExecution(
    ['cached.test.mjs', 'failed.test.mjs', 'isolated.test.mjs'],
    ['cached.test.mjs'],
    [{ files: ['failed.test.mjs'], result: { status: 1, signal: null } }],
  );
  expect(summary).toEqual({
    cacheHits: ['cached.test.mjs'],
    invoked: ['failed.test.mjs'],
    notInvoked: ['isolated.test.mjs'],
    failedShards: [{ files: ['failed.test.mjs'], status: 1, signal: null }],
  });
});
