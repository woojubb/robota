/**
 * An SDK embedder that builds the spill store with no options keeps working as it did before hosts
 * could name a parent: the store falls back to the operating-system temporary directory (a deprecated
 * default; the robota CLI always passes its own owner-only directory).
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeToolResultSpillStore } from '../session-persistence.js';

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createNodeToolResultSpillStore without options', () => {
  it('builds a working store under the operating-system temporary directory and removes it at shutdown', async () => {
    const shared = mkdtempSync(join(tmpdir(), 'agent-spill-factory-'));
    roots.push(shared);
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, shared);

    const store = createNodeToolResultSpillStore();
    const { reference } = await store.write('embedder content');

    expect(await store.read(reference)).toBe('embedder content');
    expect(readdirSync(shared)).toEqual([
      expect.stringMatching(/^agent-tool-results-[A-Za-z0-9]{6}$/u),
    ]);
    await store.shutdown();
    expect(readdirSync(shared)).toEqual([]);
  });
});
