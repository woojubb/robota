#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { canonicalTemporaryDirectory } from './canonical-temporary-directory.mjs';
import {
  createAffectedContractPlan,
  resolveChangedContractInputs,
} from './affected-contract-tests.mjs';
import { inspectContractTestCache, recordSuccessfulContractShard } from './contract-test-cache.mjs';
import { createContractTestRegistry } from './contract-test-inputs.mjs';
import { envWithoutGitVars } from './shared.mjs';

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../..');
const TEST_DIR = 'scripts/harness/__tests__';
export const DEFAULT_CONTRACT_SHARD_TIMEOUT_MS = 120_000;
export const DEFAULT_CONTRACT_SHARD_KILL_GRACE_MS = 5_000;

export function contractShardTimeoutMs(environment = process.env) {
  const configured = Number(environment.HARNESS_CONTRACT_SHARD_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_CONTRACT_SHARD_TIMEOUT_MS;
}

/**
 * Explicitly admitted only after execution in a repository stripped of every live-tree owner.
 * Every test not named here is repository-contract by default.
 *
 * PROC-016 placed its four tests by that rule and none of them is admitted here: `gate.test.mjs`,
 * `new-spec.test.mjs` and `scan-lane-declaration.test.mjs` read the live gate catalogue, template
 * and lane table, and `run-all-scans-affected.test.mjs` asserts the live registry's declared globs
 * against the tree. They run in the contracts tier, which `pnpm harness:test:contracts` owns.
 */
export const HERMETIC_TEST_FILES = Object.freeze([
  'scripts/harness/__tests__/api-pagination.test.mjs',
  'scripts/harness/__tests__/canonical-temporary-directory.test.mjs',
  'scripts/harness/__tests__/check-adr-completeness.test.mjs',
  'scripts/harness/__tests__/check-agent-server-boundary.test.mjs',
  'scripts/harness/__tests__/check-architecture-map-completeness.test.mjs',
  'scripts/harness/__tests__/check-architecture-map-paths.test.mjs',
  'scripts/harness/__tests__/check-background-workspace-conformance.test.mjs',
  'scripts/harness/__tests__/check-backlog-placement.test.mjs',
  'scripts/harness/__tests__/check-build-output-contracts.test.mjs',
  'scripts/harness/__tests__/check-command-layering.test.mjs',
  'scripts/harness/__tests__/check-dep-kind.test.mjs',
  'scripts/harness/__tests__/check-design-doc-completeness.test.mjs',
  'scripts/harness/__tests__/check-doc-examples.test.mjs',
  'scripts/harness/__tests__/check-document-authority.test.mjs',
  'scripts/harness/__tests__/check-document-standards-index.test.mjs',
  'scripts/harness/__tests__/check-done-evidence.test.mjs',
  'scripts/harness/__tests__/check-functional-coverage.test.mjs',
  'scripts/harness/__tests__/check-harness-config-paths.test.mjs',
  'scripts/harness/__tests__/check-llms-txt.test.mjs',
  'scripts/harness/__tests__/check-nested-package-glob-coverage.test.mjs',
  'scripts/harness/__tests__/check-orphan-exports.test.mjs',
  'scripts/harness/__tests__/check-patch-coverage.test.mjs',
  'scripts/harness/__tests__/check-plan.test.mjs',
  'scripts/harness/__tests__/check-publish-safety.test.mjs',
  'scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs',
  'scripts/harness/__tests__/check-release-governance.test.mjs',
  'scripts/harness/__tests__/check-review-gate.test.mjs',
  'scripts/harness/__tests__/check-sdk-public-surface.test.mjs',
  'scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs',
  'scripts/harness/__tests__/check-spec-paths.test.mjs',
  'scripts/harness/__tests__/check-stub-markers.test.mjs',
  'scripts/harness/__tests__/check-task-archival.test.mjs',
  'scripts/harness/__tests__/check-temp-script-placement.test.mjs',
  'scripts/harness/__tests__/check-test-coverage-scripts.test.mjs',
  'scripts/harness/__tests__/check-workspace-refs.test.mjs',
  'scripts/harness/__tests__/cited-paths.test.mjs',
  'scripts/harness/__tests__/detect-changed-files.test.mjs',
  'scripts/harness/__tests__/file-name-shape.test.mjs',
  'scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs',
  'scripts/harness/__tests__/governed-tree.test.mjs',
  'scripts/harness/__tests__/list-source-files.test.mjs',
  'scripts/harness/__tests__/live-provider-smoke.test.mjs',
  'scripts/harness/__tests__/live-smoke-provider-coverage.test.mjs',
  'scripts/harness/__tests__/pre-push-lockfile.test.mjs',
  'scripts/harness/__tests__/pre-push-sequence.test.mjs',
  'scripts/harness/__tests__/promote.test.mjs',
  'scripts/harness/__tests__/record-local-review-disposition.test.mjs',
  'scripts/harness/__tests__/release-run.test.mjs',
  'scripts/harness/__tests__/run-all-scans.test.mjs',
  'scripts/harness/__tests__/scan-ci-base-history.test.mjs',
  'scripts/harness/__tests__/scan-conflict-markers.test.mjs',
  'scripts/harness/__tests__/scan-deprecated-markers.test.mjs',
  'scripts/harness/__tests__/scan-dist-freshness.test.mjs',
  'scripts/harness/__tests__/scan-helper-limits.test.mjs',
  'scripts/harness/__tests__/scan-interface-runtime.test.mjs',
  'scripts/harness/__tests__/scan-legacy-typescript.test.mjs',
  'scripts/harness/__tests__/scan-main-required-checks.test.mjs',
  'scripts/harness/__tests__/scan-measurement-provenance.test.mjs',
  'scripts/harness/__tests__/scan-memory-mirror.test.mjs',
  'scripts/harness/__tests__/scan-orchestration-map.test.mjs',
  'scripts/harness/__tests__/scan-promotion-ancestry.test.mjs',
  'scripts/harness/__tests__/scan-prompt-prose.test.mjs',
  'scripts/harness/__tests__/scan-review-findings.test.mjs',
  'scripts/harness/__tests__/scan-spec-research.test.mjs',
  'scripts/harness/__tests__/scan-test-plan.test.mjs',
  'scripts/harness/__tests__/scan-test-selection-tolerance.test.mjs',
  'scripts/harness/__tests__/scan-vitest-resource-ceiling.test.mjs',
  'scripts/harness/__tests__/task-lifecycle.test.mjs',
  'scripts/harness/__tests__/tree-prerequisites.test.mjs',
  'scripts/harness/__tests__/workspace-check-batches.test.mjs',
  'scripts/harness/__tests__/worktree-gate.test.mjs',
]);

/**
 * Repository-contract tests whose own bounded subprocess fan-out must not compete with another
 * Vitest file. They remain members of the contract tier; this list changes only the execution
 * schedule, not coverage or ownership.
 */
export const ISOLATED_CONTRACT_TEST_FILES = Object.freeze([
  'scripts/harness/__tests__/hook-reading-matches-bash.test.mjs',
]);

function listTestFiles(root) {
  const testRoot = path.join(root, TEST_DIR);
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(testRoot);
  return files.sort();
}

/** Return the fail-closed, complete partition of the harness self-test suite. */
export function classifyHarnessTestFiles(root = DEFAULT_ROOT) {
  const all = listTestFiles(root);
  const hermeticDeclared = new Set(HERMETIC_TEST_FILES);
  const isolatedDeclared = new Set(ISOLATED_CONTRACT_TEST_FILES);
  if (hermeticDeclared.size !== HERMETIC_TEST_FILES.length) {
    throw new Error('the hermetic harness-test allowlist contains duplicate entries');
  }
  if (isolatedDeclared.size !== ISOLATED_CONTRACT_TEST_FILES.length) {
    throw new Error('the isolated contract-test allowlist contains duplicate entries');
  }
  const missing = [...HERMETIC_TEST_FILES, ...ISOLATED_CONTRACT_TEST_FILES].filter(
    (file) => !all.includes(file),
  );
  if (missing.length > 0) {
    throw new Error(`declared harness test(s) do not exist: ${missing.join(', ')}`);
  }
  const overlap = ISOLATED_CONTRACT_TEST_FILES.filter((file) => hermeticDeclared.has(file));
  if (overlap.length > 0) {
    throw new Error(`isolated contract test(s) cannot be hermetic: ${overlap.join(', ')}`);
  }
  const hermetic = all.filter((file) => hermeticDeclared.has(file));
  const contract = all.filter((file) => !hermeticDeclared.has(file));
  const isolatedContract = contract.filter((file) => isolatedDeclared.has(file));
  const concurrentContract = contract.filter((file) => !isolatedDeclared.has(file));
  if (hermetic.length === 0 || contract.length === 0) {
    throw new Error('both harness-test tiers must contain at least one test');
  }
  if (isolatedContract.length !== ISOLATED_CONTRACT_TEST_FILES.length) {
    throw new Error('every isolated harness test must belong to the repository-contract tier');
  }
  return { all, concurrentContract, contract, hermetic, isolatedContract };
}

/** Build a complete, non-overlapping execution schedule for one logical tier. */
export function testInvocationsForTier(tiers, tier) {
  const isolated = tiers.isolatedContract.map((file) => [file]);
  if (tier === 'contracts') return [tiers.concurrentContract, ...isolated];
  if (tier === 'hermetic') return [tiers.hermetic];
  if (tier === 'all') {
    const concurrent = tiers.all.filter((file) => !tiers.isolatedContract.includes(file));
    return [concurrent, ...isolated];
  }
  throw new Error(`unknown harness test tier: ${tier}`);
}

export function vitestInvocation(root, files, cwd = root, config = undefined) {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vitestPackage = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitestPackage) || packageJson.type !== 'module') {
    return {
      status: 1,
      stdout: '',
      stderr: 'installed Vitest and an ESM package root are required to run harness tests',
    };
  }
  const args = [
    vitestPackage,
    'run',
    ...files,
    ...(config ? ['--config', config] : []),
    '--pool=threads',
    '--maxWorkers=2',
    '--testTimeout=30000',
    '--reporter=dot',
  ];
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  try {
    return spawnSync(process.execPath, args, {
      cwd,
      encoding: 'utf8',
      env: harnessTestEnvironment(process.env, suiteTempRoot),
    });
  } finally {
    // The parent process owns the child runner's whole temporary root. File-level helpers still
    // remove eagerly, while this closes worker reuse, abrupt test failure, and any forgotten child
    // fixture without guessing which directory in shared /tmp belongs to another session.
    rmSync(suiteTempRoot, { recursive: true, force: true });
  }
}

