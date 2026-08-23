/**
 * INFRA-048-C — `detectChangedFiles` must FAIL CLOSED when the base ref cannot be resolved.
 *
 * It used to return `[]`, which every caller (`harness:plan`, `harness:verify`, `harness:record`,
 * `harness:review`) reads as "nothing to check" — so a branch carrying real source changes was
 * planned as zero scopes and `harness:verify` exited 0 having verified nothing. "Could not compute
 * the change set" and "the change set is empty" had the same representation; now only the second
 * one is an empty list.
 *
 * `detectChangedFiles` binds `WORKSPACE_ROOT` to `process.cwd()`, so these run the real CLI
 * entrypoints as subprocesses against throwaway git workspaces — the same shape the defect had.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const PLAN_SCRIPT = path.resolve(import.meta.dirname, '../plan-change.mjs');
const VERIFY_SCRIPT = path.resolve(import.meta.dirname, '../verify-change.mjs');

/**
 * Environment for git subprocesses, with every inherited GIT_* variable stripped. A git hook
 * (husky pre-push runs the harness) exports GIT_DIR/GIT_INDEX_FILE, which redirect EVERY child
 * `git` call to the REAL repository regardless of cwd — fixture commits would land on a live branch.
 * `HARNESS_BASE_REF`/`GITHUB_BASE_REF` are cleared too: they are base-ref candidates, and a leaked
 * value from the surrounding CI run would resolve a base the fixture is meant not to have.
 */
function fixtureEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  delete env.HARNESS_BASE_REF;
  delete env.GITHUB_BASE_REF;
  return { ...env, ...extra };
}

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: fixtureEnv(),
  });
}

/**
 * A minimal pnpm workspace in a git repo. `baseBranch: 'develop'` creates a resolvable base-ref
 * candidate; omitting it leaves a repo with no `origin`, no `develop` and no `main` — the exact
 * "base ref cannot be resolved" condition.
 */
async function createWorkspaceFixture({ baseBranch = null, sourceChange = true } = {}) {
  const root = makeTemp('robota-detect-changed-');
  mkdirSync(path.join(root, 'packages/widget/src'), { recursive: true });
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8');
  writeFileSync(path.join(root, 'package.json'), '{"name":"root","private":true}\n', 'utf8');
  writeFileSync(
    path.join(root, 'packages/widget/package.json'),
    '{"name":"widget","version":"1.0.0","scripts":{"test":"echo widget-test"}}\n',
    'utf8',
  );
  writeFileSync(path.join(root, 'packages/widget/src/index.ts'), 'export const widget = 1;\n');
  git(root, ['init', '-q', '-b', 'base']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  if (baseBranch) git(root, ['branch', baseBranch, 'base']);
  git(root, ['checkout', '-q', '-b', 'work']);
  if (sourceChange) {
    writeFileSync(path.join(root, 'packages/widget/src/index.ts'), 'export const widget = 2;\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'change widget source']);
  }
  return root;
}

function run(script, cwd, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: fixtureEnv(),
  });
}

describe('detectChangedFiles fail-closed (INFRA-048-C)', () => {
  it('FAIL-CLOSED: harness:plan exits non-zero when no base ref resolves', async () => {
    const root = await createWorkspaceFixture();
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to resolve a base ref');
    // The defect's signature: it used to print a plan claiming the branch changed nothing.
    expect(result.stdout).not.toContain('Changed files: 0');
  });

  it('FAIL-CLOSED: harness:verify refuses to report success it did not compute', async () => {
    const root = await createWorkspaceFixture();
    const result = run(VERIFY_SCRIPT, root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to resolve a base ref');
    expect(result.stdout).not.toContain('No package or app scope detected');
  });

  it('NO REGRESSION: a resolvable base still detects the changed scope', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop' });
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Changed files: 1');
    expect(result.stdout).toContain('packages/widget');
  });

  it('NO REGRESSION: a genuinely empty diff is still an empty list, not an error', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop', sourceChange: false });
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Changed files: 0');
  });

  it('NO REGRESSION: a dirty working tree is still detected', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop', sourceChange: false });
    writeFileSync(path.join(root, 'packages/widget/src/index.ts'), 'export const widget = 3;\n');
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Changed files: 1');
  });

  it('FAIL-CLOSED: a dirty working tree does not excuse an unresolvable base ref', async () => {
    // Formerly the dirty tree short-circuited BEFORE base resolution, so this exited 0 reporting
    // only the uncommitted file — under-counting a branch whose commits it never looked at.
    const root = await createWorkspaceFixture();
    writeFileSync(path.join(root, 'packages/widget/src/index.ts'), 'export const widget = 3;\n');
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to resolve a base ref');
  });

  it('NO REGRESSION: an explicit --base-ref works without any branch-name convention', async () => {
    const root = await createWorkspaceFixture();
    const result = run(PLAN_SCRIPT, root, ['--base-ref', 'base']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Changed files: 1');
  });
});

/**
 * INFRA-056 — the change set is the UNION of the working tree and the base diff, never one or the
 * other.
 *
 * The defect: `detectChangedFiles` RETURNED EARLY on the working-tree entries whenever the tree was
 * dirty, and never consulted the base-ref diff at all. CI never takes that path — it checks out
 * clean, so its plan always comes from `origin/<base>...HEAD`. Locally the two diverge, and they
 * diverge silently in the UNDER-counting direction: one dirty scratch file is enough to make a
 * branch full of package-source commits plan zero package scopes, print "No package or app scope
 * detected" and exit 0 having verified nothing. That is what `verify-like-ci`'s `affected-verify`
 * stage would inherit, so it is fixed here rather than worked around there.
 */
describe('detectChangedFiles unions the working tree with the base diff (INFRA-056)', () => {
  /** A dirty file OUTSIDE any package — the shape of a stray lesson/scratch file. */
  function dirtyUnrelatedFile(root) {
    mkdirSync(path.join(root, 'notes'), { recursive: true });
    writeFileSync(path.join(root, 'notes/scratch.txt'), 'untracked scratch\n', 'utf8');
  }

  it('a dirty unrelated file does not hide the committed package scope', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop' });
    dirtyUnrelatedFile(root);
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).toBe(0);
    // Pre-fix this printed "Changed files: 1" (the scratch file only) and planned no scopes.
    expect(result.stdout).toContain('packages/widget');
    expect(result.stdout).toContain('notes/scratch.txt');
  });

  it('harness:verify still selects the committed scope on a dirty tree', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop' });
    dirtyUnrelatedFile(root);
    const result = run(VERIFY_SCRIPT, root, ['--skip-record-check']);
    // Pre-fix: "No package or app scope detected" — a green run that verified nothing.
    expect(result.stdout).not.toContain('No package or app scope detected');
    expect(result.stdout).toContain('packages/widget');
  });

  it('a file changed in BOTH the working tree and the branch appears once', async () => {
    const root = await createWorkspaceFixture({ baseBranch: 'develop' });
    writeFileSync(path.join(root, 'packages/widget/src/index.ts'), 'export const widget = 4;\n');
    const result = run(PLAN_SCRIPT, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Changed files: 1');
  });
});
