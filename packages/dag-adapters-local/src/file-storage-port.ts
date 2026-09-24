import {
  decideExecutionCommit,
  type TExecutionCommit,
  type IExecutionCommitResult,
} from '@robota-sdk/dag-core';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeSegment,
  definitionDirectoryPath,
  definitionFilePath,
  listDefinitionsForDagId,
  readDefinitionFromFile,
  saveDefinitionAtomically,
} from './definition-files.js';
import {
  FileStoreOwnerConflictError,
  FileStoreOwnerLock,
  resolveOwnerLockTiming,
} from './file-store-owner-lock.js';
import type { IFileStoreOwnerLockOptions } from './file-store-owner-lock.js';
import { persistCollection } from './json-collection-file.js';
import { HydrationGate } from './storage-hydration.js';

import {
  applyTaskAttemptIncrement,
  applyTaskRunLease,
  applyTaskRunSnapshots,
  selectStaleRunningTaskRuns,
} from './task-run-recovery.js';
import type {
  IDagDefinition,
  IDagRun,
  IDagError,
  IStoragePort,
  ITaskRun,
  TDagRunStatus,
  TTaskRunStatus,
} from '@robota-sdk/dag-core';

function buildTaskRunKey(dagRunId: string, taskRunId: string): string {
  return `${dagRunId}:${taskRunId}`;
}

/**
 * Tuning for the storage root's heartbeat lease (see {@link FileStoreOwnerLock}). Production callers
 * do not need this — it exists so tests can drive the lease with fake timers instead of real waits.
 */
export type IFileStoragePortOwnerLockOptions = Pick<
  IFileStoreOwnerLockOptions,
  'refreshIntervalMs' | 'leaseTimeoutMs' | 'selfExpiryMs' | 'afterRefresh'
>;

/** Thrown by any operation on a `FileStoragePort` after `close()` — closing is final. */
export class FileStoragePortClosedError extends Error {
  public constructor(storageRootPath: string) {
    super(`FileStoragePort for ${storageRootPath} is closed and can no longer be used`);
    this.name = 'FileStoragePortClosedError';
  }
}

export class FileStoragePort implements IStoragePort {
  private readonly definitionsRootPath: string;
  private readonly runsRootPath: string;
  private readonly dagRunsFilePath: string;
  private readonly taskRunsFilePath: string;
  private readonly hydration: HydrationGate;
  private readonly dagRuns = new Map<string, IDagRun>();
  private readonly taskRuns = new Map<string, ITaskRun>();
  private runStateTail: Promise<void> = Promise.resolve();
  private runStateFailure: { error: unknown } | undefined;
  private ownerLock: FileStoreOwnerLock | undefined;
  private ownerLockAcquisition: Promise<void> | undefined;
  /** Set when the heartbeat lease discovers this instance no longer owns the root (a real takeover,
   *  or this instance's own self-expiry). PERMANENT: poisons every later operation instead of letting
   *  this instance keep writing as an unaccounted-for second owner — the same durability posture as
   *  `runStateFailure` for a failed persist. There is no recovery; a caller must open a new instance. */
  private ownershipLostError: unknown;
  /** Set by `close()`. Final — checked at admission time for every operation (see `assertNotClosed`
   *  and `withRunState`), not inside `ensureInitialized`, so a run/task write already queued before
   *  `close()` was called is not rejected once its turn comes up after `close()` set this. */
  private closed = false;
  /** Definition writes in flight, so `close()` can wait for them (definitions are not admitted through
   *  the run/task queue, so they need their own tracking to make the same "close() waits" guarantee). */
  private readonly pendingDefinitionWrites = new Set<Promise<unknown>>();

  public constructor(
    private readonly storageRootPath: string,
    private readonly ownerLockOptions: IFileStoragePortOwnerLockOptions = {},
  ) {
    resolveOwnerLockTiming(ownerLockOptions);
    this.definitionsRootPath = path.join(this.storageRootPath, 'definitions');
    this.runsRootPath = path.join(this.storageRootPath, 'runs');
    this.dagRunsFilePath = path.join(this.runsRootPath, 'dag-runs.json');
    this.taskRunsFilePath = path.join(this.runsRootPath, 'task-runs.json');
    this.hydration = new HydrationGate({
      definitionsRootPath: this.definitionsRootPath,
      runsRootPath: this.runsRootPath,
      dagRunsFilePath: this.dagRunsFilePath,
      taskRunsFilePath: this.taskRunsFilePath,
      dagRuns: this.dagRuns,
      taskRuns: this.taskRuns,
      taskRunKeyOf: (taskRun) => buildTaskRunKey(taskRun.dagRunId, taskRun.taskRunId),
    });
  }

