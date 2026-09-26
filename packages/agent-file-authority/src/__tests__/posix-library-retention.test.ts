import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Count native library loads while keeping the real Koffi behavior.
const load = vi.hoisted(() => vi.fn());
vi.mock('koffi', async () => {
  const actual = await vi.importActual<typeof import('koffi')>('koffi');
  load.mockImplementation((...args: Parameters<typeof actual.load>) => actual.load(...args));
  return { ...actual, load };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform !== 'win32')('POSIX native library retention', () => {
  it('loads libc once per process, so no library handle is ever left for the garbage collector', async () => {
    const { PosixStableFileHostBackend } = await import('../posix-backend.js');
    for (let index = 0; index < 3; index += 1) {
      const root = mkdtempSync(join(tmpdir(), 'robota-posix-retention-'));
      roots.push(root);
      new PosixStableFileHostBackend(root).close();
    }
    expect(load).toHaveBeenCalledTimes(1);
  });
});
