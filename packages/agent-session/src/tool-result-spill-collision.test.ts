import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: () => Buffer.alloc(18, 7) };
});

import { NodeToolResultSpillStore } from './tool-result-spill-store.js';

const parents: string[] = [];
afterEach(() => {
  for (const path of parents.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('spill-reference collisions', () => {
  it('never removes an earlier committed result when a new random token collides', async () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-spill-collision-'));
    parents.push(root);
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const { reference } = await store.write('first secret');

    await expect(store.write('second secret')).rejects.toMatchObject({ code: 'write-failed' });
    expect(await store.read(reference)).toBe('first secret');
    await store.shutdown();
  });
});
