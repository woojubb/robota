import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

/**
 * INFRA-075 (#1572) — one reading of a command, measured where it is USED.
 *
 * `hook-reading-matches-bash.test.mjs` proves `hook_verb_scan` agrees with bash. That is a claim
 * about a FUNCTION, and #1572 exists because it is not the same claim as "the guards consult it":
 * `command-scan.sh` offered a second reading — two line-oriented passes that did no quote masking at
 * all — and all three Bash guards held both strings at once, with every EXTRACTION reading the
 * weaker one. The corpus stayed green through #1565 while the decisions built on that string stayed
 * exactly as wrong.
 *
 * So this file states a PROPERTY of the verdicts rather than a list of shapes:
 *
 *     Adding text the shell will not execute cannot change what a guard decides.
 *
 * That is what "one reading" MEANS operationally, it is generative rather than a case list, and it
 * is what the old reading violated. `hook_strip_heredocs` looked for a heredoc opener with a regex
 * that did not know about quoting, so a `<<EOF` written inside a quoted string opened a body it
 * never saw close — and every command after it vanished from the string the guards examined.
 * Measured on develop, each with the bare control refused correctly:
 *
 *   worktree-cwd-guard  git -C <MAIN> reset --hard                                -> exit 2
 *                       echo "see <<EOF for details" ; git -C <MAIN> reset --hard -> exit 0
 *   pre-push-check      git -C <unreviewed> push                                  -> exit 2
 *                       echo "see <<EOF for details" ; git -C <unreviewed> push   -> exit 0
 *   branch-guard        git push origin --delete develop                          -> exit 2
 *                       echo "see <<EOF" ; git push origin --delete develop       -> exit 0
 *   branch-guard        git checkout -b BAD_NAME                                  -> exit 2
 *                       echo "see <<EOF" ; git checkout -b BAD_NAME               -> exit 0
 *
 * Hermetic in the sense #1567 established: the hooks tree is copied OUTSIDE `.claude/worktrees/`, so
 * a guard that reads its own path does not answer differently depending on where the suite is
 * checked out, and the worktree-session marker is supplied explicitly by the case that wants it.
 */

const HOOKS = hooksOutsideAWorktree();

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A `pnpm` that does nothing, ahead of the real one.
 *
 * `pre-push-check` shells out to `pnpm install … || true` on its way to the checks under
 * measurement. Installing for real in a scratch repository is not deterministic, costs seconds per
 * case, and rewrites a lockfile nobody here is asking about. Every case in this file is decided by
 * WHICH REPOSITORY the guard resolved, which the install cannot affect either way — stubbing it out
 * removes a variable rather than hiding a verdict, and no assertion below is about the lockfile.
 */
function pnpmStub() {
  const dir = makeTemp('decoy-verdict-bin-');
  scratch.push(dir);
  writeFileSync(path.join(dir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return `${dir}:${process.env.PATH}`;
}

const GUARD_PATH = pnpmStub();

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function initRepo(dir, branch) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', `--initial-branch=${branch}`);
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: root');
  return dir;
}

function runHook(hook, { command, cwd, env = {} }) {
  const result = spawnSync('bash', [path.join(HOOKS, hook)], {
    input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }),
    encoding: 'utf8',
    // A scrubbed environment: an override or a marker is present only when a case sets it.
    env: { PATH: GUARD_PATH, HOME: process.env.HOME, ...env },
    timeout: 120_000,
  });
  return result.status ?? 1;
}

/**
 * Text the shell will NOT execute, written the way a person writes it.
 *
 * Each entry is prepended to a guarded command as its own statement. The invariant is that none of
 * them may change the verdict, and the first case below proves each one is inert on its own — an
 * "invariant" over decoys that were themselves refused would hold for the wrong reason.
 */
const SQ = String.fromCharCode(39);
const DECOYS = [
  ['a quoted heredoc opener', 'echo "see <<EOF for details"'],
  ['the same in single quotes', `echo ${SQ}see <<EOF for details${SQ}`],
  ['a heredoc opener inside a commit message', 'git commit -m "note: <<EOF is a heredoc"'],
  ['a heredoc opener in a printf argument', `printf ${SQ}%s${SQ} "a <<EOF b"`],
  ['a comment naming a destructive command', 'echo hi # git -C /elsewhere reset --hard'],
  ['a quoted hash', 'echo "a # b"'],
  [
    'a closed heredoc whose body names a delete',
    `cat <<${SQ}EOF${SQ}\ngit push origin --delete develop\nEOF`,
  ],
  [
    'a closed heredoc whose body names a reset',
    `cat <<${SQ}EOF${SQ}\ngit -C /elsewhere reset --hard\nEOF`,
  ],
];

let root;
let mainRepo;
let worktreeRepo;
let sessionRepo;
let unreviewedRepo;
let branchRepo;