function vitestArguments(root, files, config = undefined) {
  return [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    ...files,
    ...(config ? ['--config', config] : []),
    '--pool=threads',
    '--maxWorkers=2',
    '--testTimeout=30000',
    '--reporter=dot',
  ];
}

/** Forward parent cancellation to every active async shard without leaking signal listeners. */
export function createActiveShardChildRegistry(parentProcess = process) {
  const active = new Map();
  const forward = (signal) => {
    for (const [child, state] of active) {
      state.cancellationSignal ??= signal;
      try {
        child.kill(signal);
      } catch {
        // A concurrent close may win the race; its non-success result remains authoritative.
      }
    }
  };
  const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => forward(signal)]));
  const attach = () => {
    for (const [signal, handler] of handlers) parentProcess.on(signal, handler);
  };
  const detach = () => {
    for (const [signal, handler] of handlers) parentProcess.off(signal, handler);
  };
  return {
    register(child) {
      const state = { cancellationSignal: null };
      if (active.size === 0) attach();
      active.set(child, state);
      let released = false;
      return {
        get cancellationSignal() {
          return state.cancellationSignal;
        },
        release() {
          if (released) return;
          released = true;
          active.delete(child);
          if (active.size === 0) detach();
        },
      };
    },
    forward,
    get size() {
      return active.size;
    },
  };
}

