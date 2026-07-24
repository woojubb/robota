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
    expect(isCoverableSource('packages/x/src/ui/b.tsx', pkg)).toBe(true);
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
