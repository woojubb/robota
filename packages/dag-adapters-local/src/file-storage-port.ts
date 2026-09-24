import {
  decideExecutionCommit,
  type TExecutionCommit,
  type IExecutionCommitResult,
} from '@robota-sdk/dag-core';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeSegment,
  definitionDirectoryPath,
  definitionFilePath,
  listDefinitionsForDagId,
  readDefinitionFromFile,
  saveDefinitionAtomically,
} from './definition-files.js';
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

  public constructor(private readonly storageRootPath: string) {
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
    await this.hydration.ensure();
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
    await this.ensureInitialized();
    await saveDefinitionAtomically(this.definitionsRootPath, definition);
  }

  public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
    await this.ensureInitialized();
    const filePath = definitionFilePath(this.definitionsRootPath, dagId, version);
    return readDefinitionFromFile(filePath);
  }

  public async listDefinitions(): Promise<IDagDefinition[]> {
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
  }
}
