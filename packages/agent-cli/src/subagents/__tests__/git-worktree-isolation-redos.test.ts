/**
 * SEC-003 alert 34 — `GitWorktreeIsolationAdapter`'s path-segment sanitiser must be linear.
 *
 * The pump is delivered through the public `idFactory` option, which feeds `normalizeShortId` →
 * `sanitizePathSegment`. `-` is inside the class that sanitiser KEEPS, so a long dash run survives the collapse
 * and reaches the trailing half of the old `/^-+|-+$/g` — 3.1 s on a 100 K run. `normalizeShortId` truncates to
 * 8 characters afterwards, so the resulting worktree is ordinary and `prepare()` completes normally.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GitWorktreeIsolationAdapter } from '../git-worktree-isolation-adapter.js';

const PUMP = 200_000;
const BUDGET_MS = 250;
const RED_TIMEOUT_MS = 120_000;

const tempRepos: string[] = [];

afterEach(() => {
  for (const repo of tempRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: gitEnvironment() });
}

function createGitRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'robota-worktree-redos-')));
  tempRepos.push(repo);
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Robota Test']);
  writeFileSync(join(repo, 'README.md'), 'initial\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

describe('SEC-003 alert 34 — git worktree path segment sanitiser', () => {
  /** `prepare()` on a real repo, timed. */
  function timedPrepare(repo: string, shortId: string): { ms: number; branchName: string } {
    const adapter = new GitWorktreeIsolationAdapter({ idFactory: () => shortId });
    const started = performance.now();
    const worktree = adapter.prepare({ taskId: 'agent_1', cwd: repo });
    const ms = performance.now() - started;
    expect(existsSync(worktree.worktreePath)).toBe(true);
    adapter.remove(worktree);
    return { ms, branchName: worktree.branchName };
  }

  it(
    'sanitises a pumped dash run in linear time',
    () => {
      const repo = createGitRepo();
      // The `git` calls dominate `prepare()` and vary with the filesystem, so the assertion is on the DELTA
      // against an identical run with a short id — that difference is the sanitiser, and nothing else.
      const baseline = timedPrepare(repo, 'xy');
      const pumped = timedPrepare(repo, `x${'-'.repeat(PUMP)}y`);

      expect(pumped.branchName).toMatch(/^robota\/agent_1-x-{7}$/);
      expect(pumped.ms - baseline.ms).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it(
    'keeps the sanitised segment for ordinary input',
    () => {
      const repo = createGitRepo();
      const adapter = new GitWorktreeIsolationAdapter({ idFactory: () => '--Robota Agent--' });
      const worktree = adapter.prepare({ taskId: '  weird/job id  ', cwd: repo });
      expect(worktree.branchName).toBe('robota/weird-job-id-Robota-A');
      adapter.remove(worktree);
    },
    RED_TIMEOUT_MS,
  );

  it(
    'reduces an all-separator id to the fallback segment, as before',
    () => {
      const repo = createGitRepo();
      // `&` collapses to a single `-`, the edges are trimmed, and 8 characters are kept.
      expect(timedPrepare(repo, `-${'&'.repeat(1_000)}-a-`).branchName).toBe('robota/agent_1-a');
      expect(timedPrepare(repo, '---').branchName).toBe('robota/agent_1-agent');
    },
    RED_TIMEOUT_MS,
  );
});
