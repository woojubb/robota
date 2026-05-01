import {
  runHooks,
  type IHookInput,
  type IHookTypeExecutor,
  type THookEvent,
  type THooksConfig,
} from '@robota-sdk/agent-core';
import type { TBackgroundPrimitive } from '../background-tasks/index.js';
import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentRunner,
} from './types.js';

export interface ISubagentWorktreePrepareRequest {
  jobId: string;
  cwd: string;
}

export interface IPreparedSubagentWorktree {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
}

export interface ISubagentWorktreeAdapter {
  prepare(request: ISubagentWorktreePrepareRequest): IPreparedSubagentWorktree;
  isClean(worktree: IPreparedSubagentWorktree): boolean;
  remove(worktree: IPreparedSubagentWorktree): void;
}

export interface IWorktreeSubagentRunnerOptions {
  runner: ISubagentRunner;
  worktreeAdapter: ISubagentWorktreeAdapter;
  hooks?: THooksConfig;
  hookTypeExecutors?: IHookTypeExecutor[];
}

export function createWorktreeSubagentRunner(
  options: IWorktreeSubagentRunnerOptions,
): ISubagentRunner {
  return new WorktreeSubagentRunner(options);
}

export class WorktreeSubagentRunner implements ISubagentRunner {
  constructor(private readonly options: IWorktreeSubagentRunnerOptions) {}

  start(job: ISubagentJobStart): ISubagentJobHandle {
    if (job.request.isolation !== 'worktree') {
      return this.options.runner.start(job);
    }

    const worktree = this.options.worktreeAdapter.prepare({
      jobId: job.jobId,
      cwd: job.request.cwd,
    });
    fireWorktreeHook(this.options, 'WorktreeCreate', job, worktree, false);
    const handle = this.startWrappedRunner(job, worktree);

    return this.createHandle(handle, job, worktree);
  }

  private startWrappedRunner(
    job: ISubagentJobStart,
    worktree: IPreparedSubagentWorktree,
  ): ISubagentJobHandle {
    try {
      return this.options.runner.start(createWorktreeJob(job, worktree));
    } catch (error) {
      cleanupCleanWorktree(this.options, worktree, job);
      throw error;
    }
  }

  private createHandle(
    handle: ISubagentJobHandle,
    job: ISubagentJobStart,
    worktree: IPreparedSubagentWorktree,
  ): ISubagentJobHandle {
    const wrapped: ISubagentJobHandle = {
      jobId: handle.jobId,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      result: handle.result
        .then((result) => finalizeWorktreeResult(result, this.options, worktree, job))
        .catch((error) => {
          cleanupCleanWorktree(this.options, worktree, job);
          throw error;
        }),
      cancel: (reason?: string) => handle.cancel(reason),
    };
    const send = handle.send;
    if (send) wrapped.send = (prompt) => send(prompt);
    return wrapped;
  }
}

function createWorktreeJob(
  job: ISubagentJobStart,
  worktree: IPreparedSubagentWorktree,
): ISubagentJobStart {
  return {
    ...job,
    request: {
      ...job.request,
      cwd: worktree.worktreePath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
    },
  };
}

function finalizeWorktreeResult(
  result: ISubagentJobResult,
  options: IWorktreeSubagentRunnerOptions,
  worktree: IPreparedSubagentWorktree,
  job: ISubagentJobStart,
): ISubagentJobResult {
  if (cleanupCleanWorktree(options, worktree, job)) {
    return {
      ...result,
      metadata: mergeMetadata(result.metadata, {
        isolation: 'worktree',
        worktreeRemoved: true,
      }),
    };
  }

  return {
    ...result,
    metadata: mergeMetadata(result.metadata, {
      isolation: 'worktree',
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
    }),
  };
}

function cleanupCleanWorktree(
  options: IWorktreeSubagentRunnerOptions,
  worktree: IPreparedSubagentWorktree,
  job: ISubagentJobStart,
): boolean {
  if (!options.worktreeAdapter.isClean(worktree)) return false;
  options.worktreeAdapter.remove(worktree);
  fireWorktreeHook(options, 'WorktreeRemove', job, worktree, true);
  return true;
}

function mergeMetadata(
  existing: Record<string, TBackgroundPrimitive> | undefined,
  next: Record<string, TBackgroundPrimitive>,
): Record<string, TBackgroundPrimitive> {
  return { ...(existing ?? {}), ...next };
}

function fireWorktreeHook(
  options: IWorktreeSubagentRunnerOptions,
  event: THookEvent,
  job: ISubagentJobStart,
  worktree: IPreparedSubagentWorktree,
  removed: boolean,
): void {
  const input: IHookInput = {
    session_id: job.request.parentSessionId,
    cwd: worktree.repoRoot,
    hook_event_name: event,
    tool_name: 'Agent',
    tool_input: {
      jobId: job.jobId,
      agentType: job.request.type,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      removed,
    },
  };
  void runHooks(options.hooks, event, input, options.hookTypeExecutors).catch(() => undefined);
}
