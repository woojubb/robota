import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/branch-guard.sh');

/**
 * What a new branch is cut FROM (INFRA-067).
 *
 * `git-branch.md` is mandatory about it — feature branches come from a freshly-fetched
 * `origin/develop`, never from `main`, never from another feature branch — and nothing checked it at
 * creation time. Two audits measured `grep -c origin/develop` over `branch-guard.sh` at 0: the guard
 * read the branch NAME and the unmerged-branch list, and never the base.
 *
 * It cost a promotion. A branch cut from a promotion branch dragged main's merge commits into the PR
 * range and broke the promotion-ancestry check. Branch creation is also the one guarded action with
 * no git-native backstop: husky covers commits on protected branches, rulesets cover pushes to main,
 * nothing covers `checkout -b`.
 *
 * The rule and its guard must agree, so the command the rule itself prescribes is a case here too —
 * a guard that refuses the documented invocation is the defect that produced this item.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

/**
 * A checkout with `develop`, `main`, a promotion branch and a feature branch, each at a DIFFERENT
 * commit — so "cut from the wrong base" is a real difference and not an artefact of equal shas.
 *
 * `origin/develop` is a real remote-tracking ref, created by cloning, because that is what the guard
 * compares against and a fake ref would prove nothing about the deployment.
 */
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'branch-base-'));
  scratch.push(root);
  const origin = path.join(root, 'origin');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=develop', origin]);

  const seed = path.join(root, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed]);
  writeFileSync(path.join(seed, 'a'), 'a\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'chore: root');
  git(seed, 'push', '-q', 'origin', 'develop');

  // main, a promotion branch, and a feature branch, each one commit further on.
  for (const [branch, file] of [
    ['main', 'm'],
    ['release/promote-develop-to-main', 'p'],
    ['feat/other', 'f'],
  ]) {
    git(seed, 'checkout', '-q', '-b', branch, 'develop');
    writeFileSync(path.join(seed, file), `${file}\n`);
    git(seed, 'add', '-A');
    git(seed, 'commit', '-q', '-m', `chore: ${branch}`);
  }
  git(seed, 'checkout', '-q', 'develop');

  const clone = path.join(root, 'work');
  execFileSync('git', ['clone', '-q', origin, clone]);
  // Bring the other branches over so a start point can name them locally.
  for (const branch of ['main', 'release/promote-develop-to-main', 'feat/other']) {
    git(clone, 'fetch', '-q', seed, `${branch}:${branch}`);
  }
  return clone;
}

/** A `gh` that reports no merged PRs, so the unmerged-branch check cannot mask the base check. */
function ghStub() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gh-none-'));
  scratch.push(dir);
  const gh = path.join(dir, 'gh');
  writeFileSync(gh, '#!/bin/sh\nexit 0\n');
  chmodSync(gh, 0o755);
  return `${dir}:${process.env.PATH}`;
}

function create(cwd, command, env = {}) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: ghStub(),
      CLAUDE_PROJECT_DIR: cwd,
      // The unmerged-branch check is a separate rule; silence it so these cases measure the base.
      BRANCH_GUARD_ALLOW_OPEN_BRANCHES: '1',
      ...env,
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('a feature branch is cut from origin/develop', () => {
  it('refuses each wrong base, naming what it found and what it wanted', () => {
    const cwd = repo();

    for (const base of ['main', 'release/promote-develop-to-main', 'feat/other']) {
      const verdict = create(cwd, `git checkout -b feat/new ${base}`);

      expect(verdict.status, `cutting from ${base} was allowed`).toBe(2);
      expect(verdict.output, `the refusal did not name the base it found (${base})`).toContain(
        base,
      );
      expect(verdict.output, 'the refusal did not name the base it wanted').toMatch(
        /wanted: origin\/develop/,
      );
    }
  });

  it('refuses a branch cut from a wrong base implicitly, by standing on it', () => {
    // No start point in the command: the base is wherever HEAD is. That is how the promotion-ancestry
    // break actually happened — nobody named `main`, they were simply standing on a promotion branch.
    const cwd = repo();
    git(cwd, 'checkout', '-q', 'main');

    const verdict = create(cwd, 'git checkout -b feat/new');
    expect(verdict.status, 'a branch cut from the current wrong base was allowed').toBe(2);
    expect(verdict.output).toContain('main');
  });

  it('passes the command the rule itself prescribes', () => {
    // `git-branch.md:155`. A guard that refuses the documented invocation is the defect that made
    // this item, so the rule and the guard are checked against each other here.
    const cwd = repo();
    const verdict = create(cwd, 'git fetch origin && git checkout -b feat/new origin/develop');

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('passes when standing on an up-to-date develop', () => {
    const cwd = repo();
    const verdict = create(cwd, 'git checkout -b feat/new');

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('leaves hotfix and release branches to their own rule', () => {
    // `git-branch.md` lets these PR to `main` and does not prescribe develop as their base, so the
    // base requirement is not theirs to satisfy.
    const cwd = repo();
    git(cwd, 'checkout', '-q', 'main');

    for (const branch of ['hotfix/urgent', 'release/1.2.0']) {
      expect(create(cwd, `git checkout -b ${branch}`).status, branch).toBe(0);
    }
  });

  it('honours the override and says it was used', () => {
    const cwd = repo();
    const verdict = create(cwd, 'git checkout -b feat/new main', {
      BRANCH_GUARD_ALLOW_BASE: '1',
    });

    expect(verdict.status, verdict.output).toBe(0);
  });
});