  /**
   * DAG-003: hydrate runs and task runs from disk on first use.
   *
   * They used to live only in these `Map`s. This is the DEFAULT storage in `createDagFramework`, so
   * `dag-runtime-server` and `dag-mcp-server` both used it unoverridden and lost every run on
   * restart — from a store whose name is `File`. The cost landed on DAG-001's idle sweep, which
   * recovers an abandoned task by reading its `status` and `leaseUntil`: a real crash lost exactly
   * those, leaving a recovery path with no durable state under it.
   *
   * The Maps stay as the working set, so every existing query — `listStaleRunningTaskRuns`,
   * `applyTaskRunLease`, the run-key lookup — is unchanged. Only their lifetime moves.
   */
  private async ensureInitialized(): Promise<void> {
    // `closed` is deliberately NOT checked here — see the field doc. Admission is checked once, at
    // the synchronous entry point of each public operation (`assertNotClosed`, or `withRunState` for
    // queued run/task ops), before this method's (possibly deferred) execution.
    if (this.ownershipLostError !== undefined) throw this.ownershipLostError;
    await this.acquireOwnerLockOnce();
    // Before every operation, not only on the heartbeat: a stall delays a queued persist as much as it
    // delays the timer, so whichever resumes first must catch a displaced or self-expired owner.
    await this.ownerLock?.verifyOwnership();
    if (this.ownershipLostError !== undefined) throw this.ownershipLostError;
    await this.hydration.ensure();
  }

  /** Admission-time guard for operations NOT queued through `withRunState` (definitions): `closed` is
   *  final, so any call made after `close()` is rejected immediately, before it can enqueue any work
   *  `close()` would then have to wait for. */
  private assertNotClosed(): void {
    if (this.closed) throw new FileStoragePortClosedError(this.storageRootPath);
  }

  /** Track a definition WRITE so `close()` can wait for it — definitions are not admitted through the
   *  run/task queue, so they need their own bookkeeping to get the same "close() waits" guarantee. */
  private trackDefinitionWrite<T>(work: Promise<T>): Promise<T> {
    this.pendingDefinitionWrites.add(work);
    const untrack = (): void => {
      this.pendingDefinitionWrites.delete(work);
    };
    work.then(untrack, untrack);
    return work;
  }

  /**
   * Acquire this root's exclusive owner lock before any hydration or persistence — a conflicting
   * owner must fail here, before it can touch the collection files at all.
   *
   * Single-flight with clear-on-failure, matching {@link HydrationGate}: a transient failure (the
   * root not existing yet, a permission error) must not be cached forever, but a genuine ownership
   * conflict rejects every operation on this instance until the caller retries — by which point the
   * other owner may have released it.
   */
  private async acquireOwnerLockOnce(): Promise<void> {
    if (this.ownerLock) return;
    this.ownerLockAcquisition ??= (async (): Promise<void> => {
      await mkdir(this.storageRootPath, { recursive: true });
      this.ownerLock = await FileStoreOwnerLock.acquire(this.storageRootPath, {
        ...this.ownerLockOptions,
        onOwnershipLost: (reason) => {
          // The lease lapsed and another owner took the root over (e.g. after a long event-loop
          // stall), or this instance self-expired. Either way this is PERMANENT: this instance must
          // stop writing rather than silently continue as a second owner — every later operation now
          // rejects, with no recovery. The owning process must restart, or otherwise open a new
          // `FileStoragePort` instance, to use this storage root again.
          this.ownershipLostError = new FileStoreOwnerConflictError(
            `file store owner lock for ${this.storageRootPath} was lost: ${reason}. This instance is permanently unusable for this root — the owning process must restart or open a new instance to use it again.`,
          );
        },
      });
    })().catch((error: unknown) => {
      this.ownerLockAcquisition = undefined;
      throw error;
    });
    await this.ownerLockAcquisition;
  }

  /**
   * Release this instance's ownership of the storage root and make the instance unusable — closing is
   * final. A NEW operation after this rejects with `FileStoragePortClosedError`, including one already
   * poisoned by a lost lease: `close()` is a deliberate, permanent shutdown, not a reset. An operation
   * already admitted BEFORE `close()` was called (queued run/task work, or an in-flight definition
   * write) is not rejected by this — `close()` waits for it instead, so a write that had already
   * started is never silently dropped just because it happened to still be in flight.
   *
   * Waits for: any run/task write already queued (`runStateTail`); any definition write already in
   * flight (`pendingDefinitionWrites`); and any owner-lock acquisition already in flight — so releasing
   * ownership never races work that started before `close()` was called. Safe to call more than once,
   * and safe to call on an instance that never successfully acquired the lock.
   */
  public async close(): Promise<void> {
    this.closed = true;
    // `withRunState`'s tail chain absorbs its own operation's outcome (`.then(() => undefined, () =>
    // undefined)`), so awaiting it here never itself rejects.
    await this.runStateTail;
    await Promise.allSettled([...this.pendingDefinitionWrites]);
    if (this.ownerLockAcquisition) await this.ownerLockAcquisition.catch(() => undefined);
    await this.ownerLock?.release();
    this.ownerLock = undefined;
    this.ownerLockAcquisition = undefined;
  }

