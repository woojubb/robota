import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VERDICT,
  computePatchCoverage,
  decideVerdict,
  groupCoverableChanges,
  isCoverableSource,
  isTestFile,
  lcovIsEntirelyUnexercised,
  packageOwnsTests,
  packageRootOf,
  parseChangedNewLines,
  parseLcov,
  runPatchCoverage,
} from '../check-patch-coverage.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(WORKSPACE_ROOT, 'scripts/harness/check-patch-coverage.mjs');
const FIXTURES = 'scripts/harness/__tests__/fixtures/patch-coverage';

// Two-segment fixture roots: `packages/<x>` / `apps/<x>` have a package.json; deeper nested
// fixture groups are modeled explicitly where a test needs them.
const flatPkgJson = (dirRel) => dirRel.split('/').length === 2;

describe('INFRA-041 file classification', () => {
  it('packageRootOf finds the nearest package root, including nested workspace groups', () => {
    expect(packageRootOf('packages/agent-core/src/a.ts', flatPkgJson)).toBe('packages/agent-core');
    expect(packageRootOf('apps/agent-app/src/main.ts', flatPkgJson)).toBe('apps/agent-app');
    // nested group (packages/dag-nodes/<pkg>): the DEEPEST dir with a package.json wins
    const nested = (dirRel) => dirRel === 'packages/dag-nodes/tool';
    expect(packageRootOf('packages/dag-nodes/tool/src/node.ts', nested)).toBe(
      'packages/dag-nodes/tool',
    );
    expect(packageRootOf('scripts/harness/x.mjs', flatPkgJson)).toBeNull();
    expect(packageRootOf('docs/guide.md', flatPkgJson)).toBeNull();
  });

  it('isCoverableSource takes non-test src TS/JS only', () => {
    const pkg = 'packages/x';
    expect(isCoverableSource('packages/x/src/a.ts', pkg)).toBe(true);
    // INFRA-046, owner decision 2026-08-22: render surfaces are OUT of the denominator.
    expect(isCoverableSource('packages/x/src/ui/b.tsx', pkg)).toBe(false);
    expect(isCoverableSource('packages/x/src/a.test.ts', pkg)).toBe(false);
    expect(isCoverableSource('packages/x/src/__tests__/a.ts', pkg)).toBe(false);
    expect(isCoverableSource('packages/x/src/types.d.ts', pkg)).toBe(false);
    expect(isCoverableSource('packages/x/docs/SPEC.md', pkg)).toBe(false);
    expect(isCoverableSource('packages/x/tsdown.config.ts', pkg)).toBe(false);
    expect(isTestFile('packages/x/tests/e2e.spec.ts')).toBe(true);
  });

  it('groupCoverableChanges groups by package and drops non-coverable files', () => {
    const grouped = groupCoverableChanges(
      [
        'packages/a/src/one.ts',
        'packages/a/src/two.ts',
        'packages/a/src/two.test.ts',
        'packages/b/src/x.ts',
        'docs/readme.md',
        '.github/workflows/ci.yml',
      ],
      flatPkgJson,
    );
    expect([...grouped.keys()].sort()).toEqual(['packages/a', 'packages/b']);
    expect(grouped.get('packages/a')).toEqual(['packages/a/src/one.ts', 'packages/a/src/two.ts']);
  });
});

describe('INFRA-041 diff parsing (-U0 new-side lines)', () => {
  it('extracts new-side lines from hunk headers, with default and zero lengths', () => {
    const diff = [
      'diff --git a/packages/a/src/f.ts b/packages/a/src/f.ts',
      '--- a/packages/a/src/f.ts',
      '+++ b/packages/a/src/f.ts',
      '@@ -10,2 +12,3 @@ ctx',
      '+x',
      '+y',
      '+z',
      '@@ -20 +30 @@',
      '+single (length defaults to 1)',
      '@@ -40,4 +50,0 @@',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
    ].join('\n');
    const byFile = parseChangedNewLines(diff);
    expect([...byFile.keys()]).toEqual(['packages/a/src/f.ts']);
    expect([...byFile.get('packages/a/src/f.ts')].sort((a, b) => a - b)).toEqual([12, 13, 14, 30]);
  });
});

