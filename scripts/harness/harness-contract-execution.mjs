import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createAffectedContractPlan,
  resolveChangedContractInputs,
} from './affected-contract-tests.mjs';
import { inspectContractTestCache, recordSuccessfulContractShard } from './contract-test-cache.mjs';
import { createContractTestRegistry } from './contract-test-inputs.mjs';
import { vitestInvocation, vitestInvocationAsync } from './harness-vitest-process.mjs';

export const DEFAULT_CONTRACT_SHARD_CONCURRENCY = 2;

function contractShardConcurrency(environment = process.env) {
  const configured = Number(environment.HARNESS_CONTRACT_SHARD_CONCURRENCY);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_CONTRACT_SHARD_CONCURRENCY;
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: null });
  if (result.status !== 0 || result.signal) {
    throw new Error(`worktree fingerprint failed: git ${args.join(' ')}`);
  }
  return result.stdout ?? Buffer.alloc(0);
}

/** Include tracked bytes and every untracked file's bytes, not only status letters. */
export function worktreeFingerprint(root) {
  const hash = createHash('sha256');
  hash.update(gitOutput(root, ['diff', '--binary', 'HEAD', '--', '.']));
  const untracked = gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const file of untracked) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function printRun(result) {
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
}

function changedRefs(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    baseRef:
      valueAfter('--base-ref') ??
      (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/develop'),
    headRef: valueAfter('--head-ref') ?? valueAfter('--head') ?? 'HEAD',
  };
}

export async function runAffectedContractTier(argv, root, tiers) {
  // A caller that already narrowed `tiers` to a pre-filtered affected+isolated subset (the
  // distributed-shard path in harness-test-tiers.mjs) passes this instead of real refs: there is
  // nothing left to diff, and re-resolving would either repeat the same git calls for no reason or,
  // worse, print a `changed-file resolution failed closed` line that reads as an error for a subset
  // that was in fact correctly and efficiently narrowed (process-overhead policy, 2026-09).
  const preNarrowed = argv.includes('--distributed-shard');
  const resolved = preNarrowed
    ? { ok: false, reason: null }
    : resolveChangedContractInputs({ root, ...changedRefs(argv) });
  let registry;
  try {
    registry = createContractTestRegistry(root, tiers.contract);
  } catch {
    registry = [];
  }
  const plan = createAffectedContractPlan({
    root,
    contractTests: tiers.contract,
    isolatedContract: tiers.isolatedContract,
    changedFiles: resolved.ok ? resolved.files : [],
    registry,
  });
  if (preNarrowed) {
    plan.mode = 'complete';
    plan.reason = 'distributed shard: running its pre-filtered affected subset';
  } else if (!resolved.ok) {
    plan.mode = 'complete';
    plan.reason = `changed-file resolution failed closed: ${resolved.reason}`;
  }
  process.stdout.write(
    `[contract-tests] ${plan.mode}: ${plan.reason}; ${plan.selected.length}/${tiers.contract.length} selected\n`,
  );
  process.stdout.write(
    `[contract-tests] owners: ${plan.selectedByOwner.map(({ owner, tests }) => `${owner}=${tests.length}`).join(', ')}\n`,
  );
  const cache = inspectContractTestCache({ root, entries: registry, tests: plan.selected });
  const misses = new Set(cache.misses);
  process.stdout.write(
    `[contract-tests] cache: ${cache.hits.length} hit(s), ${cache.misses.length} miss(es)\n`,
  );
  const shardFiles = plan.shards
    .map((files) => files.filter((file) => misses.has(file)))
    .filter((files) => files.length > 0);
  const before = worktreeFingerprint(root);
  const shardRuns = [];
  const concurrency = contractShardConcurrency();
  for (let index = 0; index < shardFiles.length; index += concurrency) {
    const batch = await Promise.all(
      shardFiles.slice(index, index + concurrency).map(async (files) => ({
        files,
        result: await vitestInvocationAsync(root, files),
      })),
    );
    shardRuns.push(...batch);
  }
  for (const { result } of shardRuns) printRun(result);
  let failed = shardRuns.some(({ result }) => result.status !== 0 || result.signal);
  const isolatedRuns = [];
  if (!failed) {
    for (const files of plan.isolated.filter((file) => misses.has(file)).map((file) => [file])) {
      // Isolated contract fixtures may run real Git histories for several minutes. A single thread
      // worker keeps Vitest's worker RPC responsive while preserving the separate-process isolation
      // that this tier promises; concurrent affected shards retain the bounded thread pool above.
      const result = vitestInvocation(root, files, root, undefined, {
        pool: 'threads',
        maxWorkers: 1,
      });
      isolatedRuns.push({ files, result });
      printRun(result);
      if ((result.status ?? 1) !== 0 || result.signal) {
        failed = true;
        break;
      }
    }
  }
  if (worktreeFingerprint(root) !== before) {
    process.stderr.write('contract tests modified the caller worktree\n');
    failed = true;
  } else {
    let recorded = 0;
    for (const { files, result } of [...shardRuns, ...isolatedRuns]) {
      recorded += recordSuccessfulContractShard({ cache, files, result });
    }
    process.stdout.write(`[contract-tests] cache: recorded ${recorded} successful miss(es)\n`);
  }
  process.exitCode = failed ? 1 : 0;
  return { ...plan, status: process.exitCode };
}
