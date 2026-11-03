import {
  createLogger,
  runHooks,
  type IHookInput,
  type IHookTypeExecutor,
  type THookEvent,
  type THooksConfig,
} from '@robota-sdk/agent-core';
import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';

import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentRunner,
} from './types.js';
import type { TBackgroundPrimitive } from '../background-tasks/index.js';

const logger = createLogger('WorktreeSubagentRunner');

const SHORT_REVISION_LENGTH = 12;

export interface ISubagentWorktreePrepareRequest {
  taskId: string;
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
  private readonly hookTypeExecutors: readonly IHookTypeExecutor[];

  constructor(private readonly options: IWorktreeSubagentRunnerOptions) {
    this.hookTypeExecutors = options.hookTypeExecutors ?? [
      new CommandExecutor(),
      new HttpExecutor(),
    ];
  }

  start(job: ISubagentJobStart): ISubagentJobHandle {
    if (job.request.isolation !== 'worktree') {
      return this.options.runner.start(job);
    }

    // What the inner runner would refuse, it refuses before a worktree exists or a hook fires.
    this.options.runner.preflight?.(job);
    const worktree = this.options.worktreeAdapter.prepare({
      taskId: job.taskId,
      cwd: job.request.cwd,
    });
    const lifecycle = createWorktreeLifecycle(this.options, this.hookTypeExecutors, worktree, job);
    fireWorktreeHook(this.options, this.hookTypeExecutors, 'WorktreeCreate', job, worktree, false);
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
    // The transcript lives where the inner runner put it, whatever directory the job ran in, so the
    // paths, the paged read and the sealedness of the inner handle are this handle's too.
    const wrapped: ISubagentJobHandle = {
      taskId: handle.taskId,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      ...(handle.logPath !== undefined ? { logPath: handle.logPath } : {}),
      ...(handle.transcriptPath !== undefined ? { transcriptPath: handle.transcriptPath } : {}),
      ...(handle.transcriptSealed === true ? { transcriptSealed: true as const } : {}),
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
    const readLog = handle.readLog;
    if (readLog) wrapped.readLog = (cursor) => readLog(cursor);
    return wrapped;
  }
}

/**
 * ARCH-031: the worktree identity goes on the ENVELOPE, not back onto the request.
 *
 * The request models what the CALLER asked for, and the worktree does not exist when a caller builds
 * one — `prepare()` creates it here, inside the runner. This function is the ONLY producer of that
 * identity anywhere in the repo, which is why a rejected draft that read `worktreePath` as a caller
 * field and proposed deleting these lines would have severed the containment branch
 * `subagentExecutionRoot` guards.
 *
 * `request.cwd` is deliberately NOT rewritten any more. Setting both it and `worktreePath` gave the
 * execution root two carriers that could disagree, which is the duplication ARCH-010 exists to
 * prevent; the envelope plus `subagentExecutionRoot` is the single answer.
 *
 * The branch RELOCATES rather than disappears. It was on the request, where a caller could not know
 * it; it is a genuine fact about an isolated run, so it moves to the envelope beside the path. Nothing
 * in this tree reads it yet, and that is not a reason to drop it — this is a library, and
 * `project-structure.md` makes removing an unconsumed public surface a product decision rather than a
 * grep result.
 */
function createWorktreeJob(
  job: ISubagentJobStart,
  worktree: IPreparedSubagentWorktree,
): ISubagentJobStart {
  return { ...job, worktree: { path: worktree.worktreePath, branch: worktree.branchName } };
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
  hookTypeExecutors: readonly IHookTypeExecutor[],
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
      fireWorktreeHook(options, hookTypeExecutors, 'WorktreeRemove', job, worktree, true);
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
  hookTypeExecutors: readonly IHookTypeExecutor[],
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
      taskId: job.taskId,
      agentType: job.request.agentType,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      removed,
    },
  };
  // CORE-029: `.catch(() => undefined)` made a failing worktree hook indistinguishable from one
  // that ran. Fire-and-forget is deliberate — these are notifications, not vetoes
  // (packages/agent-cli/docs/design/subagent-wiring.md) — so the result stays unawaited, but the
  // failure is now sayable. Same shape as the session hooks in agent-session.
  void runHooks(options.hooks, event, input, hookTypeExecutors).catch((error: unknown) => {
    logger.warn('worktree hook failed', {
      event,
      taskId: job.taskId,
      worktreePath: worktree.worktreePath,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
