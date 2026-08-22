#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
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
import { envWithoutGitVars } from './shared.mjs';

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../..');
const TEST_DIR = 'scripts/harness/__tests__';

/**
 * Explicitly admitted only after execution in a repository stripped of every live-tree owner.
 * Every test not named here is repository-contract by default.
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
  'scripts/harness/__tests__/scan-file-size.test.mjs',
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
  'scripts/harness/__tests__/verification-receipt.test.mjs',
  'scripts/harness/__tests__/workspace-check-batches.test.mjs',
  'scripts/harness/__tests__/worktree-gate.test.mjs',
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
  const declared = new Set(HERMETIC_TEST_FILES);
  if (declared.size !== HERMETIC_TEST_FILES.length) {
    throw new Error('the hermetic harness-test allowlist contains duplicate entries');
  }
  const missing = HERMETIC_TEST_FILES.filter((file) => !all.includes(file));
  if (missing.length > 0) {
    throw new Error(`declared hermetic harness test(s) do not exist: ${missing.join(', ')}`);
  }
  const hermetic = all.filter((file) => declared.has(file));
  const contract = all.filter((file) => !declared.has(file));
  if (hermetic.length === 0 || contract.length === 0) {
    throw new Error('both harness-test tiers must contain at least one test');
  }
  return { all, contract, hermetic };
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

export function main(argv = process.argv.slice(2), root = DEFAULT_ROOT) {
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
  const files =
    tier === 'contracts' ? tiers.contract : tier === 'hermetic' ? tiers.hermetic : tiers.all;
  const result = vitestInvocation(root, files);
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 1;
  return result;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
