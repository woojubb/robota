/**
 * A launch write that fails part-way. The launches file is rewritten whole through a temporary file
 * and a rename, so a disk that fills or a rename that fails must leave the intents that were kept in
 * place and no half-written file beside them, and the next write must work. The failure is injected,
 * since a healthy disk never shows it.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import { launchIntent, outcomeOf, receipt } from './launch-world.js';

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

const root = mkdtempSync(join(tmpdir(), 'task-launch-atomic-'));
afterEach(() => {
  io.failWrite = false;
  io.failRename = false;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.each([
  ['a write that stops half way', 'failWrite'],
  ['a rename that fails', 'failRename'],
] as const)('%s', (_name, failure) => {
  it('leaves the launches that were kept and no temporary file, and the next write works', async () => {
    const directory = join(root, failure, 'task-catalog');
    const store = createFileLaunchStore({ directory });
    await store.reserve(launchIntent(1));
    const before = readFileSync(join(directory, 'launches.json'), 'utf8');

    io[failure] = true;
    await expect(
      store.advance(launchIntent(1).id, { status: 'launched', goalId: 'goal-1' }),
    ).rejects.toThrow(/ENOSPC|EIO/u);
    io[failure] = true;
    await expect(store.reserve(launchIntent(2))).rejects.toThrow(/ENOSPC|EIO/u);

    expect(readFileSync(join(directory, 'launches.json'), 'utf8')).toBe(before);
    expect(readdirSync(directory)).toEqual(['launches.json']);
    expect((await store.list()).map((entry) => [entry.id, entry.status])).toEqual([
      [launchIntent(1).id, 'reserved'],
    ]);
    expect(await store.issues()).toEqual([]);

    await store.advance(launchIntent(1).id, { status: 'launched', goalId: 'goal-1' });
    await store.reserve(launchIntent(2));
    expect((await store.list()).map((entry) => entry.status).sort()).toEqual([
      'launched',
      'reserved',
    ]);
  });
});

describe.each([
  ['a write that stops half way', 'failWrite'],
  ['a rename that fails', 'failRename'],
] as const)('a read or an outcome kept through %s', (_name, failure) => {
  it('leaves the file as it was, keeps nothing half decided, and the same step works when asked again', async () => {
    const directory = join(root, `outcome-${failure}`, 'task-catalog');
    const store = createFileLaunchStore({ directory });
    await store.reserve(launchIntent(1));
    await store.advance(launchIntent(1).id, { status: 'launched', goalId: 'goal-1' });
    const before = readFileSync(join(directory, 'launches.json'), 'utf8');

    io[failure] = true;
    await expect(
      store.recordReceipt(launchIntent(1).id, 'goal-1', 'run-1', receipt()),
    ).rejects.toThrow(/ENOSPC|EIO/u);
    expect(readFileSync(join(directory, 'launches.json'), 'utf8')).toBe(before);
    expect(await store.recordReceipt(launchIntent(1).id, 'goal-1', 'run-1', receipt())).toBe(true);

    const withRead = readFileSync(join(directory, 'launches.json'), 'utf8');
    io[failure] = true;
    await expect(store.decide(launchIntent(1).id, outcomeOf())).rejects.toThrow(/ENOSPC|EIO/u);
    // The outcome is not half kept: the file is as it was, with the read still waiting and no outcome.
    expect(readFileSync(join(directory, 'launches.json'), 'utf8')).toBe(withRead);
    expect(readdirSync(directory)).toEqual(['launches.json']);
    const kept = (await store.get(launchIntent(1).id))!;
    expect(kept.outcome).toBeUndefined();
    expect(kept.receipts).toHaveLength(1);

    expect((await store.decide(launchIntent(1).id, outcomeOf())).outcome?.state).toBe('verified');
    expect((await store.get(launchIntent(1).id))!.receipts).toBeUndefined();
  });
});
