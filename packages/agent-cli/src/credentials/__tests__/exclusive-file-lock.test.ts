import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { holdExclusiveFileLock, withExclusiveFileLock } from '../exclusive-file-lock.js';

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'exclusive-lock-')));
  lockPath = join(dir, 'x.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('withExclusiveFileLock', () => {
  it('runs holders one at a time and removes the lock afterwards', async () => {
    const order: string[] = [];
    const hold = (name: string) => async (): Promise<void> => {
      order.push(`${name}:in`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`${name}:out`);
    };
    await Promise.all([
      withExclusiveFileLock(lockPath, hold('a')),
      withExclusiveFileLock(lockPath, hold('b')),
    ]);
    expect(order).toHaveLength(4);
    expect(order[0]!.split(':')[0]).toBe(order[1]!.split(':')[0]);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('takes over a lock left by a holder that died', async () => {
    writeFileSync(lockPath, 'dead-holder');
    const past = new Date(Date.now() - 120_000);
    utimesSync(lockPath, past, past);
    await expect(withExclusiveFileLock(lockPath, async () => 'ran')).resolves.toBe('ran');
  });

  it('a live holder slower than the stale window keeps its lock', async () => {
    const order: string[] = [];
    const slow = withExclusiveFileLock(
      lockPath,
      async () => {
        order.push('slow:in');
        await new Promise((resolve) => setTimeout(resolve, 400));
        order.push('slow:out');
      },
      { staleMs: 150, pollMs: 10 },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const next = withExclusiveFileLock(lockPath, async () => void order.push('next:in'), {
      staleMs: 150,
      pollMs: 10,
    });
    await Promise.all([slow, next]);
    expect(order).toEqual(['slow:in', 'slow:out', 'next:in']);
  });

  it('gives up on a live lock after the timeout instead of waiting forever', async () => {
    writeFileSync(lockPath, 'live-holder');
    await expect(
      withExclusiveFileLock(lockPath, async () => 'ran', { timeoutMs: 60, pollMs: 10 }),
    ).rejects.toThrow(/timed out/);
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe('holdExclusiveFileLock — a holder that lost its lock', () => {
  it('is told once when another holder took the lock over, and leaves that lock alone', async () => {
    const lost = vi.fn();
    const lock = await holdExclusiveFileLock(lockPath, { staleMs: 150, onLost: lost });
    // What a takeover leaves after this holder stalled past the stale window (e.g. a sleeping machine).
    writeFileSync(lockPath, 'the-holder-that-took-over');
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lost).toHaveBeenCalledTimes(1);
    lock.release();
    expect(readFileSync(lockPath, 'utf8')).toBe('the-holder-that-took-over');
  });

  it('is told when its lock is gone', async () => {
    const lost = vi.fn();
    const lock = await holdExclusiveFileLock(lockPath, { staleMs: 150, onLost: lost });
    unlinkSync(lockPath);
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    lock.release();
  });

  it('is not told anything while it keeps its lock, however long it holds it', async () => {
    const lost = vi.fn();
    const lock = await holdExclusiveFileLock(lockPath, { staleMs: 150, onLost: lost });
    await new Promise((resolve) => setTimeout(resolve, 400));
    lock.release();
    expect(lost).not.toHaveBeenCalled();
  });
});
