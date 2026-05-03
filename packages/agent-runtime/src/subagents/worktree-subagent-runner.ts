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

const SHORT_REVISION_LENGTH = 12;

export interface ISubagentWorktreePrepareRequest {
  jobId: string;
  cwd: string;
}

export interface IPreparedSubagentWorktree {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  baseRevision?: string;
  parentStatus?: string;
}

export interface ISubagentWorktreeAdapter {
  prepare(request: ISubagentWorktreePrepareRequest): IPreparedSubagentWorktree;
  isClean(worktree: IPreparedSubagentWorktree): boolean;
  getStatus?(worktree: IPreparedSubagentWorktree): string;
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
    const lifecycle = createWorktreeLifecycle(this.options, worktree, job);
    fireWorktreeHook(this.options, 'WorktreeCreate', job, worktree, false);
    const handle = this.startWrappedRunner(job, worktree, lifecycle);

    return this.createHandle(handle, job, worktree, lifecycle);
  }

  private startWrappedRunner(
    job: ISubagentJobStart,
    worktree: IPreparedSubagentWorktree,
    lifecycle: IWorktreeLifecycle,
  ): ISubagentJobHandle {
    try {
      return this.options.runner.start(createWorktreeJob(job, worktree));
    } catch (error) {
      lifecycle.cleanupClean();
      throw error;
    }
  }

  private createHandle(
    handle: ISubagentJobHandle,
    job: ISubagentJobStart,
    worktree: IPreparedSubagentWorktree,
    lifecycle: IWorktreeLifecycle,
  ): ISubagentJobHandle {
    const wrapped: ISubagentJobHandle = {
      jobId: handle.jobId,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      result: handle.result
        .then((result) => finalizeWorktreeResult(result, this.options, worktree, lifecycle))
        .catch((error) => {
          lifecycle.cleanupClean();
          throw error;
        }),
      cancel: (reason?: string) => {
        const cancellation = handle.cancel(reason);
        void cancellation.then(() => lifecycle.cleanupClean()).catch(() => undefined);
        return cancellation;
      },
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
  lifecycle: IWorktreeLifecycle,
): ISubagentJobResult {
  if (lifecycle.cleanupClean()) {
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
    metadata: mergeMetadata(
      result.metadata,
      withOptionalMetadata({
        isolation: 'worktree',
        worktreeRemoved: false,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        worktreeBaseRevision: worktree.baseRevision,
        parentWorktreeStatus: worktree.parentStatus,
        worktreeStatus: getWorktreeStatus(options, worktree),
        worktreeNextAction: formatWorktreeNextAction(worktree),
      }),
    ),
  };
}

interface IWorktreeLifecycle {
  cleanupClean(): boolean;
}

function createWorktreeLifecycle(
  options: IWorktreeSubagentRunnerOptions,
  worktree: IPreparedSubagentWorktree,
  job: ISubagentJobStart,
): IWorktreeLifecycle {
  let removed = false;
  return {
    cleanupClean(): boolean {
      if (removed) return true;
      if (!options.worktreeAdapter.isClean(worktree)) return false;
      options.worktreeAdapter.remove(worktree);
      removed = true;
      fireWorktreeHook(options, 'WorktreeRemove', job, worktree, true);
      return true;
    },
  };
}

function getWorktreeStatus(
  options: IWorktreeSubagentRunnerOptions,
  worktree: IPreparedSubagentWorktree,
): string {
  const status = options.worktreeAdapter.getStatus?.(worktree).trimEnd();
  return status && status.length > 0 ? status : '(dirty worktree)';
}

function formatWorktreeNextAction(worktree: IPreparedSubagentWorktree): string {
  const revision = worktree.baseRevision
    ? ` based on ${worktree.baseRevision.slice(0, SHORT_REVISION_LENGTH)}`
    : '';
  const parentRisk = worktree.parentStatus?.trim()
    ? ' Parent checkout had uncommitted changes when this worktree was created; review the base before merging.'
    : '';
  return `Review ${worktree.worktreePath}, then merge or delete branch ${worktree.branchName}${revision}.${parentRisk}`;
}

function mergeMetadata(
  existing: Record<string, TBackgroundPrimitive> | undefined,
  next: Record<string, TBackgroundPrimitive>,
): Record<string, TBackgroundPrimitive> {
  return { ...(existing ?? {}), ...next };
}

function withOptionalMetadata(
  metadata: Record<string, TBackgroundPrimitive | undefined>,
): Record<string, TBackgroundPrimitive> {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, TBackgroundPrimitive] => {
      const value = entry[1];
      return value !== undefined;
    }),
  );
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
