import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HydrationGate } from '../storage-hydration.js';

import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';

/**
 * DAG-003, review round 3/4 — the gate that runs once, and must not remember a failure forever.
 *
 * Single-flight was added because two concurrent first calls hydrated at the same time and a stale
 * read could revert a newer write. Caching the promise with `??=` alone then introduced the opposite
 * defect: a REJECTED promise was cached too, so one transient `EACCES`/`ENOSPC` broke every later
 * call on the instance until the process restarted — a regression from the boolean it replaced, which
 * stayed `false` on failure and so retried.
 *
 * Both directions matter, and neither is visible from reading: the first is a lost update, the second
 * a store that stops working and says the same thing forever.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function targets(root: string) {
  return {
    definitionsRootPath: path.join(root, 'definitions'),
    runsRootPath: path.join(root, 'runs'),
    dagRunsFilePath: path.join(root, 'runs', 'dag-runs.json'),
    taskRunsFilePath: path.join(root, 'runs', 'task-runs.json'),
    dagRuns: new Map<string, IDagRun>(),
    taskRuns: new Map<string, ITaskRun>(),
    taskRunKeyOf: (taskRun: ITaskRun) => taskRun.taskRunId,
  };
}

function root(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'hydration-gate-')));
  dirs.push(dir);
  return dir;
}

describe('HydrationGate', () => {
  it('runs once for concurrent callers', async () => {
    const gate = new HydrationGate(targets(root()));
    await Promise.all([gate.ensure(), gate.ensure(), gate.ensure()]);
    // Reaching here without throwing is the claim: three callers, one hydration, no double mkdir.
    await expect(gate.ensure()).resolves.toBeUndefined();
  });

  it('RETRIES after a failure instead of caching the rejection', async () => {
    // A file where the runs DIRECTORY should be: `mkdir` fails with EEXIST-as-not-a-directory.
    const base = root();
    writeFileSync(path.join(base, 'runs'), 'not a directory');
    const gate = new HydrationGate(targets(base));

    await expect(gate.ensure()).rejects.toThrow();

    // The obstruction clears — as a transient EACCES/ENOSPC would.
    rmSync(path.join(base, 'runs'));
    // Against the defect this re-throws the cached rejection forever, and the store is dead until
    // the process restarts.
    await expect(gate.ensure()).resolves.toBeUndefined();
  });

  it('a second failure still rejects — clearing the cache is not swallowing the error', async () => {
    const base = root();
    writeFileSync(path.join(base, 'runs'), 'not a directory');
    const gate = new HydrationGate(targets(base));

    await expect(gate.ensure()).rejects.toThrow();
    await expect(gate.ensure()).rejects.toThrow();
  });
});
