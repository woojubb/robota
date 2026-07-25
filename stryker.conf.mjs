// @ts-check
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * INFRA-042 — nightly mutation testing (Stryker) over the highest-value CORE packages.
 *
 * WHY: coverage proves a line RAN; mutation proves its behaviour is ASSERTED. Stryker mutates the
 * source (flip `>`→`>=`, drop a statement, negate a condition) and re-runs the suite; a mutant that
 * SURVIVES means no test noticed — i.e. an accidental-green test that does not pin behaviour (the
 * class that recurred as ARCH-004 RUNTIME-14 and CORE-026 RUNTIME-12; common-mistakes #82).
 *
 * SCOPE: deliberately bounded — mutation runs the suite once per mutant, far too expensive for
 * per-PR CI, so it runs nightly (mutation-nightly.yml) over one core package at a time. Select the
 * package with STRYKER_TARGET (default: agent-core). The nightly workflow loops over every key below.
 *
 * ADVISORY (v1): `thresholds.break` is null — Stryker NEVER fails the run on a low score. The score
 * and the surviving-mutant report are the maintained artefact; surviving mutants become
 * test-hardening work items. Ratchet the threshold up (and eventually set `break`) over time. This
 * mirrors the regression-red-proof advisory-first rollout (ci.yml, HARNESS-041).
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Per-target mutation scope: the highest-value core logic named in INFRA-042, each paired with its
 * package's own vitest config so only that package's suite runs.
 */
const TARGETS = {
  // agent-core permission gate + policy + mode resolvers (the CORE-025 enforcement path).
  'agent-core': {
    package: 'agent-core',
    mutate: [
      'packages/agent-core/src/permissions/*.ts',
      '!packages/agent-core/src/permissions/index.ts',
      '!packages/agent-core/src/permissions/types.ts',
      '!packages/agent-core/src/permissions/**/*.{test,spec}.ts',
    ],
  },
  // agent-session permission-enforcer (the CORE-025 policy-enforcement seam).
  'agent-session': {
    package: 'agent-session',
    mutate: ['packages/agent-session/src/permission-enforcer.ts'],
  },
  // agent-executor background-task state machine.
  'agent-executor': {
    package: 'agent-executor',
    mutate: ['packages/agent-executor/src/background-tasks/state-machine.ts'],
  },
};

const targetKey = process.env.STRYKER_TARGET ?? 'agent-core';
const target = TARGETS[targetKey];
if (!target) {
  throw new Error(
    `Unknown STRYKER_TARGET "${targetKey}". Valid targets: ${Object.keys(TARGETS).join(', ')}`,
  );
}

// Keep the Stryker sandbox small and the run fast: copy only the target package (node_modules is
// symlinked, so cross-package @robota-sdk deps resolve to the real built packages). Every other
// workspace package, plus apps/docs/examples, is ignored from the sandbox copy.
const siblingPackages = readdirSync(join(here, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== target.package)
  .map((entry) => `packages/${entry.name}`);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  packageManager: 'pnpm',
  // Explicit plugin list: the default '@stryker-mutator/*' glob does not resolve the runner under
  // pnpm's symlinked node_modules layout, so name it directly.
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: {
    configFile: `packages/${target.package}/vitest.config.ts`,
    // Run vitest with the package as its working directory so the config's `src/**` include globs
    // resolve inside the package (otherwise vitest runs from the sandbox root and finds no tests).
    dir: `packages/${target.package}`,
  },
  mutate: target.mutate,
  // perTest coverage runs only the tests that cover each mutant — the main speed lever.
  coverageAnalysis: 'perTest',
  // No type-checker in v1: a mutant that fails to compile is reported (not silently killed), which
  // is acceptable for an advisory report and keeps the run fast. Revisit when promoting to a gate.
  checkers: [],
  ignorePatterns: [
    // Dot-directories that are irrelevant to the run and can contain symlinked dirs that break the
    // sandbox copy (e.g. .claude/skills/* are symlinks to directories).
    '.claude',
    '.github',
    '.husky',
    '.changeset',
    '.vscode',
    // Large workspace areas the target package never needs (node_modules is symlinked, so
    // cross-package deps still resolve to the real built packages).
    'apps',
    'docs',
    'examples',
    'scratch',
    'website',
    'coverage',
    'reports',
    ...siblingPackages,
  ],
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: `reports/mutation/${targetKey}/mutation.html` },
  jsonReporter: { fileName: `reports/mutation/${targetKey}/mutation.json` },
  clearTextReporter: { maxTestsToLog: 3 },
  // Advisory thresholds: report-only. `break: null` => the run never fails on a low score in v1.
  thresholds: { high: 80, low: 60, break: null },
  timeoutMS: 60000,
  concurrency: 2,
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};

export default config;
