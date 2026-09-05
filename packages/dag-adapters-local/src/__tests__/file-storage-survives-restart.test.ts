import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileStoragePort } from '../file-storage-port.js';

import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';

/**
 * DAG-003 — a file-backed adapter whose runs were in memory.
 *
 * `FileStoragePort` is the DEFAULT storage in `createDagFramework`, so `dag-runtime-server` and
 * `dag-mcp-server` both use it with no override. It wrote definitions to disk and held runs and task
 * runs in plain `Map`s: a restart of either long-running server lost every run, from a store whose
 * name is `File`.
 *
 * The cost landed on DAG-001. That change's idle sweep recovers a task abandoned by a dead worker by
 * reading its `status` and `leaseUntil` — and against this adapter a real crash lost exactly those,
 * so there was nothing left to sweep. A recovery path with no durable state under it.
 *
 * Each case builds a SECOND adapter over the same directory. That is the only way to test what a
 * restart does; asserting through the same instance would pass against the in-memory Maps.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storageRoot(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-003-')));
  dirs.push(dir);
  return dir;
}

function dagRun(overrides: Partial<IDagRun> = {}): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'd',
    dagVersion: 1,
    status: 'running',
    startedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  } as IDagRun;
}

function taskRun(overrides: Partial<ITaskRun> = {}): ITaskRun {
  return {
    taskRunId: 'task-1',
    dagRunId: 'run-1',
    nodeId: 'greeting',
    status: 'running',
    attempt: 1,
    ...overrides,
  } as ITaskRun;
}

describe('FileStoragePort survives a restart (DAG-003)', () => {
  it('a DAG run written by one instance is readable by the next', async () => {
    const root = storageRoot();
    await new FileStoragePort(root).createDagRun(dagRun());

    // Against the defect this is `undefined`: the second instance starts with an empty Map.
    expect(await new FileStoragePort(root).getDagRun('run-1')).toMatchObject({
      dagRunId: 'run-1',
      status: 'running',
    });
  });

  it('a status update survives too, not just the creation', async () => {
    const root = storageRoot();
    const first = new FileStoragePort(root);
    await first.createDagRun(dagRun());
    await first.updateDagRunStatus('run-1', 'success', '2026-08-03T00:01:00.000Z');

    const restarted = await new FileStoragePort(root).getDagRun('run-1');
    expect(restarted?.status).toBe('success');
    expect(restarted?.endedAt).toBe('2026-08-03T00:01:00.000Z');
  });

  it('a task run survives, with the two fields the sweeper reads', async () => {
    // `status` and `leaseUntil` are what `listStaleRunningTaskRuns` reads. Losing them is what made
    // DAG-001's recovery path inert against this adapter.
    const root = storageRoot();
    await new FileStoragePort(root).createTaskRun(
      taskRun({ leaseUntil: '2026-08-03T00:00:30.000Z' } as Partial<ITaskRun>),
    );

    const restarted = await new FileStoragePort(root).getTaskRun('task-1');
    expect(restarted?.status).toBe('running');
    expect((restarted as { leaseUntil?: string } | undefined)?.leaseUntil).toBe(
      '2026-08-03T00:00:30.000Z',
    );
  });

  it('listing sees runs written before the restart', async () => {
    const root = storageRoot();
    const first = new FileStoragePort(root);
    await first.createDagRun(dagRun({ dagRunId: 'run-a' }));
    await first.createDagRun(dagRun({ dagRunId: 'run-b' }));

    const listed = await new FileStoragePort(root).listDagRuns();
    expect(listed.map((run) => run.dagRunId)).toEqual(['run-a', 'run-b']);
  });

  it('a task run is listable by its dag run after a restart', async () => {
    const root = storageRoot();
    const first = new FileStoragePort(root);
    await first.createTaskRun(taskRun({ taskRunId: 't1' }));
    await first.createTaskRun(taskRun({ taskRunId: 't2' }));

    const listed = await new FileStoragePort(root).listTaskRunsByDagRunId('run-1');
    expect(listed.map((task) => task.taskRunId).sort()).toEqual(['t1', 't2']);
  });

  it('a deleted run stays deleted across a restart', async () => {
    // Deletion has to reach the disk too, or a restart resurrects it.
    const root = storageRoot();
    const first = new FileStoragePort(root);
    await first.createDagRun(dagRun());
    await first.deleteDagRun('run-1');

    expect(await new FileStoragePort(root).getDagRun('run-1')).toBeUndefined();
  });

  it('a fresh directory reads as empty rather than throwing', async () => {
    expect(await new FileStoragePort(storageRoot()).listDagRuns()).toEqual([]);
  });
});

/**
 * The point of the change, not just its mechanism.
 *
 * DAG-001's sweep asks the store for tasks still `running` whose lease has expired. Against the old
 * adapter a restart left that query with nothing to find — not an empty result meaning "all healthy",
 * but an empty result meaning "the evidence is gone". This is the case that makes the difference
 * observable rather than structural.
 */
