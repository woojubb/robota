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
import { ACTIVE_SHARD_CHILDREN, vitestInvocationAsync } from './harness-vitest-process.mjs';

export const DEFAULT_CONTRACT_SHARD_CONCURRENCY = 2;
const WORKTREE_FINGERPRINT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** A submitted shard is not proof that every individual test in it finished executing. */
export function summarizeContractExecution(selected, cacheHits, runs) {
  const invoked = [...new Set(runs.flatMap((run) => run.files))].sort();
  const accounted = new Set([...invoked, ...cacheHits]);
  return {
    cacheHits: [...cacheHits].sort(),
    invoked,
    notInvoked: selected.filter((file) => !accounted.has(file)).sort(),
    failedShards: runs
      .filter(({ result }) => (result.status ?? 1) !== 0 || result.signal)
      .map(({ files, result }) => ({
        files: [...files],
        status: result.status ?? null,
        signal: result.signal ?? null,
      })),
  };
}

function contractShardConcurrency(environment = process.env) {
  const configured = Number(environment.HARNESS_CONTRACT_SHARD_CONCURRENCY);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_CONTRACT_SHARD_CONCURRENCY;
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: null,
    maxBuffer: WORKTREE_FINGERPRINT_MAX_BUFFER_BYTES,
  });
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

function runContractFiles(root, kind, files, execution = undefined) {
  const executionArgs = execution?.maxWorkers === 1 ? ' --pool=threads --maxWorkers=1' : '';
  process.stdout.write(
    `[contract-tests] started ${kind}: ${files.join(', ')}\n` +
      `[contract-tests] reproduce: pnpm exec vitest run ${files.join(' ')}${executionArgs}\n`,
  );
  return vitestInvocationAsync(root, files, {
    execution,
    onOutput(stream, chunk) {
      (stream === 'stderr' ? process.stderr : process.stdout).write(chunk);
    },
  });
}

/**
 * Continuously fill a bounded worker pool. Isolated tests remain serial with each other, but one
 * may run beside an ordinary shard so a slow isolated fixture no longer waits behind every batch.
 * Results are published as each child finishes; a sibling failure never cancels independent work.
 */
export async function runBoundedContractTasks({
  shards,
  isolated,
  concurrency,
  runShard,
  runIsolated,
  onComplete = () => {},
  isCancelled = () => false,
}) {
  const ordinary = shards.map((files) => ({ kind: 'shard', files }));
  const serial = isolated.map((files) => ({ kind: 'isolated', files }));
  const results = [];
  let ordinaryIndex = 0;
  let isolatedIndex = 0;
  let isolatedActive = false;

  const claim = () => {
    if (isCancelled()) return undefined;
    if (!isolatedActive && isolatedIndex < serial.length) {
      isolatedActive = true;
      return serial[isolatedIndex++];
    }
    if (ordinaryIndex < ordinary.length) return ordinary[ordinaryIndex++];
    return undefined;
  };

  const worker = async () => {
    for (let task = claim(); task; task = claim()) {
      let result;
      try {
        result =
          task.kind === 'isolated' ? await runIsolated(task.files) : await runShard(task.files);
      } catch (error) {
        result = {
          status: 1,
          signal: null,
          stdout: '',
          stderr: `contract task failed before its child process started: ${error instanceof Error ? error.message : String(error)}\n`,
          outputForwarded: false,
        };
      } finally {
        if (task.kind === 'isolated') isolatedActive = false;
      }
      results.push({ ...task, result });
      onComplete(task, result);
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), ordinary.length + serial.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
  let registryFailure;
  try {
    registry = createContractTestRegistry(root, tiers.contract);
  } catch (error) {
    registryFailure = error.message;
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
  if (registryFailure !== undefined) {
    plan.mode = 'complete';
    plan.reason = `${plan.reason}; registry construction failed: ${registryFailure}`;
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
  const concurrency = contractShardConcurrency();
  const isolatedFiles = plan.isolated.filter((file) => misses.has(file)).map((file) => [file]);
  const hasRunnableTasks = shardFiles.length + isolatedFiles.length > 0;
  const before = hasRunnableTasks ? worktreeFingerprint(root) : null;
  const runs = await runBoundedContractTasks({
    shards: shardFiles,
    isolated: isolatedFiles,
    concurrency,
    runShard: (files) => runContractFiles(root, 'shard', files),
    runIsolated: (files) =>
      runContractFiles(root, 'isolated', files, { pool: 'threads', maxWorkers: 1 }),
    onComplete(task, result) {
      process.stdout.write(`[contract-tests] completed ${task.kind}: ${task.files.join(', ')}\n`);
      if (!result.outputForwarded) printRun(result);
    },
    isCancelled: () => ACTIVE_SHARD_CHILDREN.cancelled,
  });
  let failed = runs.some(({ result }) => result.status !== 0 || result.signal);
  if (before !== null && worktreeFingerprint(root) !== before) {
    process.stderr.write('contract tests modified the caller worktree\n');
    failed = true;
  } else {
    let recorded = 0;
    for (const { files, result } of runs) {
      recorded += recordSuccessfulContractShard({ cache, files, result });
    }
    process.stdout.write(`[contract-tests] cache: recorded ${recorded} successful miss(es)\n`);
  }
  process.exitCode = failed ? 1 : 0;
  const coverage = summarizeContractExecution(plan.selected, cache.hits, runs);
  process.stdout.write(
    `[contract-tests] coverage: ${coverage.cacheHits.length} cache-reused; ${coverage.invoked.length} submitted to runners; ${coverage.notInvoked.length} not invoked; ${coverage.failedShards.length} failed shard(s)\n`,
  );
  return { ...plan, coverage, status: process.exitCode };
}
