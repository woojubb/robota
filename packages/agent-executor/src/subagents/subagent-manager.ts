import {
  BackgroundTaskError,
  BackgroundTaskManager,
  type IAgentBackgroundTaskRequest,
  type IBackgroundTaskHandle,
  type IBackgroundTaskManager,
  type TBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IBackgroundTaskState,
} from '../background-tasks/index.js';

import type {
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentRunner,
  ISubagentSpawnRequest,
} from './types.js';

export class SubagentManager implements ISubagentManager {
  private readonly backgroundTaskManager: IBackgroundTaskManager;
  private sequence = 0;
  private processSequence = 0;

  constructor(options: ISubagentManagerOptions) {
    this.backgroundTaskManager =
      options.backgroundTaskManager ?? this.createBackgroundTaskManager(options);
  }

  async spawn(request: ISubagentSpawnRequest): Promise<ISubagentJobState> {
    const state = await this.backgroundTaskManager.spawn(this.toBackgroundRequest(request));
    return this.toSubagentState(state);
  }

  /**
   * ARCH-031 subsumed ARCH-025's repair here, exactly as that item said it would. The hand-written
   * projection that dropped `usage` — in the very commit that added it — is gone; dropping `kind` is
   * the whole transformation, and there is no key list left to forget a field from.
   */
  async wait(taskId: string): Promise<ISubagentJobResult> {
    const { kind: _kind, ...result } = await this.backgroundTaskManager.wait(taskId);
    return result;
  }

  list(): ISubagentJobState[] {
    return this.backgroundTaskManager
      .list({ kind: 'agent' })
      .map((state) => this.toSubagentState(state));
  }

  get(taskId: string): ISubagentJobState | undefined {
    const state = this.backgroundTaskManager.get(taskId);
    return state?.kind === 'agent' ? this.toSubagentState(state) : undefined;
  }

  async cancel(taskId: string, reason?: string): Promise<void> {
    await this.backgroundTaskManager.cancel(taskId, reason);
  }

  async close(taskId: string): Promise<void> {
    await this.backgroundTaskManager.close(taskId);
  }

  async send(taskId: string, prompt: string): Promise<void> {
    await this.backgroundTaskManager.send(taskId, { prompt });
  }

  async shutdown(reason?: string): Promise<void> {
    await this.backgroundTaskManager.shutdown(reason);
  }

  getBackgroundTaskManager(): IBackgroundTaskManager {
    return this.backgroundTaskManager;
  }

  private createBackgroundTaskManager(options: ISubagentManagerOptions): IBackgroundTaskManager {
    if (!options.runner) {
      throw new BackgroundTaskError(
        'runner',
        'SubagentManager requires a runner or backgroundTaskManager',
      );
    }

    return new BackgroundTaskManager({
      runners: [
        createSubagentBackgroundRunner(options.runner),
        ...(options.backgroundTaskRunners ?? []),
      ],
      maxConcurrent: options.maxConcurrent,
      maxDepth: options.maxDepth,
      now: options.now,
      idFactory: options.idFactory ?? ((request) => this.nextTaskId(request)),
      agentIdleTimeoutMs: options.agentIdleTimeoutMs,
      agentMaxRuntimeMs: options.agentMaxRuntimeMs,
      agentOutputLimitBytes: options.agentOutputLimitBytes,
      agentMaxTextDeltas: options.agentMaxTextDeltas,
      repetitionWindow: options.repetitionWindow,
      repetitionThreshold: options.repetitionThreshold,
    });
  }

  private nextTaskId(request: TBackgroundTaskRequest): string {
    if (request.kind === 'agent') {
      this.sequence += 1;
      return `agent_${this.sequence}`;
    }
    this.processSequence += 1;
    return `process_${this.processSequence}`;
  }

  /**
   * ARCH-031: a spread, not a 20-key hand-copy. `ISubagentSpawnRequest` IS
   * `Omit<IAgentBackgroundTaskRequest, 'kind'>`, so the only thing this hop adds is the discriminant
   * the seam fixes. The copy this replaced dropped `parentTaskId` and `providerProfile` and would have
   * dropped the next field added too — nothing checked it for totality.
   */
  private toBackgroundRequest(request: ISubagentSpawnRequest): IAgentBackgroundTaskRequest {
    return { kind: 'agent', ...request };
  }

  private toSubagentState(state: IBackgroundTaskState): ISubagentJobState {
    return {
      id: state.id,
      type: state.agentType ?? state.label,
      label: state.label,
      parentSessionId: state.parentSessionId,
      // SELFHOST-012: `paused` is a scheduled-task-only status; a subagent is never a scheduled task, so this
      // branch is unreachable — narrowed here only to keep the projection assignable to TSubagentJobStatus.
      status: state.status === 'paused' ? 'sleeping' : state.status,
      mode: state.mode,
      depth: state.depth,
      pid: state.pid,
      cwd: state.cwd,
      isolation: state.isolation,
      worktreePath: state.worktreePath,
      branchName: state.branchName,
      worktreeStatus: state.worktreeStatus,
      worktreeNextAction: state.worktreeNextAction,
      worktreeBaseRevision: state.worktreeBaseRevision,
      parentWorktreeStatus: state.parentWorktreeStatus,
      promptPreview: state.promptPreview ?? '',
      currentTool: state.currentAction,
      logPath: state.logPath,
      transcriptPath: state.transcriptPath,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      timeoutReason: state.timeoutReason,
      result: state.result?.output,
      error: state.error?.message,
      metadata: state.metadata,
    };
  }
}

function createSubagentBackgroundRunner(runner: ISubagentRunner): IBackgroundTaskRunner {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      if (task.request.kind !== 'agent') {
        throw new BackgroundTaskError('runner', `Invalid subagent task kind: ${task.request.kind}`);
      }

      const subagentHandle = runner.start({
        taskId: task.taskId,
        request: toSubagentStartRequest(task.request),
        emit: task.emit,
      });
      const handle: IBackgroundTaskHandle = {
        taskId: task.taskId,
        pid: subagentHandle.pid,
        logPath: subagentHandle.logPath,
        transcriptPath: subagentHandle.transcriptPath,
        result: subagentHandle.result.then((result) => toBackgroundResult(result)),
        cancel: (reason?: string) => subagentHandle.cancel(reason),
      };

      if (subagentHandle.send) {
        const send = subagentHandle.send;
        handle.send = (input) => send(input.prompt ?? '');
      }
      if (subagentHandle.readLog) {
        const readLog = subagentHandle.readLog;
        handle.readLog = (cursor) => readLog(cursor);
      }

      return handle;
    },
  };
}

/**
 * ARCH-031: destructuring, not a 20-key hand-copy. Dropping `kind` is the entire transformation, and
 * the compiler now guarantees the rest is carried. The copy this replaced omitted `parentTaskId` and
 * `providerProfile`, and the CORE-025 comment it carried — "previously dropped here → dead field" —
 * recorded the third field the same hop had already lost.
 */
function toSubagentStartRequest(request: IAgentBackgroundTaskRequest): ISubagentSpawnRequest {
  const { kind: _kind, ...spawnRequest } = request;
  return spawnRequest;
}

/**
 * ARCH-031: a spread. `ISubagentJobResult` IS
 * `Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>`, so the only addition is the
 * discriminant. `usage` cannot be dropped here any more — there is no key list to forget it from,
 * which is what the ARCH-025 repair had to add back by hand.
 */
function toBackgroundResult(result: ISubagentJobResult): IBackgroundTaskResult {
  return { kind: 'agent', ...result };
}