describe("DAG-001's sweep has something to recover after a restart (DAG-003)", () => {
  it('finds a task abandoned by a process that died', async () => {
    const root = storageRoot();
    const beforeCrash = new FileStoragePort(root);
    await beforeCrash.createTaskRun(taskRun({ taskRunId: 'abandoned' }));
    await beforeCrash.setTaskRunLease('abandoned', 'worker-1', '2026-08-03T00:00:10.000Z');

    // The process dies here. A new one starts over the same directory.
    const stale = await new FileStoragePort(root).listStaleRunningTaskRuns(
      '2026-08-03T00:05:00.000Z',
    );

    // Against the defect this is `[]` — and an empty sweep is indistinguishable from a healthy one.
    expect(stale.map((task) => task.taskRunId)).toEqual(['abandoned']);
  });

  it('does not reclaim a task whose lease is still live', async () => {
    // The other direction, which matters as much: a sweep that returned everything would re-run work
    // a live owner is still doing.
    const root = storageRoot();
    const before = new FileStoragePort(root);
    await before.createTaskRun(taskRun({ taskRunId: 'live' }));
    await before.setTaskRunLease('live', 'worker-1', '2026-08-03T00:10:00.000Z');

    const stale = await new FileStoragePort(root).listStaleRunningTaskRuns(
      '2026-08-03T00:05:00.000Z',
    );
    expect(stale).toEqual([]);
  });
});

/**
 * The two mutators the first pass missed.
 *
 * Review round 1 found them: `saveTaskRunSnapshots` and `incrementTaskAttempt` mutated the Map and
 * never persisted, while every other task-run mutator was migrated. The SPEC row this change wrote
 * — "definitions, runs and task runs — all three survive a restart" — was therefore false for these
 * fields, and no case covered them, so the suite was accidental-green against its own claim.
 *
 * `attempt` is the load-bearing one: `worker-failure-handler` increments it on each retry and the
 * retry LIMIT is counted from it, so a crash mid-retry-loop reset the count and let a task retry past
 * its configured maximum.
 */
describe('every task-run mutator reaches the disk (DAG-003)', () => {
  it('the retry attempt count survives — a reset lets a task exceed its limit', async () => {
    const root = storageRoot();
    const before = new FileStoragePort(root);
    await before.createTaskRun(taskRun({ taskRunId: 'retried' }));
    await before.incrementTaskAttempt('retried');
    await before.incrementTaskAttempt('retried');

    // Against the defect this is 1 — the creation persisted, the increments did not.
    expect((await new FileStoragePort(root).getTaskRun('retried'))?.attempt).toBe(3);
  });

  it('snapshots and credits survive', async () => {
    const root = storageRoot();
    const before = new FileStoragePort(root);
    await before.createTaskRun(taskRun({ taskRunId: 'snapshotted' }));
    await before.saveTaskRunSnapshots('snapshotted', '{"in":1}', '{"out":2}', 5, 7);

    const restarted = await new FileStoragePort(root).getTaskRun('snapshotted');
    expect(restarted?.inputSnapshot).toBe('{"in":1}');
    expect(restarted?.outputSnapshot).toBe('{"out":2}');
    expect(restarted?.estimatedCredits).toBe(5);
    expect(restarted?.totalCredits).toBe(7);
  });
});

/**
 * Review round 3 — the same lost-update class, one layer up.
 *
 * `ensureInitialized` had no single-flight guard, so two calls on a fresh instance both saw
 * `isInitialized === false` and hydrated concurrently. `hydrateCollection` only `.set()`s what it
 * read and never clears, so a stale read landing after another call had already written a newer
 * value for the same key silently reverted it — and the next persist wrote the reverted value back.
 *
 * A restarted server handling its first two concurrent requests is exactly this change's own target
 * scenario, which is what makes it worth a case rather than a note.
 */
describe('concurrent first access does not revert a write (DAG-003)', () => {
  it('a value written during hydration survives', async () => {
    const root = storageRoot();
    // Something already on disk, so hydration has real work to do and a stale read is possible.
    await new FileStoragePort(root).createTaskRun(taskRun({ taskRunId: 't1', attempt: 1 }));

    // A fresh instance, driven concurrently from its very first call.
    const restarted = new FileStoragePort(root);
    await Promise.all([
      restarted.incrementTaskAttempt('t1'),
      restarted.getTaskRun('t1'),
      restarted.listTaskRunsByDagRunId('run-1'),
      restarted.incrementTaskAttempt('t1'),
    ]);

    expect((await restarted.getTaskRun('t1'))?.attempt).toBe(3);
    // And the disk agrees — a revert would be written back by the next persist.
    expect((await new FileStoragePort(root).getTaskRun('t1'))?.attempt).toBe(3);
  });

  it('hydrates once, not once per concurrent caller', async () => {
    const root = storageRoot();
    await new FileStoragePort(root).createDagRun(dagRun());

    const restarted = new FileStoragePort(root);
    const results = await Promise.all([
      restarted.getDagRun('run-1'),
      restarted.getDagRun('run-1'),
      restarted.listDagRuns(),
    ]);
    expect((results[0] as { dagRunId: string } | undefined)?.dagRunId).toBe('run-1');
    expect(results[2]).toHaveLength(1);
  });
});
