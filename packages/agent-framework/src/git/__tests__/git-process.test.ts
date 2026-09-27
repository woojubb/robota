/**
 * BEHAVIOR-2437 TC-04 — the seam against a REAL temporary repository: argv-only (metacharacters are
 * data), exit codes as data, stdin closed (a hook that reads it gets EOF), timeout / abort / missing
 * executable / oversized output as typed failures, and the hook-nesting environment policy.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGitProcess, gitEnvironment, GIT_ENV_DENYLIST } from '../git-process.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/** A hermetic environment: no user/system git config, no inherited hook-nesting variables. */
function hermeticEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: tempDir('git-home-') };
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = join(env.HOME ?? '', 'gitconfig');
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[commit]\n\tgpgsign = false\n');
  return { ...env, ...extra };
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function initRepo(env: NodeJS.ProcessEnv, identity = true): string {
  const repo = tempDir('git-seam-');
  git(repo, env, 'init', '-q', '-b', 'main');
  if (identity) {
    git(repo, env, 'config', 'user.name', 'Seam Test');
    git(repo, env, 'config', 'user.email', 'seam@example.com');
  }
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, env, 'add', '--', 'base.txt');
  if (identity) git(repo, env, 'commit', '-q', '-m', 'chore: base');
  return repo;
}

function installHook(repo: string, name: string, body: string): void {
  const hooks = join(repo, '.git', 'hooks');
  mkdirSync(hooks, { recursive: true });
  const path = join(hooks, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe('gitEnvironment', () => {
  it('strips the repository-redirecting variables and preserves identity and config by name', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      XDG_CONFIG_HOME: '/x',
      GIT_CONFIG_GLOBAL: '/g',
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@x',
      GIT_COMMITTER_NAME: 'c',
      GIT_COMMITTER_EMAIL: 'c@x',
      EMAIL: 'e@x',
      GPG_TTY: '/dev/tty',
      GNUPGHOME: '/gnupg',
      SSH_AUTH_SOCK: '/sock',
    };
    for (const key of GIT_ENV_DENYLIST) source[key] = `/elsewhere/${key}`;
    const env = gitEnvironment(source);
    for (const key of GIT_ENV_DENYLIST) expect(env).not.toHaveProperty(key);
    for (const key of [
      'PATH',
      'XDG_CONFIG_HOME',
      'GIT_CONFIG_GLOBAL',
      'GIT_AUTHOR_NAME',
      'GIT_AUTHOR_EMAIL',
      'GIT_COMMITTER_NAME',
      'GIT_COMMITTER_EMAIL',
      'EMAIL',
      'GPG_TTY',
      'GNUPGHOME',
      'SSH_AUTH_SOCK',
    ]) {
      expect(env[key]).toBe(source[key]);
    }
  });
});