describe('INFRA-041 lcov parsing', () => {
  it('normalizes package-relative and absolute SF paths and merges duplicates by max hits', () => {
    const absSf = path.join(WORKSPACE_ROOT, 'packages/a/src/f.ts');
    const lcov = [
      'TN:',
      'SF:src/f.ts',
      'DA:1,0',
      'DA:2,1',
      'end_of_record',
      `SF:${absSf}`,
      'DA:1,5',
      'end_of_record',
    ].join('\n');
    const byFile = parseLcov(lcov, 'packages/a');
    expect([...byFile.keys()]).toEqual(['packages/a/src/f.ts']);
    expect(byFile.get('packages/a/src/f.ts').get(1)).toBe(5);
    expect(byFile.get('packages/a/src/f.ts').get(2)).toBe(1);
  });
});

describe('INFRA-041 patch-coverage computation + verdict', () => {
  const lines = (...ns) => new Set(ns);

  it('counts only executable changed lines; comments/types are excluded from the denominator', () => {
    const changed = new Map([['packages/a/src/f.ts', lines(1, 2, 3, 4)]]);
    const lcov = new Map([
      [
        'packages/a/src/f.ts',
        new Map([
          [2, 1],
          [3, 0],
          [99, 1],
        ]),
      ], // 1 & 4 non-executable
    ]);
    const r = computePatchCoverage(changed, lcov);
    expect(r.measured).toBe(2);
    expect(r.covered).toBe(1);
    expect(r.perFile[0].missedLines).toEqual([3]);
    expect(r.uninstrumented).toEqual([]);
  });

  it('flags a changed file entirely absent from lcov as UNINSTRUMENTED (never silently dropped)', () => {
    const changed = new Map([['packages/a/src/ghost.ts', lines(1, 2)]]);
    const r = computePatchCoverage(changed, new Map());
    expect(r.uninstrumented).toEqual(['packages/a/src/ghost.ts']);
    expect(r.measured).toBe(0);
  });

  it('verdict: BELOW_TARGET dominates, missing data is INCONCLUSIVE, full data at target is OK', () => {
    const base = { coverableFileCount: 1, uninstrumented: [], noDataPackages: [], target: 80 };
    expect(decideVerdict({ ...base, coverableFileCount: 0, measured: 0, covered: 0 })).toBe(
      VERDICT.SKIPPED_NO_COVERABLE,
    );
    expect(decideVerdict({ ...base, measured: 10, covered: 7 })).toBe(VERDICT.BELOW_TARGET);
    // a proven hole fails even when other data is missing
    expect(
      decideVerdict({ ...base, measured: 10, covered: 7, noDataPackages: ['packages/b'] }),
    ).toBe(VERDICT.BELOW_TARGET);
    expect(
      decideVerdict({ ...base, measured: 10, covered: 9, noDataPackages: ['packages/b'] }),
    ).toBe(VERDICT.INCONCLUSIVE);
    expect(
      decideVerdict({ ...base, measured: 0, covered: 0, uninstrumented: ['packages/a/src/g.ts'] }),
    ).toBe(VERDICT.INCONCLUSIVE);
    expect(decideVerdict({ ...base, measured: 10, covered: 8 })).toBe(VERDICT.OK);
    // all changed lines non-executable, full data → OK (docs/type-only change is a clean no-op)
    expect(decideVerdict({ ...base, measured: 0, covered: 0 })).toBe(VERDICT.OK);
  });
});

describe('INFRA-041 orchestration (injected io)', () => {
  const diffText = [
    'diff --git a/packages/fixture-pkg/src/adder.ts b/packages/fixture-pkg/src/adder.ts',
    '--- /dev/null',
    '+++ b/packages/fixture-pkg/src/adder.ts',
    '@@ -0,0 +1,8 @@',
  ].join('\n');

  it('returns BELOW_TARGET when the added lines are uncovered (red-capability)', async () => {
    const { verdict, measured, covered } = await runPatchCoverage({
      diffText,
      hasPkgJson: flatPkgJson,
      collectLcov: () => 'SF:src/adder.ts\nDA:2,0\nDA:3,0\nDA:6,0\nDA:7,0\nend_of_record\n',
      // #1344: the package OWNS a test suite, so an all-zero report is a real hole rather than an
      // uninstrumented package. Without this the case is indistinguishable from the false positive
      // the classification exists to prevent, and it would be asserting the wrong thing.
      listFiles: () => ['packages/fixture-pkg/src/__tests__/adder.test.ts'],
    });
    expect(verdict).toBe(VERDICT.BELOW_TARGET);
    expect(measured).toBe(4);
    expect(covered).toBe(0);
  });

  it('returns OK when the added lines are covered', async () => {
    const { verdict } = await runPatchCoverage({
      diffText,
      hasPkgJson: flatPkgJson,
      collectLcov: () => 'SF:src/adder.ts\nDA:2,1\nDA:3,1\nDA:6,1\nDA:7,1\nend_of_record\n',
    });
    expect(verdict).toBe(VERDICT.OK);
  });

  it('returns INCONCLUSIVE (never a pass) when a package produces no coverage data', async () => {
    const { verdict, noDataPackages } = await runPatchCoverage({
      diffText,
      hasPkgJson: flatPkgJson,
      collectLcov: () => null,
    });
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(noDataPackages).toEqual(['packages/fixture-pkg']);
  });

  it('SKIPs explicitly on a diff with no coverable src lines', async () => {
    const { verdict } = await runPatchCoverage({
      diffText: ['+++ b/docs/guide.md', '@@ -1,0 +1,3 @@'].join('\n'),
      hasPkgJson: flatPkgJson,
      collectLcov: () => {
        throw new Error('must not be called');
      },
    });
    expect(verdict).toBe(VERDICT.SKIPPED_NO_COVERABLE);
  });
});

