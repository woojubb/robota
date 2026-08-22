import { rm } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  narrowsSelection,
  listWorkflows,
  parseInvocations,
  stepRun,
  TEST_SCRIPT,
  ZERO_MATCH_TOLERANT,
} from '../scan-test-selection-tolerance.mjs';

describe('listWorkflows', () => {
  it('fails closed when the governed workflow directory is absent', async () => {
    const root = makeTemp('test-selection-tolerance-');
    try {
      expect(() => listWorkflows(root)).toThrow(/\.github\/workflows does not exist/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('narrowsSelection', () => {
  it('treats the measured windows-shell shape as narrowing', () => {
    // The exact args behind `No test files found, exiting with code 0`.
    expect(narrowsSelection(' -- --run platform-shell')).toBe(true);
    expect(narrowsSelection(' -- --run shell-tool')).toBe(true);
  });

  it('treats a bare trailing pattern as narrowing', () => {
    expect(narrowsSelection(' platform-shell')).toBe(true);
  });

  it('does NOT treat an unnarrowed whole-package run as narrowing', () => {
    // `--passWithNoTests` on a whole-package run is a package policy about a package that may
    // legitimately have no tests yet — a different question, deliberately out of scope.
    expect(narrowsSelection('')).toBe(false);
    expect(narrowsSelection('   ')).toBe(false);
  });

  it('does NOT treat a whole-PROJECT selection as narrowing', () => {
    // `test:bin` / `test:pty` select a project whose include globs are the assertion.
    expect(narrowsSelection(' --config vitest.bin.config.ts')).toBe(false);
    expect(narrowsSelection(' --project e2e')).toBe(false);
  });

  it('does not read `--run` itself as a selector — it is a mode, not a pattern', () => {
    expect(narrowsSelection(' -- --run')).toBe(false);
  });
});

describe('parseInvocations', () => {
  it('extracts the package, script and trailing args from the pre-fix windows-shell step', () => {
    expect(
      parseInvocations('pnpm --filter @robota-sdk/agent-core test -- --run platform-shell'),
    ).toEqual([
      {
        packages: ['@robota-sdk/agent-core'],
        script: 'test',
        rest: ' -- --run platform-shell',
      },
    ]);
  });

  it('captures every package of a multi-filter invocation', () => {
    const [invocation] = parseInvocations(
      'pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-process build',
    );
    expect(invocation.packages).toEqual(['@robota-sdk/agent-core', '@robota-sdk/agent-process']);
    expect(invocation.script).toBe('build');
  });

  it('reads the `run` spelling as well as the bare one', () => {
    const [invocation] = parseInvocations('pnpm --filter @robota-sdk/agent-web run test:ci');
    expect(invocation.script).toBe('test:ci');
  });

  it('recognises the FIXED shape as an `exec` invocation, not a test script', () => {
    // The fix routes around the script, so `exec` is what the script slot holds — and `exec` is
    // not a test script, which is exactly why the fixed workflow is green.
    const [invocation] = parseInvocations(
      'pnpm --filter @robota-sdk/agent-core exec vitest run platform-shell',
    );
    expect(invocation.script).toBe('exec');
    expect(TEST_SCRIPT.test(invocation.script)).toBe(false);
  });
});

describe('TEST_SCRIPT', () => {
  it('matches test and its variants, and nothing that merely starts with those letters', () => {
    expect(TEST_SCRIPT.test('test')).toBe(true);
    expect(TEST_SCRIPT.test('test:bin')).toBe(true);
    expect(TEST_SCRIPT.test('test:coverage')).toBe(true);
    expect(TEST_SCRIPT.test('testing-utils')).toBe(false);
    expect(TEST_SCRIPT.test('build')).toBe(false);
  });
});

describe('ZERO_MATCH_TOLERANT', () => {
  it('matches the flag the measured defect inherited through the script', () => {
    expect(ZERO_MATCH_TOLERANT.test('vitest run --passWithNoTests')).toBe(true);
    expect(ZERO_MATCH_TOLERANT.test('jest --passWithNoTests')).toBe(true);
  });

  it('does not match a runner that fails on zero matches', () => {
    expect(ZERO_MATCH_TOLERANT.test('vitest run --config vitest.bin.config.ts')).toBe(false);
    expect(ZERO_MATCH_TOLERANT.test('vitest run')).toBe(false);
  });
});

describe('stepRun', () => {
  it('reads a single-line run body', () => {
    expect(stepRun('      - name: x\n        run: pnpm --filter a test\n')).toBe(
      'pnpm --filter a test',
    );
  });

  it('reads a block run body', () => {
    expect(
      stepRun('      - name: x\n        run: |\n          line one\n          line two\n'),
    ).toBe('\nline one\nline two');
  });

  it('returns undefined for a pure `uses:` step', () => {
    expect(
      stepRun('      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n'),
    ).toBe(undefined);
  });
});
