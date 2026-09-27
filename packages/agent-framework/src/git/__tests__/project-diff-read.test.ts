/**
 * #3282 §4c — the Project panel's one-file diff against a REAL temporary repository: a tracked
 * modification, an untracked file (shown as a whole-file addition), an unborn branch, the
 * non-repository case, the workspace-containment refusal, and the line cap. `HOME` is pointed at a
 * temp dir (AGENTS.md).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileSystemAsync } from '../../adapters/node-file-system.js';
import { createGitProcess } from '../git-process.js';
import {
  MAX_PROJECT_DIFF_LINES,
  parseUnifiedDiffLines,
  readProjectGitDiff,
} from '../project-diff-read.js';

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
  const home = tempDir('project-diff-home-');
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
  const repo = tempDir('project-diff-repo-');
  git(repo, env, 'init', '-q', '-b', 'main');
  git(repo, env, 'config', 'user.name', 'Diff Test');
  git(repo, env, 'config', 'user.email', 'diff@example.com');
  return repo;
}

function port(env: NodeJS.ProcessEnv): IGitProcessPort {
  return createGitProcess({ env });
}

/** Records whether `readFile` was ever called — proves the size cap refuses BEFORE reading. */
class ReadSpyFileSystem extends NodeFileSystemAsync {
  readCalled = false;
  override async readFile(path: string, encoding: BufferEncoding): Promise<string> {
    this.readCalled = true;
    return super.readFile(path, encoding);
  }
}

describe('parseUnifiedDiffLines', () => {
  it('turns a hunk into hunk/context/remove/add IDiffLine entries', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 0000000..1111111 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+CHANGED',
      ' line3',
      '',
    ].join('\n');
    expect(parseUnifiedDiffLines(diff)).toEqual([
      { type: 'hunk', text: '@@ -1,3 +1,3 @@', lineNumber: 1 },
      { type: 'context', text: 'line1', lineNumber: 1 },
      { type: 'remove', text: 'line2', lineNumber: 2 },
      { type: 'add', text: 'CHANGED', lineNumber: 2 },
      { type: 'context', text: 'line3', lineNumber: 3 },
    ]);
  });

  it('turns a binary-file notice into one hunk line', () => {
    const diff = 'Binary files a/img.png and b/img.png differ\n';
    expect(parseUnifiedDiffLines(diff)).toEqual([
      { type: 'hunk', text: 'Binary files a/img.png and b/img.png differ', lineNumber: 1 },
    ]);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiffLines('')).toEqual([]);
  });
});

describe('readProjectGitDiff', () => {
  it('says a plain, non-repository sentence for a folder with no .git', async () => {
    const env = hermeticEnv();
    const folder = tempDir('project-diff-plain-');
    const result = await readProjectGitDiff(port(env), folder, 'a.txt');
    expect(result).toMatchObject({ ok: false, code: 'not_a_repository' });
  });

  it('refuses a path outside the workspace without running git', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    let called = false;
    const spyPort: IGitProcessPort = {
      run: async (args, options) => {
        called = true;
        return port(env).run(args, options);
      },
    };
    const result = await readProjectGitDiff(spyPort, repo, '../outside.txt');
    expect(result).toMatchObject({ ok: false, code: 'outside_workspace' });
    expect(called).toBe(false);
  });

  it('diffs a tracked, modified file against HEAD', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    writeFileSync(join(repo, 'a.txt'), 'line1\nline2\nline3\n');
    git(repo, env, 'add', '--', 'a.txt');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');
    writeFileSync(join(repo, 'a.txt'), 'line1\nCHANGED\nline3\n');

    const result = await readProjectGitDiff(port(env), repo, 'a.txt');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.diffLines.some((l) => l.type === 'remove' && l.text === 'line2')).toBe(true);
    expect(result.diffLines.some((l) => l.type === 'add' && l.text === 'CHANGED')).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('shows an untracked file as a whole-file addition', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    git(repo, env, 'commit', '-q', '-m', 'chore: empty', '--allow-empty');
    writeFileSync(join(repo, 'new.txt'), 'alpha\nbeta\n');

    const result = await readProjectGitDiff(port(env), repo, 'new.txt');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.diffLines).toEqual([
      { type: 'hunk', text: '@@ -0,0 +1,2 @@', lineNumber: 1 },
      { type: 'add', text: 'alpha', lineNumber: 1 },
      { type: 'add', text: 'beta', lineNumber: 2 },
    ]);
  });

  it('refuses an untracked file over the size cap, without ever reading its content', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    git(repo, env, 'commit', '-q', '-m', 'chore: empty', '--allow-empty');
    // 1 MiB is the cap (MAX_UNTRACKED_DIFF_BYTES) — one byte over it.
    writeFileSync(join(repo, 'big.log'), 'x'.repeat(1024 * 1024 + 1));

    const spyFs = new ReadSpyFileSystem();
    const result = await readProjectGitDiff(port(env), repo, 'big.log', spyFs);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.diffLines).toEqual([
      { type: 'hunk', text: 'This file is too large to show here.', lineNumber: 1 },
    ]);
    expect(spyFs.readCalled).toBe(false);
  });

  it('shows a binary untracked file as "Binary file", never mangled text', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    git(repo, env, 'commit', '-q', '-m', 'chore: empty', '--allow-empty');
    writeFileSync(join(repo, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

    const result = await readProjectGitDiff(port(env), repo, 'image.bin');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.diffLines).toEqual([{ type: 'hunk', text: 'Binary file', lineNumber: 1 }]);
  });

  it('truncates one pathologically long line instead of showing it whole', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    git(repo, env, 'commit', '-q', '-m', 'chore: empty', '--allow-empty');
    const longLine = 'x'.repeat(5000);
    writeFileSync(join(repo, 'minified.js'), longLine);

    const result = await readProjectGitDiff(port(env), repo, 'minified.js');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    const added = result.diffLines.find((l) => l.type === 'add');
    expect(added?.text.length).toBeLessThan(5000);
    expect(added?.text).toContain('(line truncated)');
  });

  it('diffs a staged file on an unborn branch (no HEAD yet)', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    writeFileSync(join(repo, 'a.txt'), 'line1\nline2\n');
    git(repo, env, 'add', '--', 'a.txt');

    const result = await readProjectGitDiff(port(env), repo, 'a.txt');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.diffLines.filter((l) => l.type === 'add')).toHaveLength(2);
  });

  it('caps diff lines with a trailing truncation note', async () => {
    const env = hermeticEnv();
    const repo = initRepo(env);
    const baseLines = Array.from({ length: MAX_PROJECT_DIFF_LINES + 50 }, (_, i) => `line${i}`);
    writeFileSync(join(repo, 'big.txt'), `${baseLines.join('\n')}\n`);
    git(repo, env, 'add', '--', 'big.txt');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');
    const changed = baseLines.map((l) => `${l}x`);
    writeFileSync(join(repo, 'big.txt'), `${changed.join('\n')}\n`);

    const result = await readProjectGitDiff(port(env), repo, 'big.txt');
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.truncated).toBe(true);
    expect(result.diffLines).toHaveLength(MAX_PROJECT_DIFF_LINES + 1);
    expect(result.diffLines.at(-1)).toMatchObject({ type: 'hunk' });
    expect(String(result.diffLines.at(-1)?.text)).toContain('more lines truncated');
  });
});
