import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  findCoverageScriptFindings,
  findRootCoverageScriptFindings,
  isCoverageScriptRequired,
} from '../check-test-coverage-scripts.mjs';
import { SCAN_COMMANDS } from '../run-all-scans.mjs';

describe('isCoverageScriptRequired', () => {
  it('requires coverage for Vitest packages that expose test', () => {
    expect(isCoverageScriptRequired({ scripts: { test: 'vitest run --passWithNoTests' } })).toBe(
      true,
    );
  });

  it('requires coverage for Jest packages that expose test', () => {
    expect(isCoverageScriptRequired({ scripts: { test: 'jest --passWithNoTests' } })).toBe(true);
  });

  it('does not require coverage for packages without a test script', () => {
    expect(isCoverageScriptRequired({ scripts: { build: 'tsup' } })).toBe(false);
  });
});

describe('findCoverageScriptFindings', () => {
  it('reports testable packages without test:coverage', () => {
    const findings = findCoverageScriptFindings([
      {
        relativeDir: 'packages/with-test',
        workspaceName: '@example/with-test',
        scripts: { test: 'vitest run --passWithNoTests' },
      },
      {
        relativeDir: 'packages/with-coverage',
        workspaceName: '@example/with-coverage',
        scripts: {
          test: 'vitest run --passWithNoTests',
          'test:coverage': 'vitest run --coverage --passWithNoTests',
        },
      },
      {
        relativeDir: 'packages/no-test',
        workspaceName: '@example/no-test',
        scripts: { build: 'tsup' },
      },
    ]);

    expect(findings).toEqual([
      {
        file: 'packages/with-test/package.json',
        type: 'missing-test-coverage-script',
        detail:
          '@example/with-test exposes test but does not expose a package-level test:coverage script.',
      },
    ]);
  });
});

describe('findRootCoverageScriptFindings', () => {
  it('requires root coverage entrypoints and scan wiring', () => {
    const findings = findRootCoverageScriptFindings({
      scripts: {
        'test:coverage': 'pnpm run -r --if-present test:coverage',
      },
    });

    expect(findings).toEqual([
      {
        file: 'package.json',
        type: 'missing-root-coverage-script',
        detail: 'Root package.json must expose test:coverage:packages.',
      },
      {
        file: 'package.json',
        type: 'missing-root-coverage-script',
        detail: 'Root package.json must expose test:coverage:apps.',
      },
      {
        file: 'package.json',
        type: 'missing-root-harness-script',
        detail: 'Root package.json must expose harness:scan:coverage-scripts.',
      },
      {
        file: 'package.json',
        type: 'coverage-scan-not-wired',
        detail: 'Root harness:scan must include harness:scan:coverage-scripts.',
      },
    ]);
  });

  /**
   * HARNESS-052. The wiring half of this check proved "registered in the runner" with
   * `readFileSync(run-all-scans.mjs).includes('check-test-coverage-scripts.mjs')` — true of a
   * commented-out registration, of a line deleted from the table but named in a comment, and of the
   * runner's own docstring. Falsified by commenting the registration out: the substring was still
   * present twice and the check stayed green, while reading the exported array reports
   * `coverage-scan-not-wired`. This pins the structural read so the string test cannot come back.
   */
  it('proves registration from the runner’s exported table, not from its source text', () => {
    const source = readFileSync(
      new URL('../check-test-coverage-scripts.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain("import { SCAN_COMMANDS } from './run-all-scans.mjs'");
    expect(source).not.toMatch(/readFileSync\([^)]*run-all-scans/);
    expect(
      SCAN_COMMANDS.some((scan) =>
        (scan.command ?? []).some((argument) =>
          String(argument).endsWith('check-test-coverage-scripts.mjs'),
        ),
      ),
    ).toBe(true);
  });
});
