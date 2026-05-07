import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  execFileSync('git', args, { cwd, stdio: 'ignore', env: createGitEnvironment() });
}

function readGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: createGitEnvironment(),
  });
}

function createGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) {
      delete env[key];
    }
  }
  return env;
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
      expect(worktree.baseRevision).toMatch(/^[0-9a-f]{40}$/);
      expect(worktree.parentStatus).toBe('');
      expect(existsSync(worktree.worktreePath)).toBe(true);
      expect(adapter.isClean(worktree)).toBe(true);

      adapter.remove(worktree);

      expect(existsSync(worktree.worktreePath)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ignores inherited Git hook environment variables',
    () => {
      const repo = createGitRepo();
      const previousGitDir = process.env.GIT_DIR;
      const previousGitWorkTree = process.env.GIT_WORK_TREE;
      process.env.GIT_DIR = readGit(process.cwd(), ['rev-parse', '--absolute-git-dir']).trim();
      process.env.GIT_WORK_TREE = process.cwd();

      try {
        const adapter = new GitWorktreeIsolationAdapter();
        const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });

        expect(worktree.repoRoot).toBe(realpathSync(repo));
        expect(worktree.parentStatus).toBe('');

        adapter.remove(worktree);
      } finally {
        if (previousGitDir === undefined) {
          delete process.env.GIT_DIR;
        } else {
          process.env.GIT_DIR = previousGitDir;
        }
        if (previousGitWorkTree === undefined) {
          delete process.env.GIT_WORK_TREE;
        } else {
          process.env.GIT_WORK_TREE = previousGitWorkTree;
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'retries when a generated branch name already exists',
    () => {
      const repo = createGitRepo();
      runGit(repo, ['branch', 'robota/agent_1-fixed']);
      const ids = ['fixed', 'second'];
      const adapter = new GitWorktreeIsolationAdapter({
        idFactory: () => ids.shift() ?? 'fallback',
      });

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });

      expect(worktree.branchName).toBe('robota/agent_1-second');
      expect(worktree.worktreePath).toContain('agent_1-second');

      adapter.remove(worktree);
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

  it(
    'resolves the repository root from a nested directory',
    () => {
      const repo = createGitRepo();
      const nested = join(repo, 'packages', 'nested');
      mkdirSync(nested, { recursive: true });
      const adapter = new GitWorktreeIsolationAdapter();

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: nested });

      expect(worktree.repoRoot).toBe(realpathSync(repo));
      expect(existsSync(worktree.worktreePath)).toBe(true);

      adapter.remove(worktree);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'allows dirty parent checkouts while surfacing parent status',
    () => {
      const repo = createGitRepo();
      writeFileSync(join(repo, 'README.md'), 'changed\n');
      const adapter = new GitWorktreeIsolationAdapter();

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });

      expect(worktree.parentStatus).toContain(' M README.md');
      expect(adapter.isClean(worktree)).toBe(true);

      adapter.remove(worktree);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'creates a worktree from detached HEAD',
    () => {
      const repo = createGitRepo();
      runGit(repo, ['checkout', '--detach', 'HEAD']);
      const adapter = new GitWorktreeIsolationAdapter();

      const worktree = adapter.prepare({ jobId: 'agent_1', cwd: repo });

      expect(existsSync(worktree.worktreePath)).toBe(true);
      expect(worktree.branchName).toContain('robota/agent_1');

      adapter.remove(worktree);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fails with an actionable message outside a git repository',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'robota-nongit-test-'));
      tempRepos.push(directory);
      const adapter = new GitWorktreeIsolationAdapter();

      expect(() => adapter.prepare({ jobId: 'agent_1', cwd: directory })).toThrow(
        'Worktree isolation requires a Git repository',
      );
    },
    TEST_TIMEOUT_MS,
  );
});
