import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorktreeIsolationAdapter } from '../git-worktree-isolation-adapter.js';

const TEST_TIMEOUT_MS = 20_000;
const tempRepos: string[] = [];

afterEach(() => {
  for (const repo of tempRepos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

function createGitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'robota-worktree-test-'));
  tempRepos.push(repo);
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Robota Test']);
  writeFileSync(join(repo, 'README.md'), 'initial\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('GitWorktreeIsolationAdapter', () => {
  it(
    'creates and removes a clean git worktree',
    () => {
      const repo = createGitRepo();
      const adapter = new GitWorktreeIsolationAdapter();

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });

      expect(worktree.repoRoot).toBe(realpathSync(repo));
      expect(worktree.worktreePath).toContain(join('.robota', 'worktrees'));
      expect(worktree.branchName).toContain('robota/agent_1');
      expect(existsSync(worktree.worktreePath)).toBe(true);
      expect(adapter.isClean(worktree)).toBe(true);

      adapter.remove(worktree);

      expect(existsSync(worktree.worktreePath)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'detects dirty worktrees so the SDK runner can preserve them',
    () => {
      const repo = createGitRepo();
      const adapter = new GitWorktreeIsolationAdapter();

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });
      writeFileSync(join(worktree.worktreePath, 'dirty.txt'), 'dirty\n');

      expect(adapter.isClean(worktree)).toBe(false);
      expect(adapter.getStatus(worktree)).toContain('?? dirty.txt');
    },
    TEST_TIMEOUT_MS,
  );
});
