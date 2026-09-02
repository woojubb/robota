#!/usr/bin/env node

import path from 'node:path';

import { runAffectedContractTier } from './harness-contract-execution.mjs';
import {
  classifyHarnessTestFiles,
  testInvocationsForTier,
} from './harness-test-classification.mjs';
import { runHermeticTestsInStrippedRepository as runHermetic } from './harness-hermetic-runner.mjs';
import { vitestInvocation } from './harness-vitest-process.mjs';

export { runAffectedContractTier, worktreeFingerprint } from './harness-contract-execution.mjs';
export {
  classifyHarnessTestFiles,
  HERMETIC_TEST_FILES,
  ISOLATED_CONTRACT_TEST_FILES,
  testInvocationsForTier,
} from './harness-test-classification.mjs';
export {
  contractShardTimeoutMs,
  createActiveShardChildRegistry,
  DEFAULT_CONTRACT_SHARD_KILL_GRACE_MS,
  DEFAULT_CONTRACT_SHARD_TIMEOUT_MS,
  harnessTestEnvironment,
  vitestInvocation,
  vitestInvocationAsync,
} from './harness-vitest-process.mjs';

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../..');

export function runHermeticTestsInStrippedRepository(root = DEFAULT_ROOT) {
  return runHermetic(root);
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main(argv = process.argv.slice(2), root = DEFAULT_ROOT) {
  if (argv.includes('--verify-hermetic-stripped')) {
    const result = runHermeticTestsInStrippedRepository(root);
    process.stdout.write(result.output);
    process.exitCode = result.status;
    return result;
  }
  const tier = valueAfter(argv, '--tier') ?? 'all';
  const tiers = classifyHarnessTestFiles(root);
  if (!['all', 'contracts', 'hermetic'].includes(tier)) {
    process.stderr.write('usage: harness-test-tiers.mjs --tier all|contracts|hermetic\n');
    process.exitCode = 1;
    return undefined;
  }
  if (argv.includes('--affected')) {
    if (tier !== 'contracts') {
      process.stderr.write('--affected is supported only with --tier contracts\n');
      process.exitCode = 1;
      return undefined;
    }
    return runAffectedContractTier(argv, root, tiers);
  }
  let result;
  for (const files of testInvocationsForTier(tiers, tier)) {
    result = vitestInvocation(root, files);
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = result.status ?? 1;
    if (process.exitCode !== 0) return result;
  }
  return result;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) await main();