describe('INFRA-041 CLI red-proof (fixture end-to-end, exit-code contract)', () => {
  const run = (fixture, env = {}) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [SCRIPT, '--fixture', `${FIXTURES}/${fixture}`],
        {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          env: { ...process.env, PATCH_COVERAGE_ENFORCE: '', ...env },
        },
      );
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: String(err.stdout ?? '') };
    }
  };

  it('RED fixture: detects the hole, exits 0 advisory, exits 1 under PATCH_COVERAGE_ENFORCE=1', () => {
    const advisory = run('red');
    expect(advisory.code).toBe(0);
    expect(advisory.stdout).toContain(VERDICT.BELOW_TARGET);
    expect(advisory.stdout).toContain('missed lines: 2, 3, 6, 7');

    const enforced = run('red', { PATCH_COVERAGE_ENFORCE: '1' });
    expect(enforced.code).toBe(1);
    expect(enforced.stdout).toContain(VERDICT.BELOW_TARGET);
  });

  it('GREEN fixture: same diff with covering tests passes, even enforced', () => {
    const enforced = run('green', { PATCH_COVERAGE_ENFORCE: '1' });
    expect(enforced.code).toBe(0);
    expect(enforced.stdout).toContain(VERDICT.OK);
    expect(enforced.stdout).toContain('4/4');
  });
});

/**
 * #1344 / INFRA-046 — a package with no tests must not be CHARGED for its own uncovered lines.
 *
 * `coverage.all: true` instruments a package's source whether or not anything exercises it, so a
 * package that owns no test file still emits an lcov report — every record zero-hit. Folding those
 * lines into the measured total makes the patch percentage BELOW-TARGET for a package that has no
 * way to discharge the debt. That is a false positive, and INFRA-046's promotion criterion allows
 * none.
 *
 * BOTH conditions are required. A package WITH tests whose report happens to be wholly uncovered is
 * exactly the defect this gate exists to catch, and the cases below pin that it still fails.
 */
describe('an untested package is NO-DATA, not BELOW-TARGET (#1344)', () => {
  const ZERO_HIT_LCOV = 'SF:src/a.ts\nDA:1,0\nDA:2,0\nend_of_record\n';
  const COVERED_LCOV = 'SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n';

  /** One changed line in one package, with the lcov and file listing under test. */
  const runWith = ({ lcov, files }) =>
    runPatchCoverage({
      target: 80,
      diffText:
        'diff --git a/packages/p/src/a.ts b/packages/p/src/a.ts\n' +
        '--- a/packages/p/src/a.ts\n+++ b/packages/p/src/a.ts\n@@ -1,0 +1,2 @@\n+x\n+y\n',
      hasPkgJson: (dir) => dir === 'packages/p',
      collectLcov: () => lcov,
      listFiles: () => files,
      log: () => {},
    });

  it('reports INCONCLUSIVE when the package owns no test file and nothing is covered', async () => {
    const result = await runWith({
      lcov: ZERO_HIT_LCOV,
      files: ['packages/p/src/a.ts', 'packages/p/package.json'],
    });
    expect(result.verdict).toBe('inconclusive-no-data');
    // The decisive part: those lines are UNMEASURED, not measured-and-missed.
    expect(result.measured).toBe(0);
  });

  it('still reports BELOW-TARGET when the package DOES own tests', async () => {
    const result = await runWith({
      lcov: ZERO_HIT_LCOV,
      files: ['packages/p/src/a.ts', 'packages/p/src/__tests__/a.test.ts'],
    });
    expect(result.verdict).toBe('patch-coverage-below-target');
    expect(result.measured).toBe(2);
  });

  it('does not excuse a testless package whose report has ANY hit', async () => {
    // One covered line is evidence something ran, so the report is real data and 50% < 80% fails.
    const result = await runWith({
      lcov: COVERED_LCOV,
      files: ['packages/p/src/a.ts', 'packages/p/package.json'],
    });
    expect(result.verdict).toBe('patch-coverage-below-target');
    expect(result.measured).toBe(2);
  });
});

