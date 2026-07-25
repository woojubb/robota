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
  parseArgs,
  parseGitFileList,
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
// stage table + summary + args
// ---------------------------------------------------------------------------

describe('CI_STAGES', () => {
  it('covers the four gates a bare run-all-scans misses', () => {
    expect(CI_STAGES.map((stage) => stage.name)).toEqual([
      'harness-self-test',
      'format-check',
      'scan-suite',
      'typecheck',
    ]);
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
