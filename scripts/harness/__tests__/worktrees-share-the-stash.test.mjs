import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LOCK_WRAPPER = path.join(WORKSPACE_ROOT, 'scripts/harness/with-repo-lock.sh');
const PRE_COMMIT = path.join(WORKSPACE_ROOT, '.husky/pre-commit');

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'repo-lock-'));
  scratch.push(dir);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  return dir;
}

/**
 * Two concurrent runs, each reporting when IT entered and left its critical section.
 *
 * The timestamps come from the CHILD, not from `spawn`/`close` in this process. A first version
 * measured spawn-to-close and failed against a lock that demonstrably worked: the second process is
 * spawned immediately either way and simply waits, so its spawn time precedes the first one's exit
 * whether or not anything is serialised. That is an observable both states share — the accidental-
 * green shape this repository has a floor for — and it was measuring the scheduler, not the lock.
 *
 * The property asserted is that the two sections do not OVERLAP. Ordering would be a coin flip;
 * non-overlap is what the lock actually promises.
 */
function criticalSections(cwd, wrapped) {
  const command = 'echo IN $(date +%s%3N); sleep 0.2; echo OUT $(date +%s%3N)';
  return Promise.all(
    [0, 1].map(
      () =>
        new Promise((resolve) => {
          const argv = wrapped ? [LOCK_WRAPPER, 'bash', '-c', command] : ['-c', command];
          const child = spawn('bash', argv, { cwd, encoding: 'utf8' });
          let out = '';
          child.stdout.on('data', (d) => (out += d));
          child.stderr.on('data', (d) => (out += d));
          child.on('close', (code) => {
            const enter = Number(/IN (\d+)/.exec(out)?.[1] ?? NaN);
            const leave = Number(/OUT (\d+)/.exec(out)?.[1] ?? NaN);
            resolve({ code, out, enter, leave });
          });
        }),
    ),
  );
}

function overlaps(runs) {
  const [a, b] = runs.sort((x, y) => x.enter - y.enter);
  return { overlapped: b.enter < a.leave, a, b };
}

describe('a worktree does not share its neighbour lint-staged backup', () => {
  it('serialises the critical section across concurrent runs', async () => {
    const dir = scratchRepo();
    const runs = await criticalSections(dir, true);
    for (const run of runs) {
      expect(run.code, `a run failed: ${run.out}`).toBe(0);
      expect(
        Number.isFinite(run.enter) && Number.isFinite(run.leave),
        `no timestamps: ${run.out}`,
      ).toBe(true);
    }
    const { overlapped, a, b } = overlaps(runs);
    expect(
      overlapped,
      `the two sections overlapped: ${a.enter}-${a.leave} and ${b.enter}-${b.leave}`,
    ).toBe(false);
  });

  it('proves the case above is not vacuous — unwrapped, they DO overlap', async () => {
    // Without this, "they did not overlap" would also pass on a machine that happened to run them
    // one after another, and the locked case would prove nothing.
    const dir = scratchRepo();
    const runs = await criticalSections(dir, false);
    const { overlapped, a, b } = overlaps(runs);
    expect(
      overlapped,
      `the unwrapped pair did not overlap (${a.enter}-${a.leave}, ${b.enter}-${b.leave}), so the locked case proves nothing`,
    ).toBe(true);
  });

  it('refuses when it cannot find the repository, rather than running unserialised', () => {
    // Fail closed. Running without the lock here is the exact hazard, so "cannot tell" is a refusal.
    const outside = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
    scratch.push(outside);
    const result = spawnSync('bash', [LOCK_WRAPPER, 'true'], {
      cwd: outside,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(outside) },
    });
    expect(result.status, `it ran anyway: ${result.stdout}${result.stderr}`).not.toBe(0);
  });

  it('refuses an empty command rather than reporting success over nothing', () => {
    const dir = scratchRepo();
    const result = spawnSync('bash', [LOCK_WRAPPER], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(2);
  });

  it('the pre-commit hook actually goes through it', () => {
    // Registered is not reached. A lock nothing calls is a file, and lint-staged is the one caller
    // that matters — it is the shared-stash user every commit passes through, whether or not the
    // author ever types `git stash`.
    // Backslash continuations are joined FIRST. A line-by-line reading called the wired-up hook
    // unwired, because the invocation spans three lines — the check would have forced the shell to
    // be written a particular way rather than to do the right thing, and a guard that polices
    // formatting is one people route around.
    const statements = readFileSync(PRE_COMMIT, 'utf8')
      .replace(/\\\r?\n\s*/g, ' ')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'));
    const lintStaged = statements.filter((line) => line.includes('lint-staged'));

    expect(lintStaged, 'the hook no longer runs lint-staged at all').not.toHaveLength(0);
    for (const line of lintStaged) {
      expect(line.trim(), `lint-staged runs without the cross-worktree lock: ${line}`).toContain(
        'with-repo-lock.sh',
      );
    }
  });
});

describe('a bare stash command is refused while the stack is shared', () => {
  // The other half of INFRA-082. The lock covers the caller nobody chooses — lint-staged, on every
  // commit. This covers the one an agent types, which is what the rule in git-branch.md has asked
  // for since LESSON-005 (2026-06-15) and which an agent did anyway ten weeks later, because the
  // rule was written down and never mechanically reached.
  const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/worktree-cwd-guard.sh');

  function repoWithWorktrees(count) {
    const dir = scratchRepo();
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    spawnSync('bash', ['-c', 'printf x > f'], { cwd: dir });
    git('add', '-A');
    git('commit', '--quiet', '-m', 'root');
    for (let i = 1; i < count; i += 1) {
      git('worktree', 'add', '--detach', '--quiet', path.join(dir, `wt-${i}`), 'HEAD');
    }
    return dir;
  }

  function run(command, dir) {
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: dir },
      timeout: 120_000,
    });
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('refuses a bare pop or apply when a sibling worktree exists', () => {
    const dir = repoWithWorktrees(2);
    for (const command of ['git stash pop', 'git stash apply', 'git stash']) {
      expect(
        run(command, dir).status,
        `a bare stash command was allowed while another worktree exists: ${command}`,
      ).not.toBe(0);
    }
  });

  it('allows the explicit form, and read-only queries, silently', () => {
    // A guard that refuses the correct form is one people switch off. The rule names
    // `git stash pop stash@{N}` as the right way, so that must keep working.
    const dir = repoWithWorktrees(2);
    for (const command of [
      'git stash pop stash@{0}',
      'git stash apply stash@{2}',
      'git stash list',
      'git stash show -p stash@{0}',
    ]) {
      const { status, output } = run(command, dir);
      expect(status, `the documented form was refused: ${command} -> ${output}`).toBe(0);
      expect(output, `the guard narrated on the happy path: ${command} -> ${output}`).toBe('');
    }
  });

  it('leaves a single-worktree clone alone', () => {
    // The hazard is a SHARED stack. With one worktree there is nothing to race, and refusing there
    // would be the guard firing on correct work.
    const dir = repoWithWorktrees(1);
    const { status, output } = run('git stash pop', dir);
    expect(status, `a bare pop was refused in a clone with one worktree: ${output}`).toBe(0);
  });
});
