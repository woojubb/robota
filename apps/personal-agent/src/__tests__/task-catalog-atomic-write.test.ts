/**
 * A task-catalog write that fails part-way. The offers file is rewritten whole through a temporary
 * file and a rename, so a disk that fills or a rename that fails must leave the previous offers in
 * place and no half-written file beside them. The failure is injected, since a healthy disk never
 * shows it.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFileTaskCatalogStore } from '../task-catalog/file-store.js';

import type { IOffer } from '../task-catalog/types.js';

const io = vi.hoisted(() => ({ failWrite: false, failRename: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const [target, content, options] = args;
      if (io.failWrite && String(target).endsWith('.tmp')) {
        io.failWrite = false;
        // Half of the bytes reach the disk, then it is full.
        actual.writeFileSync(target, String(content).slice(0, 20), options);
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
          code: 'ENOSPC',
        });
      }
      return actual.writeFileSync(...args);
    },
    renameSync: (from: Parameters<typeof actual.renameSync>[0], to: string) => {
      if (io.failRename && String(from).endsWith('.tmp')) {
        io.failRename = false;
        throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' });
      }
      return actual.renameSync(from, to);
    },
  };
});

const root = mkdtempSync(join(tmpdir(), 'task-catalog-atomic-'));
afterEach(() => {
  io.failWrite = false;
  io.failRename = false;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const offer = (id: string, key: string): IOffer => ({
  id,
  definitionId: 'catch-up-on-mailbox',
  definitionRevision: 1,
  source: 'agent',
  reason: 'Three unread messages arrived today.',
  contextRefs: [],
  createdAt: '2026-11-20T09:00:00Z',
  expiresAt: '2026-11-27T09:00:00Z',
  decision: 'open',
  dedupeKey: key,
});

describe.each([
  ['a write that stops half way', 'failWrite'],
  ['a rename that fails', 'failRename'],
] as const)('%s', (_name, failure) => {
  it('leaves the offers that were kept and no temporary file, and the next write works', async () => {
    const directory = join(root, failure, 'task-catalog');
    const store = createFileTaskCatalogStore({ directory });
    await store.putOffer(offer('offer-a1', 'one'));
    const before = readFileSync(join(directory, 'offers.json'), 'utf8');

    io[failure] = true;
    await expect(store.putOffer(offer('offer-b2', 'two'))).rejects.toThrow(/ENOSPC|EIO/u);

    expect(readFileSync(join(directory, 'offers.json'), 'utf8')).toBe(before);
    expect(readdirSync(directory)).toEqual(['offers.json']);
    expect((await store.listOffers()).map((entry) => entry.id)).toEqual(['offer-a1']);
    expect(await store.issues()).toEqual([]);

    await store.putOffer(offer('offer-b2', 'two'));
    expect((await store.listOffers()).map((entry) => entry.id)).toEqual(['offer-a1', 'offer-b2']);
  });
});
