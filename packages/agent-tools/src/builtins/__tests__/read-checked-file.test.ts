import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadTool } from '../read-tool.js';

/**
 * The first time the tool checks or opens `path`, swap what is at that path for a link — the moment
 * a separate check followed by a read of the same path is exposed.
 */
const swap = vi.hoisted(() => ({
  path: undefined as string | undefined,
  run: undefined as (() => void) | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const thenSwap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args: Parameters<T>) => {
      const result = await fn(...args);
      if (swap.path !== undefined && args[0] === swap.path) {
        const run = swap.run;
        swap.path = undefined;
        swap.run = undefined;
        run?.();
      }
      return result;
    }) as T;
  return { ...actual, stat: thenSwap(actual.stat), open: thenSwap(actual.open) };
});

async function read(
  root: string,
  filePath: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const outcome = await createReadTool({ cwd: root }).execute({ filePath });
  return JSON.parse(String((outcome as { data?: unknown }).data)) as {
    success: boolean;
    output: string;
    error?: string;
  };
}

describe('Read opens once and reads what it checked', () => {
  let base: string;
  let root: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'read-checked-')));
    root = join(base, 'root');
    mkdirSync(root);
  });
  afterEach(() => {
    swap.path = undefined;
    swap.run = undefined;
    rmSync(base, { recursive: true, force: true });
  });

  it('never reads a file swapped in for a link after the path was checked', async () => {
    const outside = join(base, 'outside.txt');
    writeFileSync(outside, 'OUTSIDE-SECRET');
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'checked');
    swap.path = file;
    swap.run = () => {
      rmSync(file);
      symlinkSync(outside, file);
    };

    const result = await read(root, file);
    expect(swap.path).toBeUndefined();
    expect(result.output).not.toContain('OUTSIDE-SECRET');
    expect(result).toMatchObject({ success: true });
    expect(result.output).toContain('checked');
  });

  it('words a missing file, a directory and a FIFO as before, without blocking on the FIFO', async () => {
    expect(await read(root, join(root, 'absent.txt'))).toMatchObject({
      success: false,
      error: `File not found: ${join(root, 'absent.txt')}`,
    });
    mkdirSync(join(root, 'dir'));
    expect(await read(root, join(root, 'dir'))).toMatchObject({
      success: false,
      error: `Path is not a file: ${join(root, 'dir')}`,
    });
    spawnSync('mkfifo', [join(root, 'pipe')]);
    expect(await read(root, join(root, 'pipe'))).toMatchObject({
      success: false,
      error: `Path is not a file: ${join(root, 'pipe')}`,
    });
  });
});
