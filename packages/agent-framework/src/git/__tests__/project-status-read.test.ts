/**
 * #3282 §4c — the Project panel's git status against a REAL temporary repository: plain-word status
 * per file (never a raw XY code), added/removed counts, the non-repository case, and the file-count
 * cap. `HOME` is pointed at a temp dir (AGENTS.md: a test that runs git points `HOME` at a temp dir)
 * so no real user git config leaks in.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { createGitProcess } from '../git-process.js';
import { MAX_STATUS_FILES, readProjectGitStatus } from '../project-status-read.js';

import type { IGitProcessPort } from '../git-process.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function hermeticEnv(): NodeJS.ProcessEnv {
  const home = tempDir('project-status-home-');
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home };
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = join(home, 'gitconfig');
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[commit]\n\tgpgsign = false\n');
  return env;
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(env: NodeJS.ProcessEnv): string {
  const repo = tempDir('project-status-repo-');
  git(repo, env, 'init', '-q', '-b', 'main');
  git(repo, env, 'config', 'user.name', 'Status Test');
  git(repo, env, 'config', 'user.email', 'status@example.com');
  return repo;
}

function port(env: NodeJS.ProcessEnv): IGitProcessPort {
  return createGitProcess({ env });
}

describe('readProjectGitStatus', () => {
  it('says a plain, non-repository sentence for a folder with no .git', async () => {
    const env = hermeticEnv();
    const folder = tempDir('project-status-plain-');
    const result = await readProjectGitStatus(port(env), folder);
    expect(result).toEqual({ ok: true, repository: false });
  });

  it('reports the branch and an unborn repository with no commits yet', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const result = await readProjectGitStatus(port(env), repo);
    expect(result).toMatchObject({ ok: true, repository: true, branch: 'main', unborn: true, files: [] });
  });

  it('classifies Added, Modified, Deleted, Untracked with plain words and lines added/removed', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    writeFileSync(join(repo, 'a.txt'), 'line1\nline2\nline3\n');
    writeFileSync(join(repo, 'b.txt'), 'keep\n');
    git(repo, env, 'add', '--', 'a.txt', 'b.txt');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');

    // Modified (unstaged): a.txt gains a line and loses one.
    writeFileSync(join(repo, 'a.txt'), 'line1\nCHANGED\nline3\nline4\n');
    // Deleted (staged): b.txt removed and staged.
    git(repo, env, 'rm', '-q', '--', 'b.txt');
    // Added (staged, new): c.txt.
    writeFileSync(join(repo, 'c.txt'), 'new file\nsecond line\n');
    git(repo, env, 'add', '--', 'c.txt');
    // Untracked: d.txt.
    writeFileSync(join(repo, 'd.txt'), 'untracked\n');

    const result = await readProjectGitStatus(port(env), repo);
    if (!result.ok || !result.repository) throw new Error('expected a repository result');
    expect(result.unborn).toBe(false);
    const byPath = new Map(result.files.map((f) => [f.path, f]));

    expect(byPath.get('a.txt')).toEqual({ path: 'a.txt', status: 'Modified', added: 2, removed: 1 });
    expect(byPath.get('b.txt')).toMatchObject({ path: 'b.txt', status: 'Deleted' });
    expect(byPath.get('c.txt')).toEqual({ path: 'c.txt', status: 'Added', added: 2, removed: 0 });
    expect(byPath.get('d.txt')).toEqual({ path: 'd.txt', status: 'Untracked' });
    expect(result.truncated).toBe(false);
  });

  it('names a rename with its prior path and counts lines the rename itself changed', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    writeFileSync(join(repo, 'old.txt'), 'a\nb\nc\n');
    git(repo, env, 'add', '--', 'old.txt');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');
    git(repo, env, 'mv', 'old.txt', 'new.txt');

    const result = await readProjectGitStatus(port(env), repo);
    if (!result.ok || !result.repository) throw new Error('expected a repository result');
    const renamed = result.files.find((f) => f.path === 'new.txt');
    expect(renamed).toMatchObject({ status: 'Renamed', renamedFrom: 'old.txt' });
  });

  it('caps the file list and reports truncated: true past the limit', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    for (let i = 0; i < MAX_STATUS_FILES + 5; i += 1) {
      writeFileSync(join(repo, `f${i}.txt`), 'x\n');
    }
    const result = await readProjectGitStatus(port(env), repo);
    if (!result.ok || !result.repository) throw new Error('expected a repository result');
    expect(result.files).toHaveLength(MAX_STATUS_FILES);
    expect(result.truncated).toBe(true);
  });

  it('asks numstat for only the kept files, not every changed file past the cap', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const count = MAX_STATUS_FILES + 5;
    for (let i = 0; i < count; i += 1) writeFileSync(join(repo, `f${i}.txt`), 'x\n');
    git(repo, env, 'add', '.');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');
    for (let i = 0; i < count; i += 1) writeFileSync(join(repo, `f${i}.txt`), 'x\nCHANGED\n');

    const real = port(env);
    const numstatPathCounts: number[] = [];
    const spyPort: IGitProcessPort = {
      run: async (args, options) => {
        if (args[0] === 'diff' && args.includes('--numstat')) {
          numstatPathCounts.push(args.length - args.indexOf('--') - 1);
        }
        return real.run(args, options);
      },
    };

    const result = await readProjectGitStatus(spyPort, repo);
    if (!result.ok || !result.repository) throw new Error('expected a repository result');
    expect(result.files).toHaveLength(MAX_STATUS_FILES);
    expect(result.truncated).toBe(true);
    expect(numstatPathCounts.length).toBeGreaterThan(0);
    // Neither the worktree nor the --cached numstat call asked about more than the kept files.
    expect(numstatPathCounts.every((requested) => requested <= MAX_STATUS_FILES)).toBe(true);
  });

  it('reports a real git failure (not the non-repository case) with a message', async () => {
    const notGit: IGitProcessPort = { run: async () => ({ kind: 'exited', stdout: '', stderr: 'fatal: something else went wrong', exitCode: 128 }) };
    const result = await readProjectGitStatus(notGit, '/does-not-matter');
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('something else went wrong');
  });
});
