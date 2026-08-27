import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SCAN_COMMANDS,
  SCAN_CONTEXTS,
  advisoryScanNames,
  describeAffectedSelection,
  globToRegExp,
  parseRunOptions,
  parseStatusPorcelain,
  pathMatchesAny,
  runScans,
  selectAffectedScans,
} from '../run-all-scans.mjs';

/**
 * PROC-016 — `--affected` and `--context` (TC-07, TC-09).
 *
 * The selection is tested over a FIXTURE registry, so nothing is spawned; the live registry is held
 * to its own declarations (every entry says what it reads, every glob points at something in the
 * tree); and two spawned `--list` runs pin the two numbers the completion criteria name.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const RUNNER = path.join(REPO_ROOT, 'scripts/harness/run-all-scans.mjs');

const FIXTURE = [
  { name: 'harness-only', examines: ['scripts/harness/**'] },
  { name: 'packages-only', examines: ['packages/**'] },
  { name: 'every-change', always: true },
  { name: 'markdown', examines: ['**/*.md'] },
];

describe('globToRegExp / pathMatchesAny', () => {
  it('anchors a bare filename to the root', () => {
    expect(pathMatchesAny('package.json', ['package.json'])).toBe(true);
    expect(pathMatchesAny('packages/a/package.json', ['package.json'])).toBe(false);
  });

  it('lets `**` span directories and `*` stay inside one', () => {
    expect(pathMatchesAny('packages/a/src/x.ts', ['packages/**'])).toBe(true);
    expect(pathMatchesAny('packages/', ['packages/**'])).toBe(true);
    expect(pathMatchesAny('README.md', ['**/*.md'])).toBe(true);
    expect(pathMatchesAny('docs/a/b.md', ['**/*.md'])).toBe(true);
    expect(pathMatchesAny('docs/a/b.mdx', ['**/*.md'])).toBe(false);
    expect(pathMatchesAny('tsconfig.base.json', ['tsconfig*.json'])).toBe(true);
    expect(pathMatchesAny('sub/tsconfig.json', ['tsconfig*.json'])).toBe(false);
  });

  it('alternates inside braces and escapes regex metacharacters', () => {
    expect(globToRegExp('{a,b}/x').test('b/x')).toBe(true);
    expect(globToRegExp('{a,b}/x').test('c/x')).toBe(false);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});

describe('selectAffectedScans (fixture registry, nothing spawned)', () => {
  it('selects the scans whose globs a changed path reaches, plus every `always` scan', () => {
    const selection = selectAffectedScans(FIXTURE, ['scripts/harness/x.mjs']);
    expect(selection.full).toBe(false);
    expect(selection.selected.map((s) => s.name)).toEqual(['harness-only', 'every-change']);
    expect(selection.excluded.map((s) => s.name)).toEqual(['packages-only', 'markdown']);
    expect(describeAffectedSelection(selection)).toBe(
      'affected: 2 selected, 2 excluded (packages-only, markdown)',
    );
  });

  it('selects an `always` scan for ANY change', () => {
    for (const changed of [['README.md'], ['packages/a/src/x.ts'], ['scripts/harness/x.mjs']]) {
      const names = selectAffectedScans(FIXTURE, changed).selected.map((s) => s.name);
      expect(names, changed.join()).toContain('every-change');
    }
  });

  it('selects the FULL registry, and says which path, when a changed path matches no glob', () => {
    const selection = selectAffectedScans(FIXTURE, ['scripts/harness/x.mjs', 'some/unknown/path']);
    expect(selection.full).toBe(true);
    expect(selection.unmatched).toEqual(['some/unknown/path']);
    expect(selection.reason).toContain('`some/unknown/path`');
    expect(selection.reason).toContain('full suite');
    expect(selection.selected).toHaveLength(FIXTURE.length);
    expect(selection.excluded).toEqual([]);
    expect(describeAffectedSelection(selection)).toBe('affected: 4 selected, 0 excluded');
  });

  it('selects the FULL registry when no changed path could be resolved', () => {
    const selection = selectAffectedScans(FIXTURE, []);
    expect(selection.full).toBe(true);
    expect(selection.reason).toContain('no changed paths');
    expect(selection.selected).toHaveLength(FIXTURE.length);
  });

  it('refuses a registration that declares neither `examines` nor `always`', () => {
    // A scan that cannot say what it reads would otherwise be skipped on every affected run — a
    // quiet exclusion, which is the shape the whole mechanism must not have.
    expect(() =>
      selectAffectedScans([...FIXTURE, { name: 'mute', command: ['node', 'x.mjs'] }], ['a.md']),
    ).toThrow(/mute.*neither/);
  });
});

describe('parseRunOptions / parseStatusPorcelain', () => {
  it('defaults to the integration context and refuses an unknown one', () => {
    expect(parseRunOptions([]).context).toBe('integration');
    expect(parseRunOptions(['--context', 'pr']).context).toBe('pr');
    expect(() => parseRunOptions(['--context', 'nightly'])).toThrow(/--context must be one of/);
    expect(SCAN_CONTEXTS).toEqual(['pr', 'integration']);
  });

  it('reads --affected, --changed, --base, --list and keeps --skip', () => {
    const options = parseRunOptions([
      '--affected',
      '--changed',
      'a.md, b/c.ts,',
      '--base',
      'origin/develop',
      '--list',
      '--skip',
      'dist',
    ]);
    expect(options.affected).toBe(true);
    expect(options.changed).toEqual(['a.md', 'b/c.ts']);
    expect(options.base).toBe('origin/develop');
    expect(options.list).toBe(true);
    expect([...options.skips]).toEqual(['dist']);
    expect(parseRunOptions([]).changed).toBeNull();
  });

  it('reads a rename by its new name and an untracked entry as a path', () => {
    expect(parseStatusPorcelain('R  old.mjs -> new.mjs\n?? fresh/\n M x.md\n')).toEqual([
      'new.mjs',
      'fresh/',
      'x.md',
    ]);
  });
});

describe('advisory scans under --context (TC-09)', () => {
  const fixture = (advisoryCode, strictCode = 0) => [
    { name: 'prose-grader', run: () => ({ code: advisoryCode, output: 'graded prose\n' }) },
    { name: 'strict', run: () => ({ code: strictCode, output: '' }) },
  ];
  const advisoryNames = new Set(['prose-grader']);

  it('pr: a failing advisory scan is reported on the advisory channel and does not fail the run', async () => {
    const lines = [];
    let outcome = null;
    const code = await runScans(fixture(1), (line) => lines.push(line), 2, {
      context: 'pr',
      advisoryNames,
      onOutcome: (result) => {
        outcome = result;
      },
    });
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('::advisory::');
    expect(out).toMatch(/⚑ prose-grader/);
    expect(out).toContain('graded prose');
    expect(out).toContain('1 advisory failure(s) tolerated (pr context)');
    expect(outcome).toEqual({ tolerated: ['prose-grader'] });
  });

  it('integration: the same failure fails the run (RED control)', async () => {
    const lines = [];
    const code = await runScans(fixture(1), (line) => lines.push(line), 2, {
      context: 'integration',
      advisoryNames,
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/✗ prose-grader/);
  });

  it('pr: a failing NON-advisory scan still fails the run (RED control)', async () => {
    const code = await runScans(fixture(0, 1), () => {}, 2, { context: 'pr', advisoryNames });
    expect(code).toBe(1);
  });

  it('refuses an unknown context rather than guessing which lane applies', async () => {
    await expect(runScans(fixture(0), () => {}, 2, { context: 'nightly' })).rejects.toThrow(
      /unknown context/,
    );
  });
});

describe('the live registry declares what every scan reads', () => {
  it('every entry has `examines` (non-empty globs) or `always: true`, never both, never neither', () => {
    for (const scan of SCAN_COMMANDS) {
      const declares = Array.isArray(scan.examines);
      expect(declares || scan.always === true, `${scan.name} declares nothing`).toBe(true);
      expect(declares && scan.always === true, `${scan.name} declares both`).toBe(false);
      if (declares) {
        expect(scan.examines.length, `${scan.name} examines []`).toBeGreaterThan(0);
        for (const glob of scan.examines) {
          expect(typeof glob === 'string' && glob.length > 0, `${scan.name}: ${glob}`).toBe(true);
        }
      }
    }
    console.log(`::examined:: ${SCAN_COMMANDS.length} registered scans`);
  });

  it('registers lane-declaration as an always-run scan (PROC-016)', () => {
    const lane = SCAN_COMMANDS.find((scan) => scan.name === 'lane-declaration');
    expect(lane).toBeDefined();
    expect(lane.always).toBe(true);
    expect(lane.command).toEqual(['node', 'scripts/harness/scan-lane-declaration.mjs']);
  });

  it('marks exactly the prose/transcript graders advisory, and every advisory scan is always-run', () => {
    expect([...advisoryScanNames()].sort()).toEqual([
      'progress-report-quantification',
      'reference-kind-qualified',
    ]);
    for (const scan of SCAN_COMMANDS) {
      if (scan.advisory) expect(scan.always, `${scan.name} is advisory but not always`).toBe(true);
    }
  });

  it('every declared glob points at something that exists in the tree (no stale path constants)', () => {
    // The literal prefix of a glob — up to its first wildcard — must resolve: as a path, or as the
    // stem of at least one entry in its directory (`tsconfig*.json` → `tsconfig.json`).
    //
    // A glob for a file the scan reads WHEN IT APPEARS is listed here with the reason, so the
    // exemption is a reviewable line and not a silent gap in the check.
    const NOT_YET_IN_TREE = new Map([
      [
        'mistake-mechanisms: eslint.config.*',
        'the scan resolves an ESLint flat config first and falls back to .eslintrc.*; the repo has not migrated',
      ],
    ]);
    const missing = [];
    for (const scan of SCAN_COMMANDS) {
      for (const glob of scan.examines ?? []) {
        if (NOT_YET_IN_TREE.has(`${scan.name}: ${glob}`)) continue;
        const wildcard = glob.search(/[*?{]/);
        const prefix = wildcard === -1 ? glob : glob.slice(0, wildcard);
        if (prefix === '') continue; // `**/*.md` — the whole tree
        const absolute = path.join(REPO_ROOT, prefix);
        if (existsSync(absolute)) continue;
        const dir = path.dirname(absolute);
        const stem = path.basename(prefix);
        const siblings = existsSync(dir) ? readdirSync(dir) : [];
        if (stem && siblings.some((entry) => entry.startsWith(stem))) continue;
        missing.push(`${scan.name}: ${glob}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the runner on the live registry (TC-07)', () => {
  function list(args) {
    const result = spawnSync(process.execPath, [RUNNER, '--affected', '--list', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const summary = /^affected: (\d+) selected, (\d+) excluded/m.exec(result.stdout);
    expect(summary, result.stdout).not.toBeNull();
    return {
      stdout: result.stdout,
      selected: Number(summary[1]),
      excluded: Number(summary[2]),
      names: [...result.stdout.matchAll(/^selected: (\S+)/gm)].map((m) => m[1]),
    };
  }

  it('a one-file change under scripts/harness/ selects fewer than 40 scans and prints the excluded count', () => {
    const run = list(['--changed', 'scripts/harness/x.mjs']);
    expect(run.selected).toBeLessThan(40);
    expect(run.selected + run.excluded).toBe(SCAN_COMMANDS.length);
    expect(run.excluded).toBeGreaterThan(0);
    expect(run.stdout).toMatch(/excluded \(/);
    expect(run.names).toContain('lane-declaration');
    expect(run.names).toContain('harness-script-import-safety');
    expect(run.names).not.toContain('memory-mirror');
  });

  it('an unclassifiable path selects the full suite and says why', () => {
    const run = list(['--changed', 'some/unknown/path']);
    expect(run.selected).toBe(SCAN_COMMANDS.length);
    expect(run.excluded).toBe(0);
    expect(run.stdout).toContain('`some/unknown/path`');
    expect(run.stdout).toContain('full suite');
  });

  it('--skip still removes a scan before selection', () => {
    const run = list(['--changed', 'packages/agent-core/src/index.ts', '--skip', 'dist']);
    expect(run.stdout).toContain('skipped: dist (--skip)');
    expect(run.names).not.toContain('dist');
    expect(run.selected + run.excluded).toBe(SCAN_COMMANDS.length - 1);
  });
});