const ACTIVE_SHARD_CHILDREN = createActiveShardChildRegistry();

/** Async Vitest process used only by the four-way complete affected fallback. */
export function vitestInvocationAsync(
  root,
  files,
  {
    spawnChild = spawn,
    childRegistry = ACTIVE_SHARD_CHILDREN,
    timeoutMs = contractShardTimeoutMs(),
    killGraceMs = DEFAULT_CONTRACT_SHARD_KILL_GRACE_MS,
    schedule = setTimeout,
    cancelSchedule = clearTimeout,
  } = {},
) {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vitestPackage = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitestPackage) || packageJson.type !== 'module') {
    return Promise.resolve({
      status: 1,
      stdout: '',
      stderr: 'installed Vitest and an ESM package root are required to run harness tests',
    });
  }
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnChild(process.execPath, vitestArguments(root, files), {
        cwd: root,
        env: harnessTestEnvironment(process.env, suiteTempRoot),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rmSync(suiteTempRoot, { recursive: true, force: true });
      resolve({ status: 1, stdout: '', stderr: '', signal: null, timedOut: false, error });
      return;
    }
    const registration = childRegistry.register(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let deadlineTimer;
    let killTimer;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const onStdout = (chunk) => (stdout += chunk);
    const onStderr = (chunk) => (stderr += chunk);
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer !== undefined) cancelSchedule(deadlineTimer);
      if (killTimer !== undefined) cancelSchedule(killTimer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      const cancellationSignal = registration.cancellationSignal;
      registration.release();
      rmSync(suiteTempRoot, { recursive: true, force: true });
      const signal = result.signal ?? cancellationSignal ?? null;
      resolve({
        stdout,
        stderr,
        ...result,
        status: signal || timedOut ? 1 : result.status,
        signal,
        timedOut,
        termination: timedOut ? 'timeout' : signal ? 'signal' : 'exit',
      });
    };
    const onError = (error) => finish({ status: 1, error });
    const onClose = (code, signal) => {
      if (signal) stderr += `\nVitest shard terminated by signal ${signal}.\n`;
      finish({ status: code ?? 1, signal });
    };
    child.once('error', onError);
    child.once('close', onClose);
    deadlineTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      stderr += `\nVitest shard exceeded process deadline (${timeoutMs}ms); sending SIGTERM.\n`;
      try {
        child.kill('SIGTERM');
      } catch {
        // The close/error event remains responsible for final cleanup and failure reporting.
      }
      if (settled) return;
      killTimer = schedule(() => {
        if (settled) return;
        stderr += `Vitest shard ignored SIGTERM for ${killGraceMs}ms; sending SIGKILL.\n`;
        try {
          child.kill('SIGKILL');
        } catch {
          // Wait for close/error so the process-owned temporary directory is never removed early.
        }
      }, killGraceMs);
    }, timeoutMs);
  });
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: null });
  if (result.status !== 0 || result.signal) {
    throw new Error(`worktree fingerprint failed: git ${args.join(' ')}`);
  }
  return result.stdout ?? Buffer.alloc(0);
}

