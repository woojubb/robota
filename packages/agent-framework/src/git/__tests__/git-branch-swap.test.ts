import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveGitBranchFromNodeHost } from '../git-branch.js';

/**
 * The first time the code under test checks or opens `path`, swap what is at that path for a link
 * — the moment a separate check followed by a read of the same path is exposed.
 */
const swap = vi.hoisted(() => ({
  path: undefined as string | undefined,
  run: undefined as (() => void) | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const thenSwap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: Parameters<T>) => {
      const result = fn(...args);
      if (swap.path !== undefined && args[0] === swap.path) {
        const run = swap.run;
        swap.path = undefined;
        swap.run = undefined;
        run?.();
      }
      return result;
    }) as T;
  return {
    ...actual,
    lstatSync: thenSwap(actual.lstatSync),
    openSync: thenSwap(actual.openSync),
  };
});

describe('resolveGitBranchFromNodeHost against a swapped .git', () => {
  let base: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'robota-git-branch-swap-')));
  });
  afterEach(() => {
    swap.path = undefined;
    swap.run = undefined;
    rmSync(base, { recursive: true, force: true });
  });

  it('reads the .git file it checked, even when the path becomes a link right after', () => {
    const meta = (name: string, branch: string): string => {
      const dir = join(base, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'HEAD'), `ref: refs/heads/${branch}\n`, 'utf8');
      return dir;
    };
    meta('checked-meta', 'checked');
    meta('swapped-meta', 'swapped');
    const pointer = join(base, 'swapped-pointer');
    writeFileSync(pointer, `gitdir: ${join(base, 'swapped-meta')}\n`, 'utf8');
    const cwd = join(base, 'repo');
    mkdirSync(cwd);
    const dotGit = join(cwd, '.git');
    writeFileSync(dotGit, `gitdir: ${join(base, 'checked-meta')}\n`, 'utf8');
    swap.path = dotGit;
    swap.run = () => {
      rmSync(dotGit);
      symlinkSync(pointer, dotGit);
    };

    expect(resolveGitBranchFromNodeHost(cwd)).toBe('checked');
    expect(swap.path).toBeUndefined();
  });
});
