/**
 * #1662 — the push is judged against the repository it will actually act on.
 *
 * `cd <worktree> && git push` was judged against the DECLARED tool cwd — the main clone — because
 * the `cd` runs after the hook reads the payload and there is no `git -C`. Measured: five worktree
 * pushes, each with a fresh 0-finding review recorded in its own worktree, all refused against a
 * stale record for a sixth, already-merged branch the main checkout was parked on. The mirror
 * direction is the one the hook exists for: a current record on the parked branch would wave an
 * UNREVIEWED worktree push through.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** A repo whose review-record state the case controls: recorded = run the real recorder in it. */
function repoOn(branch, { recorded = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-push-repo-'));
  scratch.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, dir]);
  git('config', 'user.email', 'h@e.test');
  git('config', 'user.name', 'H');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
  if (recorded) {
    execFileSync(
      'node',
      [path.join(WORKSPACE_ROOT, 'scripts/harness/record-local-review.mjs'), '--findings', '0'],
      { cwd: dir, encoding: 'utf8' },
    );
  }
  return dir;
}

function runHook(command, declaredCwd) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd: declaredCwd, tool_input: { command } });
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: declaredCwd },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('which repository the push verdict is about', () => {
  it('judges `cd <worktree> && git push` against the WORKTREE, not the declared cwd', () => {
    // The false-refusal half of #1662: the pushed repo has a fresh 0-finding record, the declared
    // cwd (standing in for the parked main clone) has NONE — so a verdict about the wrong repo is
    // a refusal, and a verdict about the right one is a pass.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`cd ${pushed} && git push origin feat/target`, parked);

    expect(status, `judged the parked repo, not the pushed one:\n${output}`).toBe(0);
  });

  it('judges the FALSE-PASS mirror: a recorded parked branch must not excuse an unreviewed push', () => {
    // The direction the hook exists for. Declared cwd has a CURRENT record; the pushed worktree has
    // none. The old resolution read the parked record and waved the push through.
    const pushed = repoOn('feat/unreviewed');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status } = runHook(`cd ${pushed} && git push origin feat/unreviewed`, parked);

    expect(status, "the parked repo's record excused an unreviewed push").toBe(2);
  });

  it('still follows a per-statement `git -C`', () => {
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status } = runHook(`git -C ${pushed} push origin feat/target`, parked);

    expect(status).toBe(0);
  });

  it('REFUSES when the cd target cannot be read', () => {
    // `cd "$DIR" && git push` — the target is a variable the hook cannot resolve. Judging the
    // declared cwd anyway is the wrong-repository answer; the hook says why and names the fix.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('cd "$SOMEWHERE" && git push origin x', parked);

    expect(status, 'an unreadable cd was judged against the declared cwd').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('REFUSES one command pushing from two repositories', () => {
    const a = repoOn('feat/a', { recorded: true });
    const b = repoOn('feat/b', { recorded: true });

    const { status, output } = runHook(
      `git -C ${a} push origin feat/a; git -C ${b} push origin feat/b`,
      a,
    );

    expect(status, 'two-repo push got one verdict').toBe(2);
    expect(output).toMatch(/two different repositories/);
  });

  it('keeps the plain in-session push working', () => {
    const repo = repoOn('feat/plain', { recorded: true });

    const { status, output } = runHook('git push origin feat/plain', repo);

    expect(status, `the ordinary case broke:\n${output}`).toBe(0);
  });
});
