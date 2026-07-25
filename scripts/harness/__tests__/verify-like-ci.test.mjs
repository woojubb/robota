import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CI_STAGES,
  collectChangedFiles,
  findMissingDist,
  globExtensions,
  lintStagedExtensions,
  listBuildablePackageDirs,
  listNodeModulesOwners,
  parseArgs,
  parseDistIndependentScanSkips,
  parseGitFileList,
  readDistIndependentScanSkips,
  readLintStagedExtensions,
  selectFormatTargets,
  summarize,
} from '../verify-like-ci.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function createFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-like-ci-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

// ---------------------------------------------------------------------------
// lint-staged glob derivation
// ---------------------------------------------------------------------------

describe('globExtensions', () => {
  it('expands a braced lint-staged glob into every extension', () => {
    expect(globExtensions('*.{json,md,yml,yaml}')).toEqual(['.json', '.md', '.yml', '.yaml']);
  });

  it('expands a single-extension glob', () => {
    expect(globExtensions('*.ts')).toEqual(['.ts']);
  });

  it('ignores a non-extension glob (nothing to hand prettier)', () => {
    expect(globExtensions('packages/**/src')).toEqual([]);
  });
});

describe('lintStagedExtensions', () => {
  it('derives the union of every configured glob, deduplicated and sorted', () => {
    expect(
      lintStagedExtensions({
        '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
        '*.{js,mjs,cjs}': ['prettier --write'],
        '*.{json,md,yml,yaml}': ['prettier --write'],
      }),
    ).toEqual(['.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml']);
  });

  it('is derived from the config, not hardcoded — a narrowed config narrows the set', () => {
    expect(lintStagedExtensions({ '*.md': ['prettier --write'] })).toEqual(['.md']);
  });

  it('reads the live .lintstagedrc.json and includes the YAML/markdown drift extensions', () => {
    const live = readLintStagedExtensions(WORKSPACE_ROOT);
    // The #1369 drift class was a prettier-wrapped YAML array inside a markdown frontmatter block.
    expect(live).toContain('.md');
    expect(live).toContain('.yml');
    expect(live).toContain('.yaml');
    expect(live).toContain('.ts');
  });
});

describe('selectFormatTargets', () => {
  const extensions = ['.md', '.ts', '.yml'];

  it('keeps only formatter-owned files', () => {
    expect(
      selectFormatTargets(
        ['a.md', 'b.ts', 'c.png', 'd.yml', 'packages/foo/src/x.snap'],
        extensions,
      ),
    ).toEqual(['a.md', 'b.ts', 'd.yml']);
  });

  it('deduplicates a file reported by more than one git query', () => {
    expect(selectFormatTargets(['a.md', 'a.md', 'a.md'], extensions)).toEqual(['a.md']);
  });

  it('matches the extension case-insensitively', () => {
    expect(selectFormatTargets(['README.MD'], extensions)).toEqual(['README.MD']);
  });
});

describe('parseGitFileList', () => {
  it('splits, trims and drops empty lines', () => {
    expect(parseGitFileList('a.md\n b.ts \n\n')).toEqual(['a.md', 'b.ts']);
  });

  it('returns an empty list for no output', () => {
    expect(parseGitFileList(undefined)).toEqual([]);
  });
});