describe('lcovIsEntirelyUnexercised', () => {
  it('is false for an EMPTY report — no records is not the same as no hits', () => {
    // The distinction matters: an empty parse means the collector produced nothing for these files,
    // which the existing UNINSTRUMENTED path already handles. Claiming "unexercised" here would
    // swallow that case under a different label.
    expect(lcovIsEntirelyUnexercised(new Map())).toBe(false);
  });

  it('is true only when records exist and none has a hit', () => {
    expect(lcovIsEntirelyUnexercised(new Map([['f', new Map([[1, 0]])]]))).toBe(true);
    expect(lcovIsEntirelyUnexercised(new Map([['f', new Map([[1, 1]])]]))).toBe(false);
  });
});

/**
 * INFRA-046 / the issue #1348 class — render surfaces are OUT of the patch denominator.
 *
 * Owner decision, 2026-08-22. Line coverage over JSX says little: exercising a render tree's
 * branches needs component-test infrastructure, and without it every UI pull request pays a tax it
 * cannot discharge. Measured at the time, three of the four GUI packages owned SOME tests, so the
 * issue #1344 untested-package classification did not excuse them — this is a separate rule, not a
 * consequence of that one.
 *
 * The distinction these cases pin: EXCLUDED FROM THE DENOMINATOR, not counted as covered.
 */
describe('render surfaces are excluded from the patch denominator (INFRA-046)', () => {
  it('excludes .tsx and .jsx, and keeps .ts/.js', () => {
    expect(isCoverableSource('packages/p/src/a.ts', 'packages/p')).toBe(true);
    expect(isCoverableSource('packages/p/src/a.js', 'packages/p')).toBe(true);
    expect(isCoverableSource('packages/p/src/a.tsx', 'packages/p')).toBe(false);
    expect(isCoverableSource('packages/p/src/a.jsx', 'packages/p')).toBe(false);
  });

  it('a diff of ONLY render surfaces is SKIPPED, not passed on a fabricated 100%', async () => {
    const result = await runPatchCoverage({
      target: 80,
      diffText:
        'diff --git a/packages/p/src/View.tsx b/packages/p/src/View.tsx\n' +
        '--- a/packages/p/src/View.tsx\n+++ b/packages/p/src/View.tsx\n@@ -1,0 +1,2 @@\n+x\n+y\n',
      hasPkgJson: (dir) => dir === 'packages/p',
      collectLcov: () => 'SF:src/View.tsx\nDA:1,0\nDA:2,0\nend_of_record\n',
      listFiles: () => ['packages/p/src/__tests__/v.test.ts'],
      log: () => {},
    });
    // SKIPPED says "this gate has nothing to measure here". OK would say "it measured and was
    // satisfied", which is a different and false claim.
    expect(result.verdict).toBe(VERDICT.SKIPPED_NO_COVERABLE);
    expect(result.measured).toBe(0);
  });

  it('a .ts file in the same diff is still measured and can still fail', async () => {
    const result = await runPatchCoverage({
      target: 80,
      diffText:
        'diff --git a/packages/p/src/View.tsx b/packages/p/src/View.tsx\n' +
        '--- a/packages/p/src/View.tsx\n+++ b/packages/p/src/View.tsx\n@@ -1,0 +1,2 @@\n+x\n+y\n' +
        'diff --git a/packages/p/src/logic.ts b/packages/p/src/logic.ts\n' +
        '--- a/packages/p/src/logic.ts\n+++ b/packages/p/src/logic.ts\n@@ -1,0 +1,2 @@\n+a\n+b\n',
      hasPkgJson: (dir) => dir === 'packages/p',
      collectLcov: () =>
        'SF:src/View.tsx\nDA:1,0\nDA:2,0\nend_of_record\n' +
        'SF:src/logic.ts\nDA:1,0\nDA:2,0\nend_of_record\n',
      listFiles: () => ['packages/p/src/__tests__/v.test.ts'],
      log: () => {},
    });
    expect(result.verdict).toBe('patch-coverage-below-target');
    // Two, not four: the render surface contributed nothing to the denominator.
    expect(result.measured).toBe(2);
  });
});
