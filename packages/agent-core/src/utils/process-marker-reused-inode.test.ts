import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { createProcessMarkerMemory, createProcessMarkers } from './process-marker.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fstatSync: (fd: number, options?: { bigint?: boolean }) => {
      if (!options?.bigint) return actual.fstatSync(fd);
      const result = actual.fstatSync(fd, { bigint: true });
      return Object.assign(result, { dev: 123n, ino: 456n });
    },
  };
});

it('rejects a previous writer when a same-process marker reuses its device and inode', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-reused-inode-'));
  const directory = join(root, 'claims');
  const operationLock = {
    tryAcquire(name: string) {
      const guard = join(directory, `${name}.testguard`);
      try {
        mkdirSync(guard);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
        throw error;
      }
      return { release: () => rmdirSync(guard) };
    },
  };
  const create = () =>
    createProcessMarkers(directory, {
      operationLock,
      current: { pid: 5000, startTime: 'same-process' },
      memory: createProcessMarkerMemory(),
      lockWaitMs: 0,
    });
  try {
    const first = create();
    const old = first.acquire('session_a');
    expect(old.status).toBe('acquired');
    if (old.status !== 'acquired') throw new Error('expected first claim');
    const oldBytes = readFileSync(join(directory, 'session_a.owner'));
    expect(first.remove('session_a', { force: true }).status).toBe('removed');

    const next = create().acquire('session_a');
    expect(next.status).toBe('acquired');
    if (next.status !== 'acquired') throw new Error('expected second claim');
    expect.soft(old.handle.holds()).toBe(false);
    let wrote = false;
    expect.soft(old.handle.withGuard(() => (wrote = true))).toEqual({ status: 'lost' });
    expect.soft(wrote).toBe(false);
    expect.soft(readFileSync(join(directory, 'session_a.owner'))).not.toEqual(oldBytes);
    old.handle.release();
    expect.soft(next.handle.holds()).toBe(true);
    next.handle.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
