import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VERDICT,
  classifyChanges,
  classifyVitestOutcome,
  decidePairVerdict,
  isDefectFixRange,
  isSourceFile,
  isTestFile,
  parseOptOut,
  pkgOf,
  qualifyingPairs,
  reachableRelativeGraph,
  relativeSpecifiers,
  resolveRelativeImport,
  runRegressionRedProof,
} from '../check-regression-red-proof.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const abs = (rel) => path.resolve(WORKSPACE_ROOT, rel);

describe('HARNESS-041 file classification', () => {
  it('pkgOf extracts the package/app root for src files only', () => {
    expect(pkgOf('packages/agent-transport-tui/src/CjkTextInput.tsx')).toBe(
      'packages/agent-transport-tui',
    );
    expect(pkgOf('apps/agent-app/src/main.ts')).toBe('apps/agent-app');
    expect(pkgOf('packages/foo/docs/SPEC.md')).toBeNull();
    expect(pkgOf('scripts/harness/x.mjs')).toBeNull();
  });

  it('isTestFile / isSourceFile split correctly', () => {
    expect(isTestFile('packages/x/src/__tests__/a.test.tsx')).toBe(true);
    expect(isTestFile('packages/x/src/a.spec.ts')).toBe(true);
    expect(isTestFile('packages/x/src/a.tsx')).toBe(false);
    expect(isSourceFile('packages/x/src/a.tsx')).toBe(true);
    expect(isSourceFile('packages/x/src/a.test.ts')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });

  it('qualifyingPairs = packages with BOTH source and test changes', () => {
    const byPkg = classifyChanges([
      'packages/a/src/x.ts',
      'packages/a/src/x.test.ts',
      'packages/b/src/y.ts', // source only
      'packages/c/src/z.test.ts', // test only
    ]);
    const pairs = qualifyingPairs(byPkg);
    expect(pairs.map((p) => p.pkg)).toEqual(['packages/a']);
  });
});

describe('HARNESS-041 scoping (C2) + opt-out', () => {
  it('isDefectFixRange requires a fix: commit and excludes perf:', () => {
    expect(isDefectFixRange(['fix: drop bug', 'chore: x'])).toBe(true);
    expect(isDefectFixRange(['fix(tui): drop bug'])).toBe(true);
    expect(isDefectFixRange(['feat: new', 'docs: y'])).toBe(false);
    expect(isDefectFixRange(['perf: faster'])).toBe(false); // C2
  });

  it('parseOptOut reads allow-green-at-base: <reason>', () => {
    expect(parseOptOut('body\nallow-green-at-base: unrelated fixture test\n')).toEqual({
      optedOut: true,
      reason: 'unrelated fixture test',
    });
    expect(parseOptOut('no marker here')).toEqual({ optedOut: false, reason: null });
  });
});

describe('HARNESS-041 vitest outcome classification (C1 — assertion-fail vs run-error)', () => {
  const testFile = 'packages/x/src/a.test.ts';
  const nameAbs = abs(testFile);

  it('a failed assertion → assertion-fail', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [{ status: 'failed' }] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('assertion-fail');
  });

  it('all assertions passed → all-pass', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [{ status: 'passed' }] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('all-pass');
  });

  it('present but zero assertions (failed to collect) → run-error', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('run-error');
  });

  it('missing from results entirely (transform error) → run-error, NOT all-pass', () => {
    expect(classifyVitestOutcome({ testResults: [] }, [testFile])).toBe('run-error');
  });
});

describe('HARNESS-041 pair verdict (C1 + C3)', () => {
  it('not imported (C3) → INCONCLUSIVE regardless of outcome', () => {
    expect(decidePairVerdict({ importsReversedFile: false, outcome: 'all-pass' })).toBe(
      VERDICT.INCONCLUSIVE,
    );
  });
  it('assertion-fail → RED_PROOF_OK', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'assertion-fail' })).toBe(
      VERDICT.RED_PROOF_OK,
    );
  });
  it('run-error → INCONCLUSIVE, never a pass (C1)', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'run-error' })).toBe(
      VERDICT.INCONCLUSIVE,
    );
  });
  it('all-pass → ACCIDENTAL_GREEN', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'all-pass' })).toBe(
      VERDICT.ACCIDENTAL_GREEN,
    );
  });
});

