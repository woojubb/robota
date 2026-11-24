/**
 * The launch intents a person's starts leave behind: the rules both adapters keep (one intent for a
 * key and for an id, an intent that only moves forward, a bound that never costs an unfinished
 * intent), and the file adapter's own promises (owner-only files, whole-file writes, a damaged file
 * kept aside).
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import { MAX_LAUNCHES } from '../task-catalog/launch/records.js';
import { LAUNCH_LIMITS } from '../task-catalog/launch/validate.js';
import { createMemoryLaunchStore } from '../task-catalog/launch/store.js';
import { launchIntent as intent, outcomeOf, receipt } from './launch-world.js';

import type { ILaunchStore } from '../task-catalog/launch/store.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const taskDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'task-launch-'));
  directories.push(root);
  return join(root, 'task-catalog');
};

const clock = { now: new Date('2026-11-24T10:00:00Z') };

const adapters: readonly [string, () => ILaunchStore][] = [
  ['memory', () => createMemoryLaunchStore({ now: () => clock.now })],
  ['file', () => createFileLaunchStore({ directory: taskDirectory(), now: () => clock.now })],
];

describe.each(adapters)('the %s launch store', (_name, create) => {
  it('starts empty, keeps a reserved intent and finds it by id and by key, newest first', async () => {
    const store = create();
    expect(await store.list()).toEqual([]);
    expect(await store.issues()).toEqual([]);
    await store.reserve(intent(1));
    await store.reserve(intent(3));
    await store.reserve(intent(2));
    expect((await store.list()).map((entry) => entry.idempotencyKey)).toEqual([
      'key-00000003',
      'key-00000002',
      'key-00000001',
    ]);
    expect(await store.get(intent(2).id)).toEqual(intent(2));
    expect(await store.findByKey('key-00000003')).toEqual(intent(3));
    expect(await store.get('launch-other')).toBeUndefined();
    expect(await store.findByKey('key-unknown-1')).toBeUndefined();
  });

  it('keeps one intent for a key and for an id', async () => {
    const store = create();
    await store.reserve(intent(1));
    await expect(store.reserve(intent(1, { idempotencyKey: 'key-other-1' }))).rejects.toThrow(
      /already has this id/u,
    );
    await expect(
      store.reserve(intent(2, { idempotencyKey: intent(1).idempotencyKey })),
    ).rejects.toThrow(/already has this key/u);
    expect(await store.list()).toHaveLength(1);
  });

  it('keeps a new intent only as reserved, and only a shape it accepts', async () => {
    const store = create();
    await expect(
      store.reserve(intent(1, { status: 'launched', goalId: 'goal-1' })),
    ).rejects.toThrow(/reserved/u);
    await expect(store.reserve({ ...intent(1), extra: true } as never)).rejects.toThrow(
      /unknown field/u,
    );
    await expect(store.reserve(intent(1, { idempotencyKey: 'short' }))).rejects.toThrow(
      /not in the expected form/u,
    );
    await expect(
      store.reserve(intent(1, { bindings: [{ capability: 'shell.run' } as never] })),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });

  it('moves a reserved intent to launched with its goal, or to failed with its reason, and no further', async () => {
    const store = create();
    await store.reserve(intent(1));
    await store.reserve(intent(2));
    const launched = await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    expect(launched).toMatchObject({ status: 'launched', goalId: 'goal-1' });
    expect(launched.updatedAt).toBe(clock.now.toISOString());
    const failed = await store.advance(intent(2).id, {
      status: 'failed',
      failure: { kind: 'stale', message: 'This task changed.' },
    });
    expect(failed).toMatchObject({ status: 'failed', failure: { kind: 'stale' } });
    expect(failed.goalId).toBeUndefined();
    expect(await store.get(intent(1).id)).toEqual(launched);
    // An ended intent does not move again, whatever is asked.
    await expect(store.advance(intent(1).id, { status: 'cancelled' })).rejects.toThrow(
      /already ended as launched/u,
    );
    await expect(
      store.advance(intent(1).id, { status: 'launched', goalId: 'goal-2' }),
    ).rejects.toThrow(/already ended/u);
    await expect(
      store.advance(intent(2).id, { status: 'launched', goalId: 'goal-9' }),
    ).rejects.toThrow(/already ended as failed/u);
    await expect(store.advance('launch-nothing', { status: 'cancelled' })).rejects.toThrow(
      /No launch/u,
    );
  });

  it('answers the same ending again as it stands, so a retry after a lost answer changes nothing', async () => {
    const store = create();
    await store.reserve(intent(1));
    const first = await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    clock.now = new Date('2026-11-24T11:00:00Z');
    const again = await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    expect(again).toEqual(first);
    expect(again.updatedAt).toBe('2026-11-24T10:00:00.000Z');
    clock.now = new Date('2026-11-24T10:00:00Z');
  });

  it('keeps a launch that was cancelled as cancelled, with no goal and no failure', async () => {
    const store = create();
    await store.reserve(intent(1));
    const cancelled = await store.advance(intent(1).id, { status: 'cancelled' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.goalId).toBeUndefined();
    expect(cancelled.failure).toBeUndefined();
  });

  it('keeps the reads a run made for a launched intent, once each and a bounded number, and for no other intent', async () => {
    const store = create();
    const id = intent(1).id;
    await store.reserve(intent(1));
    await store.reserve(intent(2));
    // Nothing is kept for an intent that has no goal yet.
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', receipt())).toBe(false);
    await store.advance(id, { status: 'launched', goalId: 'goal-1' });
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', receipt())).toBe(true);
    // The same read again, and a read for another goal or another intent's goal, are not kept.
    expect(
      await store.recordReceipt(id, 'goal-1', 'run-1', receipt({ at: '2026-11-24T10:00:09.000Z' })),
    ).toBe(false);
    expect(await store.recordReceipt(id, 'goal-2', 'run-1', receipt())).toBe(false);
    expect(await store.recordReceipt(intent(2).id, 'goal-1', 'run-1', receipt())).toBe(false);
    expect(await store.recordReceipt('launch-nothing', 'goal-1', 'run-1', receipt())).toBe(false);
    expect(
      await store.recordReceipt(
        id,
        'goal-1',
        'run-1',
        receipt({ address: 'https://example.com/about' }),
      ),
    ).toBe(true);
    expect((await store.get(id))!.receipts).toEqual([
      { ...receipt(), runId: 'run-1' },
      { ...receipt({ address: 'https://example.com/about' }), runId: 'run-1' },
    ]);
    // A later run's first read replaces what the runs before it read: only the run that ends the goal decides it.
    expect(await store.recordReceipt(id, 'goal-1', 'run-2', receipt())).toBe(true);
    expect((await store.get(id))!.receipts).toEqual([{ ...receipt(), runId: 'run-2' }]);
    // At most as many reads are kept as the bound, and what is not kept is simply not evidence.
    for (let n = 0; n < LAUNCH_LIMITS.receipts + 5; n += 1)
      await store.recordReceipt(
        id,
        'goal-1',
        'run-3',
        receipt({
          address: `https://example.com/page-${n}`,
          requested: `https://example.com/page-${n}`,
        }),
      );
    const kept = (await store.get(id))!.receipts!;
    expect(kept).toHaveLength(LAUNCH_LIMITS.receipts);
    expect(kept.every((entry) => entry.runId === 'run-3')).toBe(true);
    // A receipt is refused when it is not what the host's browser makes.
    await expect(
      store.recordReceipt(id, 'goal-1', 'run-4', { ...receipt(), chars: -1 }),
    ).rejects.toThrow();
    await expect(
      store.recordReceipt(id, 'goal-1', 'run-4', { ...receipt(), extra: 1 } as never),
    ).rejects.toThrow(/unknown field/u);
  });

  it('keeps an intent’s updatedAt when a read is recorded, so the answer to a start does not change', async () => {
    const store = create();
    await store.reserve(intent(1));
    const launched = await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    clock.now = new Date('2026-11-24T12:00:00Z');
    await store.recordReceipt(intent(1).id, 'goal-1', 'run-1', receipt());
    expect((await store.get(intent(1).id))!.updatedAt).toBe(launched.updatedAt);
    clock.now = new Date('2026-11-24T10:00:00Z');
  });

  it('decides an outcome once: the receipts it came from are dropped, updatedAt stays, and a second decision is the first', async () => {
    const store = create();
    const id = intent(1).id;
    await store.reserve(intent(1));
    await store.advance(id, { status: 'launched', goalId: 'goal-1' });
    await store.recordReceipt(id, 'goal-1', 'run-1', receipt());
    const before = (await store.get(id))!;
    const decided = await store.decide(id, outcomeOf());
    expect(decided.outcome).toEqual(outcomeOf());
    expect(decided.receipts).toBeUndefined();
    expect(decided.updatedAt).toBe(before.updatedAt);
    // Asking again, with another outcome, is the intent as it stands.
    const again = await store.decide(
      id,
      outcomeOf({ state: 'unverified', reason: 'Not now.', evidence: [] }),
    );
    expect(again).toEqual(decided);
    expect(await store.get(id)).toEqual(decided);
    // Nothing more is kept for it, and its ending does not move.
    expect(await store.recordReceipt(id, 'goal-1', 'run-2', receipt())).toBe(false);
    await expect(store.advance(id, { status: 'cancelled' })).rejects.toThrow(/already ended/u);
  });

  it('decides only a launched intent that exists, and only an outcome of a known state', async () => {
    const store = create();
    await store.reserve(intent(1));
    await store.reserve(intent(2));
    await store.advance(intent(2).id, { status: 'cancelled' });
    await expect(store.decide(intent(1).id, outcomeOf())).rejects.toThrow(/made a goal/u);
    await expect(store.decide(intent(2).id, outcomeOf())).rejects.toThrow(/made a goal/u);
    await expect(store.decide('launch-nothing', outcomeOf())).rejects.toThrow(/No launch/u);
    await store.reserve(intent(3));
    await store.advance(intent(3).id, { status: 'launched', goalId: 'goal-3' });
    await expect(
      store.decide(intent(3).id, { ...outcomeOf(), state: 'completed' } as never),
    ).rejects.toThrow();
    expect((await store.get(intent(3).id))!.outcome).toBeUndefined();
  });

  it('keeps a decided intent as finished: at the bound it is one of those that make room, and a waiting one is not', async () => {
    const store = create();
    for (let n = 1; n <= MAX_LAUNCHES; n += 1) await store.reserve(intent(n));
    await store.advance(intent(5).id, { status: 'launched', goalId: 'goal-5' });
    await store.decide(intent(5).id, outcomeOf());
    await store.reserve(intent(MAX_LAUNCHES + 1));
    expect(await store.get(intent(5).id)).toBeUndefined();
    expect(await store.get(intent(1).id)).toBeDefined();
  }, 60_000);

  it('is bounded: the oldest finished intents go first, and an unfinished one is never dropped', async () => {
    const store = create();
    for (let n = 1; n <= MAX_LAUNCHES; n += 1) await store.reserve(intent(n));
    // Every place is held by a launch still waiting: another cannot be kept, and none is dropped.
    await expect(store.reserve(intent(MAX_LAUNCHES + 1))).rejects.toThrow(
      new RegExp(`At most ${MAX_LAUNCHES} launches`, 'u'),
    );
    expect(await store.list()).toHaveLength(MAX_LAUNCHES);
    // Two of them end; the oldest finished one is the one that makes room.
    await store.advance(intent(7).id, { status: 'launched', goalId: 'goal-7' });
    await store.advance(intent(3).id, { status: 'cancelled' });
    await store.reserve(intent(MAX_LAUNCHES + 1));
    const kept = await store.list();
    expect(kept).toHaveLength(MAX_LAUNCHES);
    expect(await store.get(intent(3).id)).toBeUndefined();
    expect(await store.get(intent(7).id)).toBeDefined();
    expect(kept.filter((entry) => entry.status === 'reserved')).toHaveLength(MAX_LAUNCHES - 1);
    // A key whose intent was dropped is free to be used again.
    expect(await store.findByKey(intent(3).idempotencyKey)).toBeUndefined();
  }, 60_000);
});

describe('the file launch store', () => {
  it('keeps its file owner-only in an owner-only directory, with no temporary file left', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    await store.reserve(intent(1));
    await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(join(directory, 'launches.json')).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(directory)).toEqual(['launches.json']);
    expect(JSON.parse(readFileSync(join(directory, 'launches.json'), 'utf8'))).toEqual({
      launches: [expect.objectContaining({ status: 'launched', goalId: 'goal-1' })],
    });
  });

  it('keeps what it wrote across a restart, to the byte', async () => {
    const directory = taskDirectory();
    const first = createFileLaunchStore({ directory });
    await first.reserve(intent(1));
    await first.advance(intent(1).id, {
      status: 'failed',
      failure: { kind: 'goal', message: 'Your agent could not set this task up.' },
    });
    const second = createFileLaunchStore({ directory });
    expect(await second.list()).toEqual(await first.list());
    expect((await second.findByKey(intent(1).idempotencyKey))?.status).toBe('failed');
  });

  it('shows what it can read of a damaged file, reports the rest without a path, and keeps the file aside before it writes', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    await store.reserve(intent(1));
    const file = join(directory, 'launches.json');
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { launches: unknown[] };
    const damaged = JSON.stringify({ launches: [...kept.launches, { id: 'launch-broken' }] });
    writeFileSync(file, damaged);
    expect((await store.list()).map((entry) => entry.id)).toEqual([intent(1).id]);
    expect(await store.issues()).toEqual(['1 saved launch could not be read and is not shown.']);
    expect(existsSync(`${file}.damaged`)).toBe(false);
    await store.reserve(intent(2));
    expect(readFileSync(`${file}.damaged`, 'utf8')).toBe(damaged);
    expect((await store.list()).map((entry) => entry.id)).toEqual([intent(2).id, intent(1).id]);
    expect(await store.issues()).toEqual([]);

    writeFileSync(file, '{ not json');
    expect(await store.list()).toEqual([]);
    expect(await store.issues()).toEqual(['Saved launches could not be read, so none are shown.']);
    expect(JSON.stringify(await store.issues())).not.toContain(directory);
    await store.reserve(intent(3));
    expect(readFileSync(`${file}.damaged`, 'utf8')).toBe('{ not json');
  });

  it('keeps an outcome and the reads waiting for one across a restart, to the byte', async () => {
    const directory = taskDirectory();
    const first = createFileLaunchStore({ directory });
    await first.reserve(intent(1));
    await first.reserve(intent(2));
    await first.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    await first.advance(intent(2).id, { status: 'launched', goalId: 'goal-2' });
    await first.recordReceipt(intent(1).id, 'goal-1', 'run-1', receipt());
    await first.recordReceipt(intent(2).id, 'goal-2', 'run-1', receipt());
    await first.decide(intent(2).id, outcomeOf());
    const second = createFileLaunchStore({ directory });
    expect(await second.list()).toEqual(await first.list());
    expect((await second.get(intent(1).id))!.receipts).toHaveLength(1);
    expect((await second.get(intent(2).id))!.outcome).toEqual(outcomeOf());
    expect(await second.issues()).toEqual([]);
    if (process.platform !== 'win32')
      expect(statSync(join(directory, 'launches.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual(['launches.json']);
  });

  it('still reads an intent kept before outcomes existed: it has none, and gets one when it is decided', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    await store.reserve(intent(1));
    await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    const file = join(directory, 'launches.json');
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { launches: Record<string, unknown>[] };
    expect(kept.launches[0]).not.toHaveProperty('outcome');
    expect(kept.launches[0]).not.toHaveProperty('receipts');
    const reopened = createFileLaunchStore({ directory });
    expect((await reopened.get(intent(1).id))!.status).toBe('launched');
    expect(await reopened.issues()).toEqual([]);
    expect((await reopened.decide(intent(1).id, outcomeOf())).outcome?.state).toBe('verified');
  });

  it('refuses an outcome or a read that was edited into something the host would not write', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    await store.reserve(intent(1));
    await store.advance(intent(1).id, { status: 'launched', goalId: 'goal-1' });
    await store.recordReceipt(intent(1).id, 'goal-1', 'run-1', receipt());
    const file = join(directory, 'launches.json');
    const original = readFileSync(file, 'utf8');
    const edit = (change: (record: Record<string, any>) => void): void => {
      const content = JSON.parse(original) as { launches: Record<string, any>[] };
      change(content.launches[0]!);
      writeFileSync(file, JSON.stringify(content));
    };
    const outcomeInstead = (outcome: unknown) => (record: Record<string, any>) => {
      delete record['receipts'];
      record['outcome'] = outcome;
    };
    for (const change of [
      // An outcome while reads wait for one, and an outcome on an intent that made no goal.
      (record: Record<string, any>) => (record['outcome'] = outcomeOf()),
      (record: Record<string, any>) => {
        delete record['receipts'];
        delete record['goalId'];
        record['status'] = 'reserved';
        record['outcome'] = outcomeOf();
      },
      (record: Record<string, any>) => (record['status'] = 'reserved'),
      (record: Record<string, any>) => (record['receipts'][0].extra = 1),
      (record: Record<string, any>) => (record['receipts'][0].kind = 'form-post'),
      (record: Record<string, any>) => (record['receipts'][0].digest = 'abc'),
      (record: Record<string, any>) => (record['receipts'][0].runId = 'RUN ONE'),
      (record: Record<string, any>) => (record['receipts'][0].at = 'yesterday'),
      (record: Record<string, any>) => (record['receipts'][0].excerpt = 'x'.repeat(161)),
      (record: Record<string, any>) =>
        (record['receipts'] = Array(LAUNCH_LIMITS.receipts + 1).fill(record['receipts'][0])),
      outcomeInstead({ ...outcomeOf(), state: 'completed' }),
      outcomeInstead({ ...outcomeOf(), report: 'x'.repeat(2001) }),
      outcomeInstead({ ...outcomeOf(), evidence: Array(9).fill(receipt()) }),
      outcomeInstead({ ...outcomeOf(), extra: true }),
      outcomeInstead({ ...outcomeOf(), decidedAt: 'later' }),
    ]) {
      writeFileSync(file, original);
      edit(change);
      expect(await store.list(), String(change)).toEqual([]);
      expect(await store.issues()).toEqual(['1 saved launch could not be read and is not shown.']);
    }
  });

  it('refuses a kept intent that was edited into something the host would not write', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    await store.reserve(intent(1));
    const file = join(directory, 'launches.json');
    const edit = (change: (record: Record<string, any>) => void): void => {
      const content = JSON.parse(readFileSync(file, 'utf8')) as { launches: Record<string, any>[] };
      change(content.launches[0]!);
      writeFileSync(file, JSON.stringify(content));
    };
    const original = readFileSync(file, 'utf8');
    for (const change of [
      (record: Record<string, any>) => (record['status'] = 'running'),
      (record: Record<string, any>) => (record['goalId'] = 'goal-1'),
      (record: Record<string, any>) => (record['bindings'][0].capability = 'shell.run'),
      (record: Record<string, any>) => (record['bindings'][0].tool = 'Bash'),
      (record: Record<string, any>) => (record['origin'] = { kind: 'offer' }),
      (record: Record<string, any>) => (record['inputs'] = { page: { deep: true } }),
      (record: Record<string, any>) => (record['updatedAt'] = '2020-01-01T00:00:00Z'),
      (record: Record<string, any>) => (record['extra'] = 1),
    ]) {
      writeFileSync(file, original);
      edit(change);
      expect(await store.list(), String(change)).toEqual([]);
      expect(await store.issues()).toEqual(['1 saved launch could not be read and is not shown.']);
    }
  });
});
