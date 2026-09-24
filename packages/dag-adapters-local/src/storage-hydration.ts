import { mkdir } from 'node:fs/promises';

import { hydrateCollection } from './json-collection-file.js';

import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';

/**
 * Bring a file-backed store's in-memory working set up to date with disk, exactly once.
 *
 * SINGLE-FLIGHT is the whole point, and it is why this is its own module. Without it, two calls on a
 * fresh instance — a restarted server handling its first two concurrent requests, which is precisely
 * the scenario DAG-003 exists for — both saw an uninitialised store and hydrated concurrently.
 * `hydrateCollection` only `.set()`s what it read and never clears, so a stale read landing AFTER
 * another call had written a newer value for the same key silently reverted it, and the next persist
 * wrote the reverted value back to disk. That is the same lost-update class `persistCollection` was
 * fixed for, one layer up in the lazy-init path.
 */
export interface IHydrationTargets {
  definitionsRootPath: string;
  runsRootPath: string;
  dagRunsFilePath: string;
  taskRunsFilePath: string;
  dagRuns: Map<string, IDagRun>;
  taskRuns: Map<string, ITaskRun>;
  taskRunKeyOf: (taskRun: ITaskRun) => string;
}

/** A gate that runs its work once and hands every later caller the same promise. */
export class HydrationGate {
  private hydration?: Promise<void>;

  public constructor(private readonly targets: IHydrationTargets) {}

  public async ensure(): Promise<void> {
    // A FAILED hydration must not be cached. `??=` alone kept a rejected promise forever, so one
    // transient `EACCES`/`ENOSPC`/`EMFILE` would break every later call on the instance until the
    // process restarted — silently, and on the very servers this durability work exists for. That is
    // a regression from the boolean this replaced, which stayed `false` on a failed `mkdir` and so
    // retried. Caught in review; the guard now clears itself so the next caller tries again.
    this.hydration ??= this.run().catch((error: unknown) => {
      this.hydration = undefined;
      throw error;
    });
    await this.hydration;
  }

  private async run(): Promise<void> {
    const { definitionsRootPath, runsRootPath, dagRunsFilePath, taskRunsFilePath } = this.targets;
    await mkdir(definitionsRootPath, { recursive: true });
    await mkdir(runsRootPath, { recursive: true });
    await hydrateCollection(dagRunsFilePath, this.targets.dagRuns, (run) => run.dagRunId);
    await hydrateCollection(taskRunsFilePath, this.targets.taskRuns, this.targets.taskRunKeyOf);
  }
}