beforeAll(() => {
  root = makeTemp('decoy-verdict-');
  scratch.push(root);

  // worktree-cwd-guard: a MAIN checkout and an assigned worktree beside it.
  mainRepo = initRepo(path.join(root, 'mainrepo'), 'develop');
  worktreeRepo = initRepo(path.join(root, 'mainrepo/.claude/worktrees/agent-test'), 'feat/w');

  // pre-push-check: a session on develop (which the review gate exempts) and a feature branch that
  // carries a merge commit over origin/develop (which the branch-hygiene check refuses).
  sessionRepo = initRepo(path.join(root, 'session'), 'develop');
  unreviewedRepo = initRepo(path.join(root, 'unreviewed'), 'develop');
  git(unreviewedRepo, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
  git(unreviewedRepo, 'checkout', '-q', '-b', 'side');
  git(unreviewedRepo, 'commit', '-q', '--allow-empty', '-m', 'chore: side');
  git(unreviewedRepo, 'checkout', '-q', '-b', 'feat/y', 'develop');
  git(unreviewedRepo, 'merge', '-q', '--no-ff', '-m', 'chore: merge side', 'side');

  // branch-guard: a repository whose HEAD is origin/develop, so a creation from HEAD has the right
  // base and the NAME is the only thing left to judge. Checked out on a FEATURE branch, not on
  // develop: one of the decoys is an ordinary `git commit`, and a commit on a protected branch is
  // something this guard refuses on purpose — the decoy would then be inert for the wrong reason.
  branchRepo = initRepo(path.join(root, 'branchrepo'), 'develop');
  git(branchRepo, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
  git(branchRepo, 'checkout', '-q', '-b', 'feat/base');
});

/**
 * Each row is [hook, name, guarded command, cwd, extra env]. Every guarded command is refused when
 * written bare — asserted below — so "the decoy did not change the verdict" is a statement about a
 * refusal that really happens, not about a check that never fires.
 */
function cases() {
  return [
    [
      'worktree-cwd-guard.sh',
      'a destructive command aimed at the MAIN checkout',
      `git -C ${mainRepo} reset --hard`,
      worktreeRepo,
      { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    ],
    [
      'pre-push-check.sh',
      'a push aimed at a branch that carries foreign merge commits',
      `git -C ${unreviewedRepo} push`,
      sessionRepo,
      { CLAUDE_PROJECT_DIR: sessionRepo },
    ],
    [
      'branch-guard.sh',
      'a protected-branch delete',
      'git push origin --delete develop',
      branchRepo,
      { CLAUDE_PROJECT_DIR: branchRepo },
    ],
    [
      'branch-guard.sh',
      'a branch name that breaks the convention',
      'git checkout -b BAD_NAME',
      branchRepo,
      { CLAUDE_PROJECT_DIR: branchRepo, BRANCH_GUARD_ALLOW_OPEN_BRANCHES: '1' },
    ],
  ];
}

describe('text the shell will not execute cannot move a guard verdict (INFRA-075)', () => {
  it('every guarded command is refused when written bare', () => {
    // The controls. Without these the invariant below is satisfied by a guard that refuses nothing.
    for (const [hook, name, command, cwd, env] of cases()) {
      expect(runHook(hook, { command, cwd, env }), `${hook}: ${name}`).toBe(2);
    }
  });

  it('every decoy is inert on its own', () => {
    // And these. A decoy that is itself refused would make the invariant hold for the wrong reason.
    const refused = [];
    for (const [decoyName, decoy] of DECOYS) {
      for (const [hook, , , cwd, env] of cases()) {
        const status = runHook(hook, { command: decoy, cwd, env });
        if (status !== 0) refused.push(`${hook} refused ${decoyName} (exit ${status})`);
      }
    }
    expect(refused, 'a decoy that is itself refused proves nothing about the decoy').toStrictEqual(
      [],
    );
  });

  for (const [decoyName, decoy] of DECOYS) {
    it(`${decoyName} in front of a guarded command changes nothing`, () => {
      // Every hook is measured and the mismatches are reported TOGETHER. Asserting inside the loop
      // stops at the first hook that moved, so a run would name one guard while two others were
      // just as blind — and "which guards does this reach" is the whole question #1572 asks.
      const moved = [];
      for (const [hook, name, command, cwd, env] of cases()) {
        const status = runHook(hook, { command: `${decoy}\n${command}`, cwd, env });
        if (status !== 2)
          moved.push(`${hook} — ${name} — refused bare, exit ${status} with the decoy`);
      }
      expect(
        moved,
        'The guard read something other than what will run. The decoy is data by the shell ' +
          'grammar, so it cannot change a verdict — where it does, the string being examined is ' +
          'not the command being run.',
      ).toStrictEqual([]);
    });
  }
});
