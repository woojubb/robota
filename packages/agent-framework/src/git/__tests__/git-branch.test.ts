import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGitBranch } from '../git-branch.js';

const TMP_BASE = join(tmpdir(), `robota-git-branch-test-${process.pid}`);

describe('resolveGitBranch', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('resolves the current branch from a git repository', () => {
    const cwd = join(TMP_BASE, 'repo');
    mkdirSync(join(cwd, '.git'), { recursive: true });
    writeFileSync(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/feat/status-line\n', 'utf8');

    expect(resolveGitBranch(cwd)).toBe('feat/status-line');
  });

  it('returns undefined outside a git repository', () => {
    const cwd = join(TMP_BASE, 'plain');
    mkdirSync(cwd, { recursive: true });

    expect(resolveGitBranch(cwd)).toBeUndefined();
  });
});
