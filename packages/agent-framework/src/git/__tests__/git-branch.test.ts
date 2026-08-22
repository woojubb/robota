import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { resolveGitBranchFromNodeHost } from '../git-branch.js';

const TMP_BASE = mkdtempSync(join(tmpdir(), 'robota-git-branch-test-'));

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

  it('returns undefined outside a git repository', () => {
    const cwd = join(TMP_BASE, 'plain');
    mkdirSync(cwd, { recursive: true });

    expect(resolveGitBranchFromNodeHost(cwd)).toBeUndefined();
  });
});
