import { describe, expect, it } from 'vitest';

import { readCurrentGitBranchFromNodeHost } from '../task-context.js';

import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * The branch is read through the file system it is given and nothing else: an in-memory one stands in
 * for the host's, so a read that went to the real disk would find nothing and fail these.
 */
function memoryFiles(entries: Record<string, string | 'dir'>): IFileSystem {
  const known = (path: string): boolean => path in entries;
  return {
    existsSync: known,
    statSync: (path: string) =>
      ({
        isDirectory: () => entries[path] === 'dir',
        isFile: () => entries[path] !== 'dir',
      }) as ReturnType<IFileSystem['statSync']>,
    readFileSync: (path: string) => {
      const content = entries[path];
      if (typeof content !== 'string') throw new Error(`no file ${path}`);
      return content;
    },
  } as unknown as IFileSystem;
}

describe('readCurrentGitBranchFromNodeHost', () => {
  it('reads the branch from the nearest .git at or above the workspace', () => {
    const fs = memoryFiles({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'ref: refs/heads/feature/x\n',
    });
    expect(readCurrentGitBranchFromNodeHost('/repo', fs)).toBe('feature/x');
    expect(readCurrentGitBranchFromNodeHost('/repo/packages/app', fs)).toBe('feature/x');
  });

  it('follows a worktree’s `gitdir:` pointer, absolute or relative to the checkout', () => {
    const absolute = memoryFiles({
      '/work/.git': 'gitdir: /store/worktrees/a\n',
      '/store/worktrees/a/HEAD': 'ref: refs/heads/wt-a\n',
    });
    expect(readCurrentGitBranchFromNodeHost('/work', absolute)).toBe('wt-a');

    const relative = memoryFiles({
      '/work/.git': 'gitdir: ../store/worktrees/b\n',
      '/store/worktrees/b/HEAD': 'ref: refs/heads/wt-b\n',
    });
    expect(readCurrentGitBranchFromNodeHost('/work', relative)).toBe('wt-b');
  });

  it('answers on a Windows workspace the way it does on a POSIX one', () => {
    const fs = memoryFiles({
      'C:\\repo\\.git': 'dir',
      'C:\\repo\\.git\\HEAD': 'ref: refs/heads/win\n',
    });
    expect(readCurrentGitBranchFromNodeHost('C:\\repo\\src', fs)).toBe('win');
  });

  it('has no branch for a detached HEAD, no repository, or a workspace that is not absolute', () => {
    const detached = memoryFiles({ '/repo/.git': 'dir', '/repo/.git/HEAD': '0123abcd\n' });
    expect(readCurrentGitBranchFromNodeHost('/repo', detached)).toBeUndefined();
    expect(readCurrentGitBranchFromNodeHost('/elsewhere', memoryFiles({}))).toBeUndefined();
    // A relative workspace names a place only the process directory could say.
    const fs = memoryFiles({ 'repo/.git': 'dir', 'repo/.git/HEAD': 'ref: refs/heads/rel\n' });
    expect(readCurrentGitBranchFromNodeHost('repo', fs)).toBeUndefined();
  });
});