  private async persistDagRuns(): Promise<void> {
    try {
      await persistCollection(this.dagRunsFilePath, this.dagRuns.values());
    } catch (error) {
      this.runStateFailure = { error };
      throw error;
    }
  }

  private async persistTaskRuns(): Promise<void> {
    try {
      await persistCollection(this.taskRunsFilePath, this.taskRuns.values());
    } catch (error) {
      this.runStateFailure = { error };
      throw error;
    }
  }

  /** All run/task observations and writes share the same durability boundary. */
  private withRunState<T>(operation: () => Promise<T>): Promise<T> {
    // Admission-time, not execution-time: this runs synchronously when the caller invokes the public
    // method, before `operation` is ever chained onto the queue. A call admitted here is queued and
    // will run to completion even if `close()` sets `closed` before its turn comes up — `close()`
    // awaits `runStateTail`, so it already accounts for exactly this work.
    this.assertNotClosed();
    const pending = this.runStateTail.then(() => {
      if (this.runStateFailure !== undefined) throw this.runStateFailure.error;
      return operation();
    });
    // Handle the queue's rejection separately from the caller's result, avoiding an unobserved
    // rejected tail. Persistence failures poison later operations; initialization failures keep
    // the hydration gate's existing retry behavior because no state mutation has been admitted.
    this.runStateTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  public commitExecution(
    dagRunId: string,
    mutation: TExecutionCommit,
  ): Promise<IExecutionCommitResult> {
    return this.withRunState(() => this.persistExecutionCommit(dagRunId, mutation));
  }

  private async persistExecutionCommit(
    dagRunId: string,
    mutation: TExecutionCommit,
  ): Promise<IExecutionCommitResult> {
    await this.ensureInitialized();
    const tasks = [...this.taskRuns.values()].filter((task) => task.dagRunId === dagRunId);
    const decision = decideExecutionCommit(this.dagRuns.get(dagRunId), tasks, mutation);
    if (decision.dagRun) this.dagRuns.set(dagRunId, decision.dagRun);
    if (decision.taskRun)
      this.taskRuns.set(buildTaskRunKey(dagRunId, decision.taskRun.taskRunId), decision.taskRun);
    if (decision.dagRun) await this.persistDagRuns();
    if (decision.taskRun) await this.persistTaskRuns();
    return decision.result;
  }

  public async saveDefinition(definition: IDagDefinition): Promise<void> {
    this.assertNotClosed();
    return this.trackDefinitionWrite(
      (async (): Promise<void> => {
        await this.ensureInitialized();
        await saveDefinitionAtomically(this.definitionsRootPath, definition);
      })(),
    );
  }

  public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
    this.assertNotClosed();
    await this.ensureInitialized();
    const filePath = definitionFilePath(this.definitionsRootPath, dagId, version);
    return readDefinitionFromFile(filePath);
  }

  public async listDefinitions(): Promise<IDagDefinition[]> {
    this.assertNotClosed();
    await this.ensureInitialized();
    const dagIdDirectories = await readdir(this.definitionsRootPath, { withFileTypes: true });
    const definitions: IDagDefinition[] = [];
    for (const dagIdDirectory of dagIdDirectories) {
      if (!dagIdDirectory.isDirectory()) {
        continue;
      }
      const decodedDagId = decodeSegment(dagIdDirectory.name);
      const definitionsForDagId = await this.listDefinitionsByDagId(decodedDagId);
      definitions.push(...definitionsForDagId);
    }
    return definitions.sort((a, b) => a.dagId.localeCompare(b.dagId) || a.version - b.version);
  }

