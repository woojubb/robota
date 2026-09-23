import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ failCleanup: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (fd: number, content: string) => {
      actual.writeFileSync(fd, content.slice(0, 12), 'utf8');
      const error = new Error('ENOSPC: private-payload-body') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';
      throw error;
    },
    unlinkSync: (path: string) => {
      if (flags.failCleanup && path.endsWith('.partial')) {
        const error = new Error('EACCES: private-payload-body') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return actual.unlinkSync(path);
    },
  };
});

import { NodeToolResultSpillStore } from './tool-result-spill-store.js';

const parents: string[] = [];
afterEach(() => {
  flags.failCleanup = false;
  for (const path of parents.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('spill write failure', () => {
  it('reports disk exhaustion without publishing a partial result or secret diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-spill-failure-'));
    parents.push(root);
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const secret = 'private-payload-body';
    let caught: unknown;
    try {
      await store.write(secret);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'write-failed' });
    expect(String(caught)).not.toContain(secret);
    const directory = join(root, readdirSync(root)[0]!);
    expect(readdirSync(directory)).toEqual([]);
    await store.shutdown();
  });

  it('distinguishes cleanup failure when a partial write cannot be removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-spill-failure-'));
    parents.push(root);
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    flags.failCleanup = true;
    await expect(store.write('private-payload-body')).rejects.toMatchObject({
      code: 'cleanup-failed',
    });
    await expect(store.shutdown()).rejects.toMatchObject({ code: 'cleanup-failed' });
  });
});
