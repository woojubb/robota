#!/usr/bin/env node

import path from 'node:path';

import { runAffectedContractTier as runAffectedContractTierBase } from './harness-contract-execution.mjs';
import {
  createAffectedContractPlan,
  resolveChangedContractInputs,
} from './affected-contract-tests.mjs';
import { createContractTestRegistry } from './contract-test-inputs.mjs';
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
export const DEFAULT_AFFECTED_DISTRIBUTION_THRESHOLD = 32;
export const DEFAULT_DISTRIBUTED_AFFECTED_TIMEOUT_MS = 240_000;

export function runHermeticTestsInStrippedRepository(root = DEFAULT_ROOT) {
  return runHermetic(root);
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function changedRefs(argv) {
  return {
    baseRef:
      valueAfter(argv, '--base-ref') ??
      (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/develop'),
    headRef: valueAfter(argv, '--head-ref') ?? valueAfter(argv, '--head') ?? 'HEAD',
  };
}

/**
 * Reuse the complete-fallback executor for a large, already validated affected set. The narrowed
 * tier is safe only after the normal selector has returned `affected`; every uncertain selection
 * keeps the original tier and therefore expands to the complete repository suite.
 */
export function distributedAffectedTiers(
  tiers,
  plan,
  threshold = DEFAULT_AFFECTED_DISTRIBUTION_THRESHOLD,
) {
  if (plan?.mode !== 'affected' || plan.selected.length < threshold) return undefined;
  const selected = new Set(plan.selected);
  return {
    ...tiers,
    contract: tiers.contract.filter((file) => selected.has(file)),
    isolatedContract: tiers.isolatedContract.filter((file) => selected.has(file)),
  };
}

export function distributedAffectedTimeoutMs(environment = process.env) {
  const configured = Number(environment.HARNESS_CONTRACT_SHARD_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DISTRIBUTED_AFFECTED_TIMEOUT_MS;
}

function completeFallbackArgs(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (['--base-ref', '--head-ref', '--head'].includes(argv[index])) {
      index += 1;
      continue;
    }
    result.push(argv[index]);
  }
  return [...result, '--base-ref', 'HEAD', '--head-ref', 'HEAD'];
}

async function runAffectedContractTier(argv, root, tiers) {
  let plan;
  try {
    const resolved = resolveChangedContractInputs({ root, ...changedRefs(argv) });
    const registry = createContractTestRegistry(root, tiers.contract);
    plan = createAffectedContractPlan({
      root,
      contractTests: tiers.contract,
      isolatedContract: tiers.isolatedContract,
      changedFiles: resolved.ok ? resolved.files : [],
      registry,
    });
    if (!resolved.ok) plan.mode = 'complete';
  } catch {
    // The owning executor retains the authoritative fail-closed behavior and diagnostic.
  }
  const distributed = distributedAffectedTiers(tiers, plan);
  if (!distributed) return runAffectedContractTierBase(argv, root, tiers);
  process.stdout.write(
    `[contract-tests] distributed affected set: ${plan.selected.length} tests across complete-fallback shards\n`,
  );
  const previousTimeout = process.env.HARNESS_CONTRACT_SHARD_TIMEOUT_MS;
  process.env.HARNESS_CONTRACT_SHARD_TIMEOUT_MS = String(distributedAffectedTimeoutMs());
  try {
    const result = await runAffectedContractTierBase(completeFallbackArgs(argv), root, distributed);
    return { ...result, mode: plan.mode, reason: plan.reason, distributed: true };
  } finally {
    if (previousTimeout === undefined) delete process.env.HARNESS_CONTRACT_SHARD_TIMEOUT_MS;
    else process.env.HARNESS_CONTRACT_SHARD_TIMEOUT_MS = previousTimeout;
  }
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