  public async listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]> {
    this.assertNotClosed();
    await this.ensureInitialized();
    return listDefinitionsForDagId(this.definitionsRootPath, dagId);
  }

  public async getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined> {
    const definitionsByDagId = await this.listDefinitionsByDagId(dagId);
    const publishedDefinitions = definitionsByDagId.filter(
      (definition) => definition.status === 'published',
    );
    if (publishedDefinitions.length === 0) {
      return undefined;
    }
    return publishedDefinitions[publishedDefinitions.length - 1];
  }

  public async createDagRun(dagRun: IDagRun): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      this.dagRuns.set(dagRun.dagRunId, dagRun);
      await this.persistDagRuns();
    });
  }

  public async getDagRun(dagRunId: string): Promise<IDagRun | undefined> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      return this.dagRuns.get(dagRunId);
    });
  }

  public async listDagRuns(): Promise<IDagRun[]> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      return [...this.dagRuns.values()].sort((a, b) => a.dagRunId.localeCompare(b.dagRunId));
    });
  }

  public async getDagRunByRunKey(runKey: string): Promise<IDagRun | undefined> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      for (const dagRun of this.dagRuns.values()) {
        if (dagRun.runKey === runKey) {
          return dagRun;
        }
      }
      return undefined;
    });
  }

  public async updateDagRunStatus(
    dagRunId: string,
    status: TDagRunStatus,
    endedAt?: string,
  ): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      const currentDagRun = this.dagRuns.get(dagRunId);
      if (!currentDagRun) {
        return;
      }
      this.dagRuns.set(dagRunId, {
        ...currentDagRun,
        status,
        endedAt,
      });
      await this.persistDagRuns();
    });
  }

  public async deleteDagRun(dagRunId: string): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      this.dagRuns.delete(dagRunId);
      await this.persistDagRuns();
    });
  }

  public async createTaskRun(taskRun: ITaskRun): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      this.taskRuns.set(buildTaskRunKey(taskRun.dagRunId, taskRun.taskRunId), taskRun);
      await this.persistTaskRuns();
    });
  }

  public async getTaskRun(taskRunId: string): Promise<ITaskRun | undefined> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      for (const taskRun of this.taskRuns.values()) {
        if (taskRun.taskRunId === taskRunId) {
          return taskRun;
        }
      }
      return undefined;
    });
  }

  public async listTaskRunsByDagRunId(dagRunId: string): Promise<ITaskRun[]> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      const taskRuns: ITaskRun[] = [];
      for (const taskRun of this.taskRuns.values()) {
        if (taskRun.dagRunId === dagRunId) {
          taskRuns.push(taskRun);
        }
      }
      return taskRuns;
    });
  }

  public async deleteTaskRunsByDagRunId(dagRunId: string): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
        if (taskRun.dagRunId === dagRunId) {
          this.taskRuns.delete(taskRunKey);
        }
      }
      await this.persistTaskRuns();
    });
  }

  public async updateTaskRunStatus(
    taskRunId: string,
    status: TTaskRunStatus,
    error?: IDagError,
  ): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
        if (taskRun.taskRunId !== taskRunId) {
          continue;
        }
        this.taskRuns.set(taskRunKey, {
          ...taskRun,
          status,
          ...(['failed', 'cancelled', 'queued'].includes(status)
            ? {
                reservedCredits: undefined,
                reservationAttempt: undefined,
                reservationOwner: undefined,
              }
            : {}),
          errorCode: error?.code,
          errorMessage: error?.message,
        });
        await this.persistTaskRuns();
        return;
      }
    });
  }

  public async setTaskRunLease(
    taskRunId: string,
    leaseOwner?: string,
    leaseUntil?: string,
  ): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      applyTaskRunLease(this.taskRuns, taskRunId, leaseOwner, leaseUntil);
      // The lease is half of what the DAG-001 sweep reads after a crash; persisting the status without
      // it would leave the sweeper unable to tell an abandoned task from a live one.
      await this.persistTaskRuns();
    });
  }

  public async listStaleRunningTaskRuns(asOfIso: string): Promise<ITaskRun[]> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      return selectStaleRunningTaskRuns(this.taskRuns, asOfIso);
    });
  }

  public async saveTaskRunSnapshots(
    taskRunId: string,
    inputSnapshot?: string,
    outputSnapshot?: string,
    estimatedCredits?: number,
    totalCredits?: number,
  ): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      const changed = applyTaskRunSnapshots(
        this.taskRuns,
        taskRunId,
        inputSnapshot,
        outputSnapshot,
        estimatedCredits,
        totalCredits,
      );
      if (changed) await this.persistTaskRuns();
    });
  }

  public async incrementTaskAttempt(taskRunId: string): Promise<void> {
    return this.withRunState(async () => {
      await this.ensureInitialized();
      // The retry LIMIT is counted from this. Left unpersisted, a crash mid-retry-loop reset the count
      // on restart and a task could retry past its configured maximum — worse than losing the value,
      // because the store then actively reports a wrong one.
      if (applyTaskAttemptIncrement(this.taskRuns, taskRunId)) await this.persistTaskRuns();
    });
  }

  public async deleteDefinition(dagId: string, version: number): Promise<void> {
    this.assertNotClosed();
    return this.trackDefinitionWrite(
      (async (): Promise<void> => {
        await this.ensureInitialized();
        const filePath = definitionFilePath(this.definitionsRootPath, dagId, version);
        await rm(filePath, { force: true });
        const directoryPath = definitionDirectoryPath(this.definitionsRootPath, dagId);
        try {
          const entries = await readdir(directoryPath);
          if (entries.length === 0) {
            await rm(directoryPath, { recursive: true, force: true });
          }
        } catch {
          // Directory cleanup is best-effort only.
        }
      })(),
    );
  }
}
