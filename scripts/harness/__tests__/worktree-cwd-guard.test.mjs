import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The hook under test — a PreToolUse Bash guard that blocks destructive git commands when a
// worktree-assigned subagent's cwd has silently fallen back to the MAIN checkout (HARNESS-043).
import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

// Not the checkout's own copy: this hook reads its OWN directory to decide whether the session is
// a worktree one, so spawning it from wherever the suite happens to run makes that input
// uncontrolled and the main-clone fixtures below unreachable. See the helper.
const HOOK = path.join(hooksOutsideAWorktree(), 'worktree-cwd-guard.sh');

/** git init a repo at `dir` (created if needed) with an initial commit so rev-parse resolves. */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      stdio: 'pipe',
    });
  git('init', '-q');
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-q', '-m', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
    stdio: 'pipe',
  });
  return dir;
}

/** Run the hook with a synthesized PreToolUse payload; returns { status, stderr }. */
function runHook({ command, cwd, env = {} }) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd,
  });
  const res = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    // Start from a scrubbed env so the marker is only present when a case sets it.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { status: res.status, stderr: res.stderr ?? '' };
}

let root;
let mainRepo;
let worktreeRepo;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wt-cwd-guard-'));
  // MAIN checkout — its toplevel path does NOT contain `.claude/worktrees/`.
  mainRepo = initRepo(path.join(root, 'mainrepo'));
  // Assigned worktree — its toplevel path DOES contain `.claude/worktrees/`.
  worktreeRepo = initRepo(path.join(root, 'mainrepo', '.claude', 'worktrees', 'agent-test'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('worktree-cwd-guard hook', () => {
  it('BLOCKS git reset --hard when cwd fell back to MAIN and a worktree marker is set', () => {
    const { status, stderr } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
    expect(stderr).toMatch(/worktree-cwd-guard/);
  });

  it('BLOCKS git clean -fdx in the same fallback context', () => {
    const { status } = runHook({
      command: 'git clean -fdx',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git checkout -- . in the same fallback context', () => {
    const { status } = runHook({
      command: 'git checkout -- .',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git push --force in the same fallback context', () => {
    const { status } = runHook({
      command: 'git push --force origin main',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('ALLOWS the same destructive command inside the assigned worktree', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: worktreeRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ALLOWS a destructive command with the inline override token', () => {
    const { status } = runHook({
      command: 'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('does not affect non-destructive git in the fallback context', () => {
    const { status } = runHook({
      command: 'git status --short',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: normal main-repo destructive work with NO worktree marker is unaffected', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: {},
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: does not block when the effective dir cannot be resolved as a git repo', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: path.join(root, 'not-a-repo'),
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ignores non-Bash tool calls', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: mainRepo });
    const res = spawnSync('bash', [HOOK], { input: payload, encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});

describe('worktree-cwd-guard: the two accidents that leave no trace', () => {
  // Both of these were recurring, and both were silent at the moment they happened. Written here
  // rather than in a new file because they are the same guard's subject — a second file would fork
  // the vocabulary of "what a worktree hazard is", which this repo has already paid for once.

  it('BLOCKS a git command whose ambient GIT_DIR names a DIFFERENT repository', () => {
    // Git hooks export GIT_DIR, and it outranks the working directory. A process that inherited one
    // wrote to the repository it was invoked FROM rather than the one it stood in — which overwrote
    // a shared branch with fixture commits. Every command involved looked local.
    //
    // The fixture points at a REAL other repository, because a GIT_DIR naming nothing is not this
    // incident: git fails loudly on its own there, and a case built on it would have passed for a
    // reason that has nothing to do with the check.
    const elsewhere = initRepo(path.join(root, 'another-clone'));

    const { status, stderr } = runHook({
      command: 'git commit -m "ordinary work"',
      cwd: mainRepo,
      env: { GIT_DIR: path.join(elsewhere, '.git') },
    });

    expect(status).toBe(2);
    expect(stderr).toMatch(/DIFFERENT repository/);
  });

  it('PERMITS a GIT_DIR naming the SAME repository', () => {
    // The variable being present is ordinary — git sets it whenever it runs a hook — and this guard
    // is built for that: it asks its own questions through a scrubbed environment. Refusing on
    // presence alone fires on the normal case, which is what gets a guard turned off.
    const { status } = runHook({
      command: 'git commit -m "ordinary work"',
      cwd: mainRepo,
      env: { GIT_DIR: path.join(mainRepo, '.git') },
    });

    expect(status).toBe(0);
  });

  it('leaves an ordinary git command alone when the environment is clean', () => {
    // Without this the case above would pass against a guard that blocked every git command, which
    // is not a guard — it is an outage.
    const { status } = runHook({ command: 'git commit -m "ordinary work"', cwd: mainRepo });

    expect(status).toBe(0);
  });

  it('BLOCKS a compound command whose checkout targets a branch another worktree holds', () => {
    // A checkout git refuses is harmless alone. In a compound command it is not: the statements
    // AFTER it still run, against whatever branch is actually checked out. A `reset --hard` meant
    // for one branch landed on another exactly this way.
    const held = 'held-by-a-sibling';
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    const sibling = path.join(root, 'sibling-worktree');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });

    try {
      const { status, stderr } = runHook({
        command: `git checkout ${held}; git reset --hard origin/develop`,
        cwd: mainRepo,
      });

      expect(status).toBe(2);
      expect(stderr).toMatch(/checked out in another worktree/);
    } finally {
      execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
        stdio: 'pipe',
      });
    }
  });

  it('leaves a BARE checkout of that branch alone', () => {
    // git's own refusal is the whole outcome when nothing follows it. Blocking here would be the
    // guard firing on correct work, which is what gets a guard turned off.
    const held = 'held-by-a-sibling-2';
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    const sibling = path.join(root, 'sibling-worktree-2');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });

    try {
      const { status } = runHook({ command: `git checkout ${held}`, cwd: mainRepo });

      expect(status).toBe(0);
    } finally {
      execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
        stdio: 'pipe',
      });
    }
  });
});

describe('worktree-cwd-guard: what review found the first version missing', () => {
  const held = 'held-for-review-cases';
  let sibling;

  beforeAll(() => {
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    sibling = path.join(root, 'sibling-review');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
      stdio: 'pipe',
    });
  });

  it('BLOCKS a compound command joined by a NEWLINE', () => {
    // This file already says, twenty lines above the check, that a newline is a separator too — and
    // the check re-derived the reading anyway and came out worse. A destructive command on a later
    // LINE is the shape the guard exists for.
    const { status } = runHook({
      command: `git checkout ${held}\ngit reset --hard origin/develop`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('BLOCKS a checkout reached through `git -C`', () => {
    // `-C` pointing at another repository is not an edge case: it is how one worktree reaches into
    // another. Both other matchers in this file tolerate it explicitly; this one did not.
    const { status } = runHook({
      command: `git -C ${mainRepo} checkout ${held}; git status`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('reads its variable list from the file that owns it', () => {
    // Three copies of the ambient-variable list existed and had already drifted — seven names in the
    // hook, nine in the gate. The list now lives in one file, and this asserts the hook reads THAT
    // file rather than a fourth copy: every name the owning file declares must appear in the hook's
    // behaviour, which is what the ambient case above exercises for GIT_DIR.
    const owned = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../git-ambient-env.json'), 'utf8'),
    ).variables;
    const hookText = readFileSync(HOOK, 'utf8');

    expect(owned.length).toBeGreaterThan(0);
    // The hook must NOT spell the names out — that is how the copies drifted.
    const spelledOut = owned.filter((name) =>
      new RegExp(`for _var in[^\\n]*${name}`).test(hookText),
    );
    expect(
      spelledOut,
      'the hook re-spells the list instead of reading the file that owns it',
    ).toEqual([]);
    expect(hookText).toMatch(/git-ambient-env\.json/);
  });
});
