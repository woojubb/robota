import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * What a guard EXAMINES must be what will RUN.
 *
 * Reachability — does the hook fire at all — is the sibling question, pinned next door. This file
 * asks the one after it: once fired, is the hook looking at the command? Three ways it was not,
 * each measured on 2026-07-28 against the hooks as they then stood:
 *
 *   1. Every hook decoded the payload with `grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"'`,
 *      which stops at the first double quote INSIDE the command. `echo "go" && git push origin
 *      main` was read as `echo `, so branch-guard let a push to a protected branch through. Four
 *      hooks carried the same copy.
 *   2. `worktree-cwd-guard` scanned `${COMMAND%%<<*}` — everything from the first heredoc opener
 *      onward discarded — so `git reset --hard` written after a CLOSED heredoc was invisible.
 *   3. The opposite error is equally real: reading a heredoc BODY treats prose as a command, and a
 *      commit message describing `git checkout -b` self-blocked a whole session.
 *
 * A guard reading a truncated command is not a weaker guard; it is a guard judging something other
 * than what will run, which `enforcement-architecture.md` names as the defect to prevent. The
 * shapes below are the contract for `lib/command-scan.sh` and for every hook that uses it.
 */

/** Scratch repos created during the run, removed in `afterAll` so probes leave no litter. */
const scratchRoots = [];

afterAll(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway repository for the hook to judge, on a named branch.
 *
 * Never the real working tree: these probes make guards run their real work against whatever
 * `CLAUDE_PROJECT_DIR` points at, and the verdict would then depend on a developer's local state.
 */
function scratchRepo(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-parse-'));
  scratchRoots.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

/**
 * `spawnSync`, not `execFileSync`: hooks speak on stderr, and `execFileSync`'s success path returns
 * stdout only — a hook that spoke and exited 0 would read as silence, which once produced a
 * reported bypass that was not there.
 */
function runHook(hookFile, command, { cwd, env = {} } = {}) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hookFile)], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('a hook examines the command that will run', () => {
  it('sees a guarded verb that follows a quoted argument', () => {
    // The HARNESS-061 shape. Measured against the pre-fix hook: exit 0, silent — a push to a
    // protected branch waved through because the decoder stopped at `echo "`.
    const cwd = scratchRepo('main');
    const result = runHook('branch-guard.sh', 'echo "starting release" && git push origin main', {
      cwd,
    });

    expect(
      result.status,
      'branch-guard let a push to `main` through because the command was truncated at the first ' +
        'quote. Decode the payload as JSON; do not read it with grep.',
    ).toBe(2);
    expect(result.output).toMatch(/protected branch/);
  });

  it('sees a destructive command written after a closed heredoc', () => {
    // The `%%<<*` shape: truncating at the first opener threw away the rest of the command.
    const cwd = scratchRepo('main');
    const command = [
      'git commit -F- <<EOF',
      'a message',
      'EOF',
      'git reset --hard origin/main',
    ].join('\n');
    const result = runHook('worktree-cwd-guard.sh', command, {
      cwd,
      env: { ROBOTA_AGENT_WORKTREE: '1' },
    });

    expect(
      result.status,
      'worktree-cwd-guard did not see a `git reset --hard` that follows a closed heredoc. ' +
        'Strip heredoc BODIES; keep what comes after the terminator.',
    ).toBe(2);
  });

  it('does not read a heredoc body as a command', () => {
    // The opposite error, and the one that cost a session: prose describing a command is not the
    // command. A guard that cannot tell them apart blocks its own author.
    const cwd = scratchRepo('main');
    const cases = [
      {
        hook: 'branch-guard.sh',
        env: {},
        command: ['git log --oneline <<EOF', 'then run git push origin main', 'EOF'].join('\n'),
      },
      {
        hook: 'worktree-cwd-guard.sh',
        env: { ROBOTA_AGENT_WORKTREE: '1' },
        command: ['git commit -F- <<EOF', 'we ran git reset --hard once', 'EOF'].join('\n'),
      },
    ];

    for (const { hook, command, env } of cases) {
      const result = runHook(hook, command, { cwd, env });
      expect(result.status, `${hook} read a heredoc body as a command`).toBe(0);
      expect(result.output.trim(), `${hook} spoke about text inside a heredoc`).toBe('');
    }
  });

  it('leaves ordinary work alone', () => {
    const cwd = scratchRepo('feat/probe');
    for (const hook of ['branch-guard.sh', 'worktree-cwd-guard.sh']) {
      const result = runHook(hook, `cd ${cwd} && git status`, {
        cwd,
        env: { ROBOTA_AGENT_WORKTREE: '1' },
      });
      expect(result.status, `${hook} blocked an ordinary command`).toBe(0);
    }
  });
});

describe('the command parse has one owner', () => {
  /**
   * The defects above were one defect copied four times. Sharing the parser is what makes fixing it
   * once enough — so a hook growing its own decoder again is the regression to catch, not the
   * individual mis-parse it would reintroduce.
   */
  const bashHooks = readdirSync(HOOKS_DIR).filter((name) => name.endsWith('.sh'));

  it('finds hooks to check', () => {
    // Fail closed: a moved directory would make the assertions below pass over nothing.
    expect(bashHooks.length).toBeGreaterThan(0);
  });

  for (const hook of bashHooks) {
    it(`${hook} does not re-implement the command decode`, () => {
      const source = readFileSync(path.join(HOOKS_DIR, hook), 'utf8');
      const handRolled = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .some((line) => /grep\s+-o\s+'"(command|cwd|tool_name)"/.test(line));

      expect(
        handRolled,
        `${hook} decodes the hook payload with grep. That expression stops at the first quote ` +
          'inside the value. Source lib/command-scan.sh and use hook_command_of / hook_cwd_of.',
      ).toBe(false);
    });
  }

  it('truncates no command at the first heredoc opener', () => {
    for (const hook of bashHooks) {
      const source = readFileSync(path.join(HOOKS_DIR, hook), 'utf8');
      const truncatesAtHeredoc = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .some((line) => /%%<<\*/.test(line));

      expect(
        truncatesAtHeredoc,
        `${hook} discards everything from the first heredoc opener onward, so a command written ` +
          'after the terminator is never examined. Use hook_strip_heredocs.',
      ).toBe(false);
    }
  });
});
