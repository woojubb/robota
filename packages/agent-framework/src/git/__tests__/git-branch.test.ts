import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { resolveGitBranchFromNodeHost } from '../git-branch.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-git-branch-test-')));

describe('resolveGitBranchFromNodeHost', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('resolves the current branch from a git repository', () => {
    const cwd = join(TMP_BASE, 'repo');
    mkdirSync(join(cwd, '.git'), { recursive: true });
    writeFileSync(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/feat/status-line\n', 'utf8');

    expect(resolveGitBranchFromNodeHost(cwd)).toBe('feat/status-line');
  });

  it('follows a .git file to the directory it names', () => {
    const gitDir = join(TMP_BASE, 'worktree-meta');
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/linked\n', 'utf8');
    const cwd = join(TMP_BASE, 'worktree');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, '.git'), 'gitdir: ../worktree-meta\n', 'utf8');

    expect(resolveGitBranchFromNodeHost(cwd)).toBe('linked');
  });

  it('ignores a .git that is a link or not a regular file', () => {
    const target = join(TMP_BASE, 'real-meta');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'HEAD'), 'ref: refs/heads/through-link\n', 'utf8');
    const linked = join(TMP_BASE, 'linked');
    mkdirSync(linked, { recursive: true });
    symlinkSync(target, join(linked, '.git'));
    expect(resolveGitBranchFromNodeHost(linked)).toBeUndefined();

    const piped = join(TMP_BASE, 'piped');
    mkdirSync(piped, { recursive: true });
    // A FIFO is refused without blocking on an open that waits for a writer.
    spawnSync('mkfifo', [join(piped, '.git')]);
    expect(resolveGitBranchFromNodeHost(piped)).toBeUndefined();
  });

  it('returns undefined outside a git repository', () => {
    const cwd = join(TMP_BASE, 'plain');
    mkdirSync(cwd, { recursive: true });

    expect(resolveGitBranchFromNodeHost(cwd)).toBeUndefined();
  });
});
