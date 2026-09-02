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
  const resolved = resolveChangedContractInputs({ root, ...changedRefs(argv) });
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
  if (!resolved.ok) {
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
  const shardRuns = await Promise.all(
    shardFiles.map(async (files) => ({ files, result: await vitestInvocationAsync(root, files) })),
  );
  for (const { result } of shardRuns) printRun(result);
  let failed = shardRuns.some(({ result }) => result.status !== 0 || result.signal);
  const isolatedRuns = [];
  if (!failed) {
    for (const files of plan.isolated.filter((file) => misses.has(file)).map((file) => [file])) {
      const result = vitestInvocation(root, files);
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
