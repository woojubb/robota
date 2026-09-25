import { existsSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withExclusiveFileLock } from '../exclusive-file-lock.js';

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

  it('gives up on a live lock after the timeout instead of waiting forever', async () => {
    writeFileSync(lockPath, 'live-holder');
    await expect(
      withExclusiveFileLock(lockPath, async () => 'ran', { timeoutMs: 60, pollMs: 10 }),
    ).rejects.toThrow(/timed out/);
    expect(existsSync(lockPath)).toBe(true);
  });
});
