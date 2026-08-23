import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

// See the helper: worktree-cwd-guard reads its own directory to decide the session's identity.
const HOOKS_DIR = hooksOutsideAWorktree();

/**
 * The worktree guard, exercised the way a real session would reach it.
 *
 * `worktree-cwd-guard.sh` gated everything behind `ROBOTA_AGENT_WORKTREE`, a marker the launcher
 * was expected to export. Measured 2026-07-30: the only places setting it in this repository were
 * the guard's own tests. So in every real session the variable was empty, the hook exited on its
 * first branch, and the ten tests beside it were green about a guard that had never run — the
 * condition INFRA-068 was filed for, and the exact "green in tests, off in life" shape this
 * repository keeps finding.
 *
 * The cases below supply no marker. What they supply is what the deployment supplies: a real linked
 * worktree, `CLAUDE_PROJECT_DIR` pointing at it, and the copy of the hook that lives inside it.
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
  });
}

/**
 * A main checkout with a REAL linked worktree under `.claude/worktrees/`, carrying its own copy of
 * the hook — which is what `.claude/settings.json` invokes through `CLAUDE_PROJECT_DIR`.
 */
function repoWithWorktree() {
  const root = makeTemp('wt-alive-');
  scratch.push(root);
  const main = path.join(root, 'mainrepo');
  mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '--initial-branch=develop');
  git(main, 'commit', '--allow-empty', '-q', '-m', 'init');

  const worktree = path.join(main, '.claude', 'worktrees', 'agent-test');
  git(main, 'worktree', 'add', '-q', '-b', 'feat/assigned', worktree);

  // The worktree's own copy of the hook and the library it sources.
  const hooks = path.join(worktree, '.claude', 'hooks');
  mkdirSync(path.join(hooks, 'lib'), { recursive: true });
  copyFileSync(
    path.join(HOOKS_DIR, 'worktree-cwd-guard.sh'),
    path.join(hooks, 'worktree-cwd-guard.sh'),
  );
  // EVERY library, enumerated rather than named. Listing `command-scan.sh` by hand meant that the
  // moment the hook sourced a second library (INFRA-077's `hook-facts.sh`) this fixture built a
  // worktree whose hook could not start, and the three cases below failed on a missing file rather
  // than on anything they assert. The fixture's job is "the hook and the library it sources", so it
  // reads the library directory instead of restating its contents.
  for (const lib of readdirSync(path.join(HOOKS_DIR, 'lib')).filter((n) => n.endsWith('.sh'))) {
    copyFileSync(path.join(HOOKS_DIR, 'lib', lib), path.join(hooks, 'lib', lib));
  }
  // The same lesson one file over: the guard also reads the ambient-variable list it OWNS, resolved
  // relative to its own location. A worktree without it is a hook whose subject list is unreadable —
  // it then refuses, correctly, and every case below fails for a reason it does not assert.
  mkdirSync(path.join(worktree, 'scripts', 'harness'), { recursive: true });
  copyFileSync(
    path.join(HOOKS_DIR, '..', 'scripts', 'harness', 'git-ambient-env.json'),
    path.join(worktree, 'scripts', 'harness', 'git-ambient-env.json'),
  );

  return { main, worktree, hook: path.join(hooks, 'worktree-cwd-guard.sh') };
}

/**
 * Run a hook with an environment scrubbed of the marker, so a case can only pass on signals the
 * deployment actually provides.
 */
function runHook(hook, { command, cwd, projectDir }) {
  const result = spawnSync('bash', [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(projectDir ? { CLAUDE_PROJECT_DIR: projectDir } : {}),
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the worktree guard is active without anything exporting a marker', () => {
  it('blocks a destructive command aimed at the main checkout', () => {
    // The scenario it exists for: a worktree-assigned session whose cwd has fallen back to the main
    // checkout. The cwd cannot report that, since falling back is the condition — the copy of the
    // hook that is running does.
    const { main, worktree, hook } = repoWithWorktree();

    const verdict = runHook(hook, {
      command: 'git reset --hard origin/main',
      cwd: main,
      projectDir: worktree,
    });

    expect(
      verdict.status,
      'the guard stayed off with no marker exported, which is its state in every real session',
    ).toBe(2);
    expect(verdict.output).toMatch(/MAIN checkout/);
  });

  it('leaves the same command alone inside the assigned worktree', () => {
    // Destructive work on the worktree it was given is the work; only the main checkout is out of
    // bounds. A guard that blocked both would be turned off within a day.
    const { worktree, hook } = repoWithWorktree();

    const verdict = runHook(hook, {
      command: 'git reset --hard HEAD~1',
      cwd: worktree,
      projectDir: worktree,
    });

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('leaves an ordinary main-clone session alone', () => {
    // The other half of the fail-safe: outside a worktree session the guard must not fire at all,
    // or ordinary destructive work in the main clone becomes impossible.
    const { main } = repoWithWorktree();

    const verdict = runHook(path.join(HOOKS_DIR, 'worktree-cwd-guard.sh'), {
      command: 'git reset --hard origin/main',
      cwd: main,
      projectDir: main,
    });

    expect(verdict.status, 'the guard fired outside a worktree session').toBe(0);
  });
});

describe('an ambient GIT_DIR is seen even INSIDE a correct worktree', () => {
  // Review found this, and it was a real bypass measured before and after. The ambient-repository
  // check used to defer to the main-checkout judgement whenever the session was worktree-assigned
  // and the command destructive — but that judgement resolves its directory through the SCRUB, so it
  // can never see that a `GIT_DIR` would redirect the command. It answers a different question.
  //
  // From inside a correctly assigned worktree, this was permitted:
  //
  //   GIT_DIR=/somewhere/else/.git git reset --hard
  //
  // which is the exact accident this guard exists for, in the one place it was trusted to be safe.
  it('refuses a destructive command redirected at another repository', () => {
    const { worktree, hook } = repoWithWorktree();
    const elsewhere = makeTemp('elsewhere-');
    scratch.push(elsewhere);
    git(elsewhere, 'init', '-q');
    git(elsewhere, 'commit', '--allow-empty', '-q', '-m', 'init');

    const result = spawnSync('bash', [hook], {
      input: JSON.stringify({
        tool_name: 'Bash',
        cwd: worktree,
        tool_input: { command: 'git reset --hard' },
      }),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CLAUDE_PROJECT_DIR: worktree,
        ROBOTA_AGENT_WORKTREE: worktree,
        GIT_DIR: path.join(elsewhere, '.git'),
      },
    });

    expect(result.status).toBe(2);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/DIFFERENT repository/);
  });
});
