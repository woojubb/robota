import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VERDICT,
  classifyChanges,
  classifyVitestOutcome,
  decidePairVerdict,
  defaultReverseApply,
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
  testExecutesHook,
} from '../check-regression-red-proof.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const abs = (rel) => path.resolve(WORKSPACE_ROOT, rel);

describe('HARNESS-041 file classification', () => {
  it('pkgOf extracts the package/app root for src files', () => {
    expect(pkgOf('packages/agent-transport-tui/src/CjkTextInput.tsx')).toBe(
      'packages/agent-transport-tui',
    );
    expect(pkgOf('apps/agent-app/src/main.ts')).toBe('apps/agent-app');
    expect(pkgOf('packages/foo/docs/SPEC.md')).toBeNull();
  });

  it('pkgOf also covers the harness and the hooks (INFRA-071)', () => {
    // This assertion used to read `scripts/harness/x.mjs` → null, which pinned the defect as a
    // contract: the gate could not see the layer holding every scan, every floor and every guard.
    // Measured over PRs #1525-#1530 — twelve CI runs, zero verdicts — while human review caught
    // four accidental-green tests in that same window, all under `scripts/harness/__tests__/`.
    expect(pkgOf('scripts/harness/x.mjs')).toBe('scripts/harness');
    expect(pkgOf('scripts/harness/__tests__/x.test.mjs')).toBe('scripts/harness');
    expect(pkgOf('.claude/hooks/branch-guard.sh')).toBe('.claude/hooks');
    expect(pkgOf('.claude/hooks/lib/command-scan.sh')).toBe('.claude/hooks');
    // Not every file under `.claude/` is a guard; only the shell hooks are red-provable this way.
    expect(pkgOf('.claude/settings.json')).toBeNull();
  });

  it('pairs a changed hook with the harness test that runs it', () => {
    // A hook's tests live in the harness suite, not beside it, so grouping strictly by path put
    // them in different subjects and they could never pair. Adoption is what makes the pair exist.
    const byPkg = classifyChanges([
      '.claude/hooks/branch-guard.sh',
      'scripts/harness/__tests__/branch-base-at-creation.test.mjs',
    ]);
    const hooks = byPkg.get('.claude/hooks');

    expect(hooks.source).toContain('.claude/hooks/branch-guard.sh');
    expect(hooks.test, 'the hook found no test to red-prove it against').toContain(
      'scripts/harness/__tests__/branch-base-at-creation.test.mjs',
    );
  });

  it('adopts nothing when no hook changed', () => {
    // The adoption must not invent a subject: a harness-only change stays a harness change.
    const byPkg = classifyChanges([
      'scripts/harness/x.mjs',
      'scripts/harness/__tests__/x.test.mjs',
    ]);

    expect(byPkg.has('.claude/hooks')).toBe(false);
    expect(byPkg.get('scripts/harness').source).toEqual(['scripts/harness/x.mjs']);
  });

  it('testExecutesHook counts a spawn, not a mention', () => {
    // The relation that stands in for the import graph when the source is a shell script. A hook
    // named in a COMMENT is described, not run — the distinction this gate exists to make, and one
    // an earlier version of this same rule got wrong in the coverage floor beside it.
    const spawns = "run('branch-guard.sh');\nspawnSync('bash', [hook]);";
    const mentions = "// branch-guard.sh is discussed here\nspawnSync('bash', [other]);";
    const noSpawn = "const p = 'branch-guard.sh';";

    expect(testExecutesHook(spawns, '.claude/hooks/branch-guard.sh')).toBe(true);
    expect(testExecutesHook(mentions, '.claude/hooks/branch-guard.sh')).toBe(false);
    expect(testExecutesHook(noSpawn, '.claude/hooks/branch-guard.sh')).toBe(false);
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

  it('multi-file: a run-error file is NOT masked by a passing sibling → run-error (C1 regression)', () => {
    const passing = 'packages/x/src/a.test.ts';
    const brokeCollect = 'packages/x/src/b.test.ts';
    const json = {
      testResults: [
        { name: abs(passing), assertionResults: [{ status: 'passed' }] },
        { name: abs(brokeCollect), assertionResults: [] }, // failed to collect
      ],
    };
    // Before the fix this returned 'all-pass' (→ false accidental-green). It must be run-error.
    expect(classifyVitestOutcome(json, [passing, brokeCollect])).toBe('run-error');
  });

  it('multi-file: an assertion failure still wins over a sibling run-error → assertion-fail', () => {
    const failing = 'packages/x/src/a.test.ts';
    const brokeCollect = 'packages/x/src/b.test.ts';
    const json = {
      testResults: [
        { name: abs(failing), assertionResults: [{ status: 'failed' }] },
        { name: abs(brokeCollect), assertionResults: [] },
      ],
    };
    expect(classifyVitestOutcome(json, [failing, brokeCollect])).toBe('assertion-fail');
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

  it('relativeSpecifiers captures dynamic import() and ignores commented-out imports', () => {
    const text = `
      const m = await import('./dynamic.js');
      // import ghost from './commented.js';
      /* import block from './block.js'; */
      import real from './real.js';
    `;
    const specs = relativeSpecifiers(text);
    expect(specs).toContain('./dynamic.js');
    expect(specs).toContain('./real.js');
    expect(specs).not.toContain('./commented.js');
    expect(specs).not.toContain('./block.js');
  });

  it('reachableRelativeGraph does not cross into a sibling package sharing a name prefix', () => {
    const pkgRoot = abs('packages/x');
    const testAbs = abs('packages/x/src/a.test.ts');
    const siblingSrc = abs('packages/x-utils/src/leak.ts');
    const files = { [testAbs]: `import { u } from '../../x-utils/src/leak.js';`, [siblingSrc]: '' };
    const read = (p) => files[p] ?? '';
    const exists = (p) => Object.prototype.hasOwnProperty.call(files, p);
    const graph = reachableRelativeGraph([testAbs], pkgRoot, read, exists);
    expect(graph.has(siblingSrc)).toBe(false); // packages/x must not prefix-match packages/x-utils
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

  // ── The hook subject, end to end through the orchestrator (INFRA-071) ────────────────────────
  //
  // A hook is never in a module graph, so before this the C3 check answered "not imported" for
  // every hook pair and the gate returned INCONCLUSIVE — a SKIP wearing another name. These two
  // fixtures pin both halves of the relation that replaces it.
  function hookIo(overrides = {}) {
    const testFile = 'scripts/harness/__tests__/some-hook.test.mjs';
    const hook = '.claude/hooks/some-hook.sh';
    return baseIo({
      changedFiles: [hook, testFile],
      readText: () => `spawnSync('bash', [path.join(HOOKS_DIR, 'some-hook.sh')]);`,
      fileExists: () => true,
      ...overrides,
    });
  }

  it('hook pair: the test spawns it and still passes reversed → ACCIDENTAL_GREEN', async () => {
    const { verdict, decisions } = await runRegressionRedProof(
      hookIo({
        runVitest: () => ({
          testResults: [
            {
              name: abs('scripts/harness/__tests__/some-hook.test.mjs'),
              assertionResults: [{ status: 'passed' }],
            },
          ],
        }),
      }),
    );

    expect(decisions[0].pkg).toBe('.claude/hooks');
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('hook pair: a test that only NAMES the hook never mutates the tree', async () => {
    // The other half. Reversing a hook a test does not run would blame it for a failure it had no
    // part in, so the guard has to hold — and it has to hold without touching the working tree.
    let mutated = false;
    const { verdict, decisions } = await runRegressionRedProof(
      hookIo({
        readText: () => `// some-hook.sh is described here, and run nowhere\nexpect(1).toBe(1);`,
        reverseApply: () => {
          mutated = true;
        },
      }),
    );

    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(decisions[0].importsReversedFile).toBe(false);
    expect(mutated).toBe(false);
  });

  it('hands git a byte-exact patch, final newline included', () => {
    // The defect that made every verdict impossible. The diff was read through the trimming helper,
    // so the patch reached `git apply -R` without its final newline and git rejected it as corrupt —
    // "patch broke at line 60". The gate never got past this line, which is why twelve CI runs
    // produced zero verdicts and nobody could tell a clean examination from no examination at all.
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
    let received = null;
    defaultReverseApply(
      'BASE',
      ['x'],
      () => diff,
      (_cmd, _args, opts) => {
        received = opts.input;
      },
    );

    expect(received, 'the patch was altered on its way to git').toBe(diff);
    expect(received.endsWith('\n'), 'the final newline was stripped — git calls that corrupt').toBe(
      true,
    );
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
