import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/branch-guard.sh');

/**
 * A real merge-in-progress, judged from inside a git WORKTREE (issue #2644).
 *
 * `.git` inside a worktree is a `gitdir:` pointer FILE, not a directory, so `MERGE_HEAD` never lives
 * at `<worktree>/.git/MERGE_HEAD` — the real per-worktree state is wherever
 * `git rev-parse --git-path MERGE_HEAD` says it is. A check that reads the hardcoded path reports
 * "no merge in progress" while a real merge sits unresolved, and blocks the completing commit on
 * `main`/`master` with the ordinary protected-branch refusal instead of letting the merge finish.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

/** A repo on `main` with `feat/conflict` diverged on the same line, ready to merge-and-conflict. */
function repoWithConflictSetup(dir) {
  git(dir.root, 'init', '--quiet', '--initial-branch=main', dir.path);
  git(dir.path, 'config', 'user.email', 'harness@example.test');
  git(dir.path, 'config', 'user.name', 'Harness');
  writeFileSync(path.join(dir.path, 'file.txt'), 'base\n');
  git(dir.path, 'add', '-A');
  git(dir.path, 'commit', '--quiet', '-m', 'chore: root');

  git(dir.path, 'checkout', '--quiet', '-b', 'feat/conflict');
  writeFileSync(path.join(dir.path, 'file.txt'), 'from-feature\n');
  git(dir.path, 'add', '-A');
  git(dir.path, 'commit', '--quiet', '-m', 'feat: change on the side branch');
  git(dir.path, 'checkout', '--quiet', 'main');

  writeFileSync(path.join(dir.path, 'file.txt'), 'from-main\n');
  git(dir.path, 'add', '-A');
  git(dir.path, 'commit', '--quiet', '-m', 'chore: conflicting change on main');
}

/** An ordinary (non-worktree) checkout on `main`, with `feat/conflict` ready to merge-and-conflict. */
function ordinaryRepo() {
  const root = makeTemp('branch-guard-worktree-');
  scratch.push(root);
  const main = path.join(root, 'main-checkout');
  repoWithConflictSetup({ root, path: main });
  return { main };
}

/** The same setup, but `main` is held by a LINKED WORKTREE rather than the primary checkout. */
function repoWithMainWorktree() {
  const root = makeTemp('branch-guard-worktree-');
  scratch.push(root);
  const main = path.join(root, 'main-checkout');
  const worktree = path.join(root, 'wt');
  repoWithConflictSetup({ root, path: main });

  // `main` cannot be checked out in two worktrees at once — detach the primary checkout so the
  // linked worktree below can hold `main` (git worktree requires the branch itself, not the same
  // commit under another name, since this hook judges the branch NAME).
  git(main, 'checkout', '--quiet', '--detach', 'main');
  const addWorktree = git(main, 'worktree', 'add', '--quiet', worktree, 'main');
  if (addWorktree.status !== 0) {
    throw new Error(`git worktree add failed: ${addWorktree.stderr}`);
  }
  return { worktree };
}

function judge(cwd, command = 'git commit -m "merge: resolve conflict"') {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      cwd,
      tool_input: { command },
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('branch-guard resolves MERGE_HEAD through the worktree indirection', () => {
  it('allows the completing commit on main from inside a worktree with a real merge in progress', () => {
    const { worktree } = repoWithMainWorktree();

    const merge = git(worktree, 'merge', '--no-commit', '--no-ff', 'feat/conflict');
    expect(merge.status).not.toBe(0); // real conflict, unresolved
    expect(git(worktree, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD').status).toBe(0);

    // The worktree's `.git` is the gitdir-pointer FILE this bug reads past.
    writeFileSync(path.join(worktree, 'file.txt'), 'resolved\n');
    git(worktree, 'add', '-A');

    const verdict = judge(worktree);
    expect(verdict.status).toBe(0);
    expect(verdict.output).not.toMatch(/Blocked: cannot git commit on protected branch/);
  });

  it('still blocks an ordinary (non-merge) commit on main from inside a worktree', () => {
    const { worktree } = repoWithMainWorktree();
    expect(git(worktree, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD').status).not.toBe(0);

    writeFileSync(path.join(worktree, 'other.txt'), 'x\n');
    git(worktree, 'add', '-A');

    const verdict = judge(worktree, 'git commit -m "chore: direct commit, no merge"');
    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/Blocked: cannot git commit on protected branch 'main'/);
  });

  it('still allows the completing commit on main from an ordinary (non-worktree) checkout', () => {
    const { main } = ordinaryRepo();

    const merge = git(main, 'merge', '--no-commit', '--no-ff', 'feat/conflict');
    expect(merge.status).not.toBe(0);
    expect(git(main, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD').status).toBe(0);

    writeFileSync(path.join(main, 'file.txt'), 'resolved\n');
    git(main, 'add', '-A');

    const verdict = judge(main);
    expect(verdict.status).toBe(0);
    expect(verdict.output).not.toMatch(/Blocked: cannot git commit on protected branch/);
  });
});