/** Include tracked bytes and every untracked file's bytes, not only porcelain status letters. */
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

async function runAffectedContractTier(argv, root, tiers) {
  const baseRef =
    valueAfter(argv, '--base-ref') ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/develop');
  const headRef = valueAfter(argv, '--head-ref') ?? valueAfter(argv, '--head') ?? 'HEAD';
  const resolved = resolveChangedContractInputs({ root, baseRef, headRef });
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
  const cache = inspectContractTestCache({
    root,
    entries: registry,
    tests: plan.selected,
  });
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
  for (const { result } of shardRuns) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }
  let failed = shardRuns.some(({ result }) => result.status !== 0 || result.signal);
  const isolatedRuns = [];
  if (!failed) {
    for (const files of plan.isolated.filter((file) => misses.has(file)).map((file) => [file])) {
      const result = vitestInvocation(root, files);
      isolatedRuns.push({ files, result });
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      if ((result.status ?? 1) !== 0 || result.signal) {
        failed = true;
        break;
      }
    }
  }
  const after = worktreeFingerprint(root);
  if (after !== before) {
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

/** Keep fixture git commands rooted at their explicit cwd, including when a git hook launches us. */
export function harnessTestEnvironment(
  base = process.env,
  tempRoot = canonicalTemporaryDirectory(),
) {
  return {
    ...envWithoutGitVars(base),
    // Node reads TEMP then TMP on Windows, and TMPDIR then TMP then TEMP elsewhere. Point every
    // platform spelling at the same lifecycle-owned root so os.tmpdir() cannot escape it.
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    // Contract tests execute Stop-hook fixtures. Never let those fixtures regenerate tracked
    // lesson digests in the caller repository; their write behavior is covered in dedicated temp
    // roots instead.
    ROBOTA_DISABLE_LESSONS_DIGEST: '1',
  };
}

/**
 * Execute the allowlisted tier without `.git`, `.github`, `.agents`, packages, apps, hooks, or
 * unrelated root files. Copying the whole harness directory exercises each test's imported-helper
 * and spawned-script closure; only runtime dependencies are linked from the installed repository.
 */
export function runHermeticTestsInStrippedRepository(root = DEFAULT_ROOT) {
  const stage = mkdtempSync(path.join(canonicalTemporaryDirectory(), 'robota-harness-hermetic-'));
  try {
    cpSync(path.join(root, 'scripts', 'harness'), path.join(stage, 'scripts', 'harness'), {
      recursive: true,
    });
    writeFileSync(path.join(stage, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(
      path.join(stage, 'vitest.config.mjs'),
      "export default { test: { environment: 'node' } };\n",
    );
    symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
    const result = vitestInvocation(
      stage,
      HERMETIC_TEST_FILES,
      stage,
      path.join(stage, 'vitest.config.mjs'),
    );
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
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