describe('createGitProcess against a real repository', () => {
  it('returns exit codes as data: diff --cached --quiet is 1 when staged, 0 when not', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const port = createGitProcess({ env });
    expect(await port.run(['diff', '--cached', '--quiet'], { cwd: repo })).toMatchObject({
      kind: 'exited',
      exitCode: 0,
    });
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    git(repo, env, 'add', '--', 'new.txt');
    expect(await port.run(['diff', '--cached', '--quiet'], { cwd: repo })).toMatchObject({
      kind: 'exited',
      exitCode: 1,
    });
  });

  it('passes a subject and a path with shell metacharacters as ONE element each (shell: false)', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const port = createGitProcess({ env });
    const path = 'a;b c$(touch pwned-path).txt';
    const subject = 'feat: $(touch pwned) ; echo "quoted" `id` | cat > /dev/null';
    writeFileSync(join(repo, path), 'x\n');
    expect(await port.run(['add', '--', path], { cwd: repo })).toMatchObject({ exitCode: 0 });
    expect(await port.run(['commit', '-m', subject], { cwd: repo })).toMatchObject({ exitCode: 0 });
    const log = await port.run(['log', '-1', '--format=%s'], { cwd: repo });
    expect(log).toMatchObject({ kind: 'exited', exitCode: 0, stdout: `${subject}\n` });
    const status = await port.run(['status', '--porcelain=v2', '-z'], { cwd: repo });
    expect(status).toMatchObject({ kind: 'exited', exitCode: 0 });
    // Neither substitution ran: the tree holds only what git was told, and nothing named pwned.
    if (status.kind === 'exited') expect(status.stdout).not.toContain('pwned');
    const shown = await port.run(['show', '--name-only', '--format=', 'HEAD'], { cwd: repo });
    if (shown.kind === 'exited') expect(shown.stdout.trim()).toBe(path);
  });

  it('closes stdin: a pre-commit hook that reads it sees EOF instead of hanging', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    installHook(repo, 'pre-commit', 'cat > /dev/null\nexit 0');
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    git(repo, env, 'add', '--', 'new.txt');
    const port = createGitProcess({ env });
    const outcome = await port.run(['commit', '-m', 'feat: hooked'], {
      cwd: repo,
      timeoutMs: 5000,
    });
    expect(outcome).toMatchObject({ kind: 'exited', exitCode: 0 });
  });

  it('kills a child that exceeds the timeout and reports failed: timeout', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    installHook(repo, 'pre-commit', 'exec >/dev/null 2>&1\nsleep 5');
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    git(repo, env, 'add', '--', 'new.txt');
    const port = createGitProcess({ env });
    const outcome = await port.run(['commit', '-m', 'feat: slow'], { cwd: repo, timeoutMs: 300 });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'timeout' });
    expect(git(repo, env, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('reports an aborted signal as failed: aborted', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    installHook(repo, 'pre-commit', 'exec >/dev/null 2>&1\nsleep 5');
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    git(repo, env, 'add', '--', 'new.txt');
    const port = createGitProcess({ env });
    const controller = new AbortController();
    const pending = port.run(['commit', '-m', 'feat: aborted'], {
      cwd: repo,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toMatchObject({ kind: 'failed', reason: 'aborted' });
  });

  it('reports a missing executable as failed: not-found', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const port = createGitProcess({ env, executable: join(repo, 'no-such-git') });
    const outcome = await port.run(['status'], { cwd: repo });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'not-found' });
    if (outcome.kind === 'failed') expect(outcome.detail).toContain('ENOENT');
  });

  it('reports output past 16 MiB as failed: output-too-large', async () => {
    const env = hermeticEnv();
    const dir = tempDir('git-big-');
    const fake = join(dir, 'big-git');
    writeFileSync(fake, '#!/bin/sh\nhead -c 17000000 /dev/zero\n');
    chmodSync(fake, 0o755);
    const port = createGitProcess({ env, executable: fake });
    const outcome = await port.run(['status'], { cwd: dir, timeoutMs: 20_000 });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'output-too-large' });
  });

  it('a hook-exported GIT_DIR does not redirect the child; GIT_CONFIG_GLOBAL still carries identity', async () => {
    const env = hermeticEnv();
    const other = initRepo(env);
    const repo = initRepo(env, false);
    writeFileSync(
      env.GIT_CONFIG_GLOBAL ?? '',
      '[commit]\n\tgpgsign = false\n[user]\n\tname = Global Identity\n\temail = global@example.com\n',
    );
    // A hook-style environment: GIT_DIR points at ANOTHER repository.
    const port = createGitProcess({
      env: { ...env, GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other },
    });
    const top = await port.run(['rev-parse', '--show-toplevel'], { cwd: repo });
    expect(top).toMatchObject({ kind: 'exited', exitCode: 0, stdout: `${repo}\n` });
    const commit = await port.run(['commit', '-m', 'feat: identity'], { cwd: repo });
    expect(commit).toMatchObject({ kind: 'exited', exitCode: 0 });
    const author = await port.run(['log', '-1', '--format=%an <%ae>'], { cwd: repo });
    expect(author).toMatchObject({ stdout: 'Global Identity <global@example.com>\n' });
    // The other repository is untouched: still exactly its base commit.
    expect(git(other, env, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });
});
