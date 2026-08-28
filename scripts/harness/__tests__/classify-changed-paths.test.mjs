/**
 * The changed-path classifier is the SINGLE mechanism deciding whether a PR contains code. Two
 * consumers depend on it and must not be able to disagree:
 *
 *   - ci.yml `changes` — whether the required build/test matrix runs.
 *   - review-gate.yml — whether a code-scanning analysis is expected at all (#1436: a docs-only PR
 *     was blocked for 15 m 23 s waiting for an analysis CodeQL never schedules).
 *
 * Two properties are load-bearing and both are asserted mechanically here: workflows consume this
 * classifier instead of copying the docs set, and every undeterminable case answers CODE.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DOCS_ONLY_GLOBS,
  classifyFiles,
  classifyRange,
  isDocsOnlyPath,
  isHarnessOwnerPath,
} from '../classify-changed-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.resolve(import.meta.dirname, '../classify-changed-paths.mjs');

describe('the classifier owns the docs-only set', () => {
  it('workflows do not carry a second paths-ignore list', () => {
    const reviewGate = readFileSync(
      path.join(REPO_ROOT, '.github/workflows/review-gate.yml'),
      'utf8',
    );
    const codeql = readFileSync(path.join(REPO_ROOT, '.github/workflows/codeql.yml'), 'utf8');
    expect(reviewGate).not.toContain('paths-ignore:');
    expect(codeql).not.toContain('paths-ignore:');
    expect(
      reviewGate.match(/^\s*node scripts\/harness\/classify-changed-paths\.mjs/gm),
    ).toHaveLength(1);
  });

  it('every declared docs path is classified docs-only, and code paths are not', () => {
    expect(DOCS_ONLY_GLOBS).toEqual(['**/*.md', '**/*.mdx', 'docs/**', 'content/**']);
    for (const file of ['README.md', '.agents/tasks/X.md', 'docs/a/b.mdx', 'content/post.md']) {
      expect(isDocsOnlyPath(file), file).toBe(true);
    }
    for (const file of [
      'packages/agent-core/src/index.ts',
      'scripts/harness/check-review-gate.mjs',
      '.github/workflows/ci.yml',
      'package.json',
      'apps/agent-app/src/main.tsx',
    ]) {
      expect(isDocsOnlyPath(file), file).toBe(false);
    }
  });
});

describe('classifyFiles', () => {
  it.each([
    'scripts/harness/check-review-gate.mjs',
    '.github/workflows/ci.yml',
    '.agents/harness.config.json',
    'package.json',
    'pnpm-lock.yaml',
    'vitest.config.ts',
    'vitest.shared.ts',
    '.npmrc',
  ])('classifies harness owner path %s as harness-applicable', (file) => {
    expect(isHarnessOwnerPath(file)).toBe(true);
    expect(classifyFiles([file]).harness).toBe(true);
  });

  it('treats documentation under a harness owner directory as harness-applicable', () => {
    expect(classifyFiles(['scripts/harness/README.md']).harness).toBe(true);
  });

  it.each([
    'packages/agent-core/src/index.ts',
    'apps/agent-app/src/main.tsx',
    'README.md',
    'docs/guide.mdx',
  ])('does not classify non-owner path %s as harness-applicable', (file) => {
    expect(isHarnessOwnerPath(file)).toBe(false);
    expect(classifyFiles([file]).harness).toBe(false);
  });

  it('classifies a markdown-only change as docs-only — the #1436 shape', () => {
    const result = classifyFiles(['.agents/tasks/INFRA-053-review-turn-budget.md']);
    expect(result.code).toBe(false);
  });

  it('one code file among many docs files is CODE', () => {
    const result = classifyFiles(['README.md', 'docs/guide.mdx', 'packages/a/src/x.ts']);
    expect(result.code).toBe(true);
  });

  it('a workflow or harness script change is CODE, not docs', () => {
    expect(classifyFiles(['.github/workflows/review-gate.yml'])).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
    });
    expect(classifyFiles(['scripts/harness/check-review-gate.mjs'])).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
    });
  });

  it('runs product capabilities for package and app changes', () => {
    expect(classifyFiles(['packages/agent-core/src/index.ts'])).toMatchObject({
      code: true,
      product: true,
      tui: true,
      examples: true,
    });
  });

  // "Nothing classified" must run the checks, not skip them.
  it('FAIL-CLOSED: an empty file list is CODE', () => {
    expect(classifyFiles([])).toMatchObject({
      code: true,
      product: true,
      tui: true,
      examples: true,
      harness: true,
    });
    expect(classifyFiles(undefined)).toMatchObject({
      code: true,
      product: true,
      tui: true,
      examples: true,
      harness: true,
    });
  });
});

describe('classifyRange (fail-closed on git)', () => {
  const ok = (stdout) => ({ ok: true, stdout, stderr: '' });
  const fail = () => ({ ok: false, stdout: '', stderr: 'fatal' });

  it('FAIL-CLOSED: no merge base classifies as CODE and reports the reason', () => {
    const result = classifyRange({ baseRef: 'origin/develop', runGit: () => fail() });
    expect(result.code).toBe(true);
    expect(result).toMatchObject({ product: true, tui: true, examples: true });
    expect(result.harness).toBe(true);
    expect(result.error).toContain('no merge base');
  });

  it('FAIL-CLOSED: a failed diff classifies as CODE', () => {
    const runGit = (args) => (args[0] === 'merge-base' ? ok('abc123\n') : fail());
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(result.code).toBe(true);
    expect(result.harness).toBe(true);
    expect(result.error).toContain('git diff against merge base abc123 failed');
  });

  // A criss-cross history (this repo back-merges main <-> develop) can have several merge bases.
  // Taking the UNION can only over-report code, never silently under-report it.
  it('unions the diff over every merge base', () => {
    const runGit = (args) => {
      if (args[0] === 'merge-base') return ok('base1\nbase2\n');
      return ok(args[3] === 'base1' ? 'README.md\n' : 'packages/a/src/x.ts\n');
    };
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(result.bases).toEqual(['base1', 'base2']);
    expect(result.files).toEqual(['README.md', 'packages/a/src/x.ts']);
    expect(result.code).toBe(true);
  });

  it('classifies rename/delete paths from the canonical ACMRD diff', () => {
    const calls = [];
    const runGit = (args) => {
      calls.push(args);
      return args[0] === 'merge-base' ? ok('base1\n') : ok('scripts/harness/deleted.mjs\n');
    };
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(calls[1]).toEqual(['diff', '--name-only', '--diff-filter=ACMRD', 'base1', 'HEAD']);
    expect(result).toMatchObject({ harness: true, files: ['scripts/harness/deleted.mjs'] });
  });
});

describe('CLI (the shape both workflows call)', () => {
  it('prints a `code=` line and exits 0 against the real repository', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--base-ref', 'origin/develop', '--head', 'HEAD'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^code=(true|false)$/m);
    expect(result.stdout).toMatch(/^product=(true|false)$/m);
    expect(result.stdout).toMatch(/^tui=(true|false)$/m);
    expect(result.stdout).toMatch(/^examples=(true|false)$/m);
    expect(result.stdout).toMatch(/^harness=(true|false)$/m);
  });

  it('FAIL-CLOSED: an unresolvable base ref still answers code=true', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--base-ref', 'origin/definitely-no-such-ref'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('code=true');
    expect(result.stdout).toContain('::error::changes:');
  });
});

describe('CI capability wiring', () => {
  it('publishes capability outputs and keeps expensive required jobs present with explicit N/A results', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('product: ${{ steps.filter.outputs.product }}');
    expect(workflow).toContain('tui: ${{ steps.filter.outputs.tui }}');
    expect(workflow).toContain('examples: ${{ steps.filter.outputs.examples }}');
    expect(workflow).toContain('harness: ${{ steps.filter.outputs.harness }}');
    expect(workflow).toContain('name: Product verification not applicable');
    expect(workflow).toContain('name: TUI verification not applicable');
    expect(workflow).toContain('name: Examples verification not applicable');
    expect(workflow).toContain("needs.changes.result != 'success'");
  });

  it('assigns the harness suite to scans instead of rerunning it in quality', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const qualityStart = workflow.indexOf('\n  quality:\n');
    const scansStart = workflow.indexOf('\n  scans:\n');
    const quality = workflow.slice(qualityStart, scansStart);
    const scans = workflow.slice(scansStart, workflow.indexOf('\n  dependency-audit:\n'));

    expect(quality).toContain('--skip-repository-check harness-tests');
    expect(scans).toContain('pnpm harness:test:contracts');
    expect(scans).toContain('pnpm harness:test:hermetic');
    expect(scans).toContain("needs.changes.outputs.harness != 'false'");
    expect(scans).toContain('pnpm harness:scan -- --skip dist --skip build-contracts');
    expect(scans).not.toMatch(/scripts\/harness\/\*\*/);
  });
});

describe('the harness records under .agents/ are infrastructure, not product (PROC-016)', () => {
  it('a ledger append plus a harness script is code but not product', () => {
    const verdict = classifyFiles([
      '.agents/loop-runs/user-execution-scenario.jsonl',
      'scripts/harness/loop-run.mjs',
    ]);
    expect(verdict.code).toBe(true);
    expect(verdict.product).toBe(false);
  });

  it('a package source file is still product', () => {
    expect(classifyFiles(['packages/agent-core/src/index.ts']).product).toBe(true);
  });
});
