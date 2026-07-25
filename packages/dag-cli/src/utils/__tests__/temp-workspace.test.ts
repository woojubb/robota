import { existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTempWorkspace } from '../temp-workspace.js';

const OWNER_ONLY_DIR_MODE = 0o700;
const GROUP_AND_OTHER_BITS = 0o077;

describe('withTempWorkspace (SEC-003)', () => {
  it('creates the directory with owner-only permissions', async () => {
    await withTempWorkspace('sec003-mode', async (dir) => {
      const mode = statSync(dir).mode & 0o777;
      expect(mode).toBe(OWNER_ONLY_DIR_MODE);
      // The point of 0700: no group/other access at all.
      expect(mode & GROUP_AND_OTHER_BITS).toBe(0);
    });
  });

  it('is not derivable from the prefix — two calls with the same prefix differ', async () => {
    const paths: string[] = [];
    await withTempWorkspace('sec003-same', async (dir) => void paths.push(dir));
    await withTempWorkspace('sec003-same', async (dir) => void paths.push(dir));

    expect(paths[0]).not.toBe(paths[1]);
    // The predictable part must be only the prefix; the rest is chosen by the OS.
    for (const p of paths) {
      expect(p).not.toBe(join(tmpdir(), 'sec003-same'));
      expect(p.length).toBeGreaterThan(join(tmpdir(), 'sec003-same-').length);
    }
  });

  it('places the workspace under the OS temp dir', async () => {
    await withTempWorkspace('sec003-parent', async (dir) => {
      expect(dirname(dir)).toBe(tmpdir());
    });
  });

  it('removes the whole directory once the callback settles', async () => {
    let captured = '';
    await withTempWorkspace('sec003-cleanup', async (dir) => {
      captured = dir;
      writeFileSync(join(dir, 'nested.json'), '{}');
      expect(existsSync(join(dir, 'nested.json'))).toBe(true);
    });

    expect(captured).not.toBe('');
    expect(existsSync(captured)).toBe(false);
  });

  it('removes the directory even when the callback throws, and rethrows', async () => {
    let captured = '';
    await expect(
      withTempWorkspace('sec003-throw', async (dir) => {
        captured = dir;
        writeFileSync(join(dir, 'leftover.json'), '{}');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(existsSync(captured)).toBe(false);
  });

  it('returns the callback result', async () => {
    const result = await withTempWorkspace('sec003-result', async () => 42);
    expect(result).toBe(42);
  });
});
