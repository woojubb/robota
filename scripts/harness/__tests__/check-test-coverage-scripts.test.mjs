import { describe, expect, it } from 'vitest';

import {
  findCoverageScriptFindings,
  findRootCoverageScriptFindings,
  isCoverageScriptRequired,
} from '../check-test-coverage-scripts.mjs';

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
});