describe('HARNESS-041 relative-import graph (C3)', () => {
  it('relativeSpecifiers extracts relative imports only', () => {
    const text = `
      import CjkTextInput from '../CjkTextInput.js';
      import { render } from 'ink-testing-library';
      export { x } from './util.js';
    `;
    expect(relativeSpecifiers(text)).toEqual(['../CjkTextInput.js', './util.js']);
  });

  it('resolveRelativeImport maps a .js specifier to its .tsx source', () => {
    const importer = abs('packages/x/src/__tests__/a.test.tsx');
    const exists = (p) => p === abs('packages/x/src/CjkTextInput.tsx');
    expect(resolveRelativeImport(importer, '../CjkTextInput.js', exists)).toBe(
      abs('packages/x/src/CjkTextInput.tsx'),
    );
    expect(resolveRelativeImport(importer, 'ink', exists)).toBeNull(); // bare import
  });

  it('reachableRelativeGraph walks relative imports within the package', () => {
    const pkgRoot = abs('packages/x');
    const testAbs = abs('packages/x/src/a.test.ts');
    const srcAbs = abs('packages/x/src/target.ts');
    const files = {
      [testAbs]: `import { t } from './target.js';`,
      [srcAbs]: `export const t = 1;`,
    };
    const read = (p) => files[p] ?? '';
    const exists = (p) => Object.prototype.hasOwnProperty.call(files, p);
    const graph = reachableRelativeGraph([testAbs], pkgRoot, read, exists);
    expect(graph.has(srcAbs)).toBe(true);
    expect(graph.has(testAbs)).toBe(false); // the test file itself is removed
  });
});

// ── Orchestrator through injected seams (the fixture matrix) ─────────────────────────────────────────

function baseIo(overrides = {}) {
  const testFile = 'packages/x/src/a.test.ts';
  const srcFile = 'packages/x/src/target.ts';
  const files = {
    [abs(testFile)]: `import { t } from './target.js';`,
    [abs(srcFile)]: `export const t = 1;`,
  };
  return {
    mergeBase: 'BASE',
    changedFiles: [srcFile, testFile],
    commitSubjects: ['fix: something real'],
    optOutText: '',
    readText: (p) => files[p] ?? '',
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    isDirty: () => false,
    reverseApply: () => {},
    restore: () => {},
    runVitest: () => ({ testResults: [] }),
    ...overrides,
  };
}

describe('HARNESS-041 orchestrator fixtures', () => {
  it('genuinely-red: reversed source makes the test fail → RED_PROOF_OK', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({
        runVitest: () => ({
          testResults: [
            { name: abs('packages/x/src/a.test.ts'), assertionResults: [{ status: 'failed' }] },
          ],
        }),
      }),
    );
    expect(verdict).toBe(VERDICT.RED_PROOF_OK);
  });

  it('accidental-green: reversed source, test still passes → ACCIDENTAL_GREEN', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({
        runVitest: () => ({
          testResults: [
            { name: abs('packages/x/src/a.test.ts'), assertionResults: [{ status: 'passed' }] },
          ],
        }),
      }),
    );
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('inconclusive-transform-error (C1): vitest could not run → INCONCLUSIVE, not a pass', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ runVitest: () => ({ testResults: [] }) }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('not-imported (C3): test does not import the reversed file → INCONCLUSIVE (never mutates)', async () => {
    let mutated = false;
    const { verdict, decisions } = await runRegressionRedProof(
      baseIo({
        // test imports a different file than the changed source
        readText: (p) =>
          p === abs('packages/x/src/a.test.ts') ? `import { u } from './other.js';` : '',
        reverseApply: () => {
          mutated = true;
        },
      }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(mutated).toBe(false);
    expect(decisions[0].importsReversedFile).toBe(false);
  });

  it('dirty-tree (C4): refuses to mutate, → INCONCLUSIVE', async () => {
    let mutated = false;
    const { verdict } = await runRegressionRedProof(
      baseIo({ isDirty: () => true, reverseApply: () => (mutated = true) }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(mutated).toBe(false);
  });

  it('opt-out: allow-green-at-base marker → SKIPPED_OPT_OUT', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ optOutText: 'allow-green-at-base: unrelated fixture' }),
    );
    expect(verdict).toBe(VERDICT.SKIPPED_OPT_OUT);
  });

  it('not a fix: range → SKIPPED_NOT_FIX', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ commitSubjects: ['feat: new thing'] }),
    );
    expect(verdict).toBe(VERDICT.SKIPPED_NOT_FIX);
  });

  it('no same-package pair → SKIPPED_NO_PAIR', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ changedFiles: ['packages/x/src/target.ts'] }), // source only
    );
    expect(verdict).toBe(VERDICT.SKIPPED_NO_PAIR);
  });

  it('restores the tree even when vitest throws', async () => {
    let restored = false;
    await runRegressionRedProof(
      baseIo({
        runVitest: () => {
          throw new Error('vitest blew up');
        },
        restore: () => (restored = true),
      }),
    ).catch(() => {});
    expect(restored).toBe(true);
  });
});
