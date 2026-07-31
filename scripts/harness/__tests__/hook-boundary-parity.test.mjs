import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Two guards reading the same command must reach the same reading of it.
 *
 * These are not style findings. Both cases below were measured on `develop`, and each is a live
 * bypass of a gate that is otherwise working:
 *
 * - `branch-guard` ends a git verb at any non-word character; `pre-push-check`'s interception gate
 *   required whitespace or end-of-line. So `git push; …` was a push to one and not a push to the
 *   other — and since that gate is the whole file's entry point, the branch-hygiene check, the
 *   lockfile-sync check and the local-review record were all skipped for that shape. No fixture in
 *   the repository ended a command at `push`, which is why it survived.
 * - `worktree-cwd-guard` read its override token off the RAW command rather than the masked one, so
 *   a commit message that merely NAMED the override switched the guard off. `branch-guard` documents
 *   this exact attack and fixed it; the sibling hook never received the fix.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'boundary-'));
  scratch.push(dir);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

function run(hook, command, dir, env = {}) {
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    timeout: 120_000,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('a push is a push to every guard that reads the command', () => {
  // The separator follows the verb. Every existing fixture writes `git push origin …`, so the
  // boundary after `push` itself had never been exercised.
  const SHAPES = ['git push;', 'git push; echo ok', 'git push|cat', '(git push)', 'git push&'];

  for (const command of SHAPES) {
    it(`pre-push-check sees a push in \`${command}\``, () => {
      const dir = scratchRepo('feat/probe');
      const verdict = run('pre-push-check.sh', command, dir);

      expect(
        verdict.status,
        'the push gate never engaged, so branch hygiene, lockfile sync and the review record were ' +
          `all skipped for this shape: ${verdict.output}`,
      ).toBe(2);
      expect(verdict.output).toMatch(/no local review recorded/);
    });
  }

  it('still says nothing about a command that is not a push', () => {
    // The other half: widening a boundary is how a guard starts firing on correct work.
    const dir = scratchRepo('feat/probe');
    const verdict = run('pre-push-check.sh', 'git pushd-something; echo ok', dir);

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });
});

describe('an override must be given, not merely mentioned', () => {
  function worktreeRun(command) {
    const dir = scratchRepo('feat/probe');
    return run('worktree-cwd-guard.sh', command, dir, {
      ROBOTA_AGENT_WORKTREE: '/repo/.claude/worktrees/agent-x',
    });
  }

  it('refuses a destructive command whose message only NAMES the override', () => {
    // Measured on develop: allowed. The token was read off the raw command, so any quoted mention
    // disarmed the guard — the attack `branch-guard` documents at its own override, never ported.
    const verdict = worktreeRun(
      'git commit -m "note: WORKTREE_CWD_GUARD_ALLOW_MAIN=1 was tried" && git reset --hard',
    );

    expect(
      verdict.status,
      'a quoted mention of the override switched the guard off for a reset --hard on the main clone',
    ).toBe(2);
  });

  it('still honours the override when it is actually given', () => {
    const verdict = worktreeRun('WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop');

    expect(verdict.status, verdict.output).toBe(0);
  });
});