describe('collectChangedFiles', () => {
  it('unions base-diff, working-tree and untracked files (untracked would else be invisible)', () => {
    const calls = [];
    const runner = (args) => {
      calls.push(args.join(' '));
      if (args.includes('ls-files')) return ['scripts/harness/verify-like-ci.mjs'];
      if (args.includes('HEAD') && !args.some((a) => a.includes('...'))) return ['package.json'];
      return ['AGENTS.md'];
    };
    const files = collectChangedFiles('origin/develop', runner);
    // Only files that exist on disk survive; all three of these do in this repo.
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('package.json');
    expect(files).toContain('scripts/harness/verify-like-ci.mjs');
    expect(calls.some((call) => call.includes('origin/develop...HEAD'))).toBe(true);
    expect(calls.some((call) => call.includes('ls-files --others'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dist presence
// ---------------------------------------------------------------------------

describe('listBuildablePackageDirs', () => {
  it('lists only packages that declare build:js (the script root `pnpm build` fans out to)', () => {
    const root = createFixture({
      'packages/built/package.json': JSON.stringify({ scripts: { 'build:js': 'x' } }),
      'packages/no-build/package.json': JSON.stringify({ scripts: { test: 'x' } }),
      'packages/dag-nodes/nested/package.json': JSON.stringify({ scripts: { 'build:js': 'x' } }),
    });
    expect(listBuildablePackageDirs(root)).toEqual(['packages/built', 'packages/dag-nodes/nested']);
  });

  it('finds the live workspace packages (the real dist set CI restores)', () => {
    expect(listBuildablePackageDirs(WORKSPACE_ROOT).length).toBeGreaterThan(10);
  });
});

describe('findMissingDist', () => {
  it('reports every buildable package with no dist/ — an unbuilt tree must not read as a pass', () => {
    const root = createFixture({
      'packages/built/package.json': '{}',
      'packages/built/dist/index.js': '',
      'packages/unbuilt/package.json': '{}',
    });
    expect(findMissingDist(['packages/built', 'packages/unbuilt'], undefined, root)).toEqual([
      'packages/unbuilt',
    ]);
  });

  it('returns nothing when every package is built', () => {
    const root = createFixture({ 'packages/built/dist/index.js': '' });
    expect(findMissingDist(['packages/built'], undefined, root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dist-free tree (HARNESS-047): the scans CI runs on a checkout with NO dist
// ---------------------------------------------------------------------------

const CI_SCANS_JOB_FIXTURE = `
  scans:
    name: scans
    steps:
      - name: Harness scan test suite
        run: pnpm harness:test
      - name: Harness scan suite (dist-independent)
        run: pnpm harness:scan -- --skip dist --skip build-contracts
`;

describe('parseDistIndependentScanSkips', () => {
  it("derives the skip set from ci.yml's scans job instead of hardcoding it", () => {
    expect(parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE)).toEqual([
      'dist',
      'build-contracts',
    ]);
  });

  it('follows CI drift — a third skip in ci.yml is picked up automatically', () => {
    const drifted = CI_SCANS_JOB_FIXTURE.replace(
      '--skip build-contracts',
      '--skip build-contracts --skip docs-structure',
    );
    expect(parseDistIndependentScanSkips(drifted)).toEqual([
      'dist',
      'build-contracts',
      'docs-structure',
    ]);
  });

  it('throws when no dist-independent scan step exists — never silently scans nothing', () => {
    expect(() => parseDistIndependentScanSkips('jobs:\n  scans:\n    steps: []\n')).toThrow(
      /harness:scan/,
    );
  });

  it('throws when ci.yml has more than one such invocation (ambiguous mirror target)', () => {
    expect(() => parseDistIndependentScanSkips(CI_SCANS_JOB_FIXTURE.repeat(2))).toThrow(
      /more than one/i,
    );
  });

  it('reads the LIVE ci.yml — the stage mirrors the real job, not a copy of it', () => {
    expect(readDistIndependentScanSkips(WORKSPACE_ROOT)).toEqual(['dist', 'build-contracts']);
  });
});

describe('listNodeModulesOwners', () => {
  it('lists every dir owning an installed node_modules (linked so the scans can run)', () => {
    const root = createFixture({
      'node_modules/vitest/index.js': '',
      'packages/a/node_modules/dep/index.js': '',
      'packages/a/dist/index.js': '',
      'packages/b/src/index.ts': '',
    });
    expect(listNodeModulesOwners(root)).toEqual(['', 'packages/a']);
  });

  it('never descends into node_modules or dist (their inner installs are irrelevant)', () => {
    const root = createFixture({
      'node_modules/dep/node_modules/nested/index.js': '',
      'packages/a/dist/node_modules/ghost/index.js': '',
    });
    expect(listNodeModulesOwners(root)).toEqual(['']);
  });

  it('finds the live workspace installs (root + packages)', () => {
    const owners = listNodeModulesOwners(WORKSPACE_ROOT);
    expect(owners).toContain('');
    expect(owners.some((dir) => dir.startsWith('packages/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stage table + summary + args
// ---------------------------------------------------------------------------

describe('CI_STAGES', () => {
  it('covers the five gates a bare run-all-scans misses', () => {
    expect(CI_STAGES.map((stage) => stage.name)).toEqual([
      'harness-self-test',
      'format-check',
      'scan-suite',
      'scan-suite-dist-free',
      'typecheck',
    ]);
  });

  it('mirrors BOTH CI scan halves — the built-tree job and the dist-free job (neither replaces the other)', () => {
    const built = CI_STAGES.find((stage) => stage.name === 'scan-suite');
    const distFree = CI_STAGES.find((stage) => stage.name === 'scan-suite-dist-free');
    // `quality` restores dist before the build-dependent scans; `scans` runs on a fresh checkout.
    expect(built.ciSource).toMatch(/quality/);
    expect(distFree.ciSource).toMatch(/scans/);
    expect(distFree.ciSource).toMatch(/dist/);
    expect(built.ciSource).not.toEqual(distFree.ciSource);
  });

  it('names the real CI/lint-staged definition each stage mirrors (traceable, not guessed)', () => {
    for (const stage of CI_STAGES) {
      expect(stage.ciSource).toMatch(/ci\.yml|lintstagedrc/);
      expect(stage.why.length).toBeGreaterThan(0);
    }
  });
});

describe('summarize', () => {
  it('reports PASS and exit 0 when every stage passed', () => {
    const { lines, exitCode } = summarize([
      { name: 'harness-self-test', status: 'pass' },
      { name: 'format-check', status: 'pass' },
    ]);
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('PASS');
  });

  it('names the failing stage and exits 1', () => {
    const { lines, exitCode } = summarize([
      { name: 'harness-self-test', status: 'fail' },
      { name: 'format-check', status: 'pass' },
      { name: 'scan-suite', status: 'fail', note: 'dist missing' },
    ]);
    expect(exitCode).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('FAIL — 2 of 3 stage(s) failed: harness-self-test, scan-suite');
    expect(text).toContain('dist missing');
    // The failing stage points at the CI definition it mirrors, so the fix target is unambiguous.
    expect(text).toContain('harness-self-test mirrors ci.yml');
  });
});

describe('parseArgs', () => {
  it('defaults to every stage against origin/develop', () => {
    const options = parseArgs([]);
    expect(options.only.size).toBe(0);
    expect(options.baseRef).toBe('origin/develop');
    expect(options.allFiles).toBe(false);
    expect(options.unknown).toEqual([]);
  });

  it('parses --only (repeatable), --base-ref and --all-files', () => {
    const options = parseArgs([
      '--only',
      'format-check',
      '--only',
      'typecheck',
      '--base-ref',
      'origin/main',
      '--all-files',
    ]);
    expect([...options.only]).toEqual(['format-check', 'typecheck']);
    expect(options.baseRef).toBe('origin/main');
    expect(options.allFiles).toBe(true);
  });

  it('reports an unknown stage name instead of silently running nothing', () => {
    expect(parseArgs(['--only', 'nope']).unknown).toEqual(['nope']);
  });
});
