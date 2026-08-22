import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  const root = makeTemp('branch-base-');
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
  const dir = makeTemp('gh-none-');
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

  it('judges the session repository, not a -C belonging to another statement', () => {
    // `PROJECT_DIR` prefers a `git -C <path>` found anywhere in the command, and in a compound
    // command that `-C` usually belongs to some other invocation. Judging the base against it made
    // `git checkout -b feat/x && git -C <other> status` refuse a legitimate creation, because
    // <other> has no develop. Measured — it broke an existing test the moment it shipped.
    const cwd = repo();
    // Deliberately a repository with no `develop` at all, which is what made the original failure
    // visible: judging <other> found nothing to compare against and refused.
    const elsewhere = makeTemp('other-repo-');
    scratch.push(elsewhere);
    execFileSync('git', ['init', '-q', '--initial-branch=main', elsewhere]);
    git(elsewhere, 'commit', '--allow-empty', '-q', '-m', 'init');

    const verdict = create(cwd, `git checkout -b feat/new && git -C ${elsewhere} status`);
    expect(verdict.status, verdict.output).toBe(0);
  });

  it('is not switched off by the branch-NAME override', () => {
    // The two checks were one block gated by `BRANCH_GUARD_ALLOW_BADNAME`, an override documented for
    // branch names — so setting it silently disabled the base check and reopened the
    // promotion-ancestry hole this item exists to close. No case combined the two, which is how the
    // coupling shipped green: the accidental-green pattern, in the very test written to prevent it.
    const cwd = repo();
    const verdict = create(cwd, 'git checkout -b my-branch main', {
      BRANCH_GUARD_ALLOW_BADNAME: '1',
    });

    expect(verdict.status, 'the name override also waved through a wrong base').toBe(2);
    expect(verdict.output).toMatch(/wanted: origin\/develop/);
  });

  it('lets the branch-NAME override do only its own job', () => {
    // The other side: the name override must still work for a name, when the base is right.
    const cwd = repo();
    const verdict = create(cwd, 'git checkout -b my-branch origin/develop', {
      BRANCH_GUARD_ALLOW_BADNAME: '1',
    });

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('reads the start point past any flags that precede it', () => {
    // `git checkout -b feat/x --track origin/main` puts a flag where the start point was being read,
    // so the check compared HEAD instead and passed while the branch came from `origin/main` — the
    // exact creation this exists to refuse, waved through by one common flag.
    const cwd = repo();

    for (const command of [
      'git checkout -b feat/new --track main',
      'git switch -c feat/new --no-track main',
    ]) {
      const verdict = create(cwd, command);
      expect(verdict.status, `a flagged start point slipped past: ${command}`).toBe(2);
      expect(verdict.output).toContain('main');
    }
  });

  it('names the base in the refusal even from a detached HEAD', () => {
    // `branch --show-current` exits 0 with empty output when detached, so the `|| echo HEAD` fallback
    // never fired and the refusal named nothing at all.
    const cwd = repo();
    git(cwd, 'checkout', '-q', '--detach', 'main');

    const verdict = create(cwd, 'git checkout -b feat/new');
    expect(verdict.status).toBe(2);
    expect(verdict.output, 'the refusal named no base').toMatch(/found:\s+\S/);
  });

  it('stops at the end of the line, not at the end of the command', () => {
    // `[^ \\t]` excludes space and tab but INCLUDES a newline, so the branch-name token ran greedily
    // across the line break and swallowed the next line's first word — `git checkout -b feat/x` on
    // one line and `git status --porcelain` on the next had `status` read as the base. Measured in
    // practice: it refused the creation of the branch this fix lives on, twice in one session.
    const cwd = repo();
    const verdict = create(cwd, 'git checkout -b feat/new\ngit status --porcelain');

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('honours the override written INLINE, the way it is documented', () => {
    // The distinction this hook spends nine lines explaining: an inline `VAR=1 git …` is set in the
    // TOOL's shell and never reaches the hook process, so an override read only as `${VAR:-0}` does
    // nothing in its documented form. This case passes it inline, as a user would. Injecting it
    // through the hook's environment — which the first version of this test did — hides exactly that.
    const cwd = repo();
    const verdict = create(cwd, 'BRANCH_GUARD_ALLOW_BASE=1 git checkout -b feat/new main');

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('does not mistake a digit-named base for a file descriptor', () => {
    // As a glob, `[0-9]*'>'*` reads "a digit, then anything, then `>`" — so `2fa-base>/tmp/out.log`
    // matched and a real ref beginning with a digit was blanked, falling back to HEAD. The same
    // fail-open the redirection arm exists to prevent, for every start point whose name starts with
    // a number. The descriptor and the operator have to be adjacent.
    const cwd = repo();
    git(cwd, 'branch', '2fa-base', 'main');

    const verdict = create(cwd, 'git checkout -b feat/new 2fa-base>/tmp/out.log');
    expect(verdict.status, 'a digit-named base was read as a descriptor and skipped').toBe(2);
    expect(verdict.output).toMatch(/found:\s+2fa-base \([0-9a-f]{9}\)/);
  });

  it('reads a base glued to the operator that follows it', () => {
    // `git checkout -b feat/x main;` is one whitespace-separated token, `main;`, and git cuts from
    // `main`. Blanking the token because it contained an operator fell back to HEAD, so a base of
    // `main` passed whenever HEAD happened to be develop — a fail-OPEN, worse than the version
    // before it, which at least failed to resolve and refused.
    const cwd = repo();

    for (const command of [
      'git checkout -b feat/new main;',
      'git checkout -b feat/new main&&true',
      'git checkout -b feat/new main|cat',
    ]) {
      const verdict = create(cwd, command);
      expect(verdict.status, `a glued base slipped past: ${command}`).toBe(2);
      // The WRONG-BASE refusal, which prints a resolved sha — not the cannot-resolve one, which
      // prints the raw token. Both exit 2 and both contain "found: main", so asserting on the
      // status and the word alone passed whether or not the token was ever truncated. That is the
      // difference this case exists to measure.
      expect(verdict.output, `truncation did not happen for: ${command}`).toMatch(
        /found:\s+main \([0-9a-f]{9}\)/,
      );
    }
  });

  it('does not read a redirection as a start point', () => {
    // `git checkout -b feat/x 2>&1 | head` had `2>&1` taken as the base, which resolved to nothing
    // and refused a perfectly ordinary creation. Measured in practice — it blocked the creation of
    // the branch this fix was written on.
    const cwd = repo();

    for (const command of [
      'git checkout -b feat/new 2>&1 | head -1',
      'git checkout -b feat/new >/dev/null',
      'git switch -c feat/new 2>/dev/null',
      // The input side, with and without a descriptor number. Covering only `>` left `3<file`
      // falling through to truncation, which kept the bare fd `3` and refused the creation.
      'git checkout -b feat/new 3<file',
      'git checkout -b feat/new <in',
    ]) {
      const verdict = create(cwd, command);
      expect(verdict.status, `a redirection was read as a base: ${command}`).toBe(0);
    }
  });

  it('refuses the same creation without the override', () => {
    // The other half, so the case above cannot pass because the check stopped working.
    const cwd = repo();
    expect(create(cwd, 'git checkout -b feat/new main').status).toBe(2);
  });
});
