import {
  BackgroundTaskError,
  BackgroundTaskManager,
  type IAgentBackgroundTaskRequest,
  type IBackgroundTaskHandle,
  type IBackgroundTaskManager,
  type IBackgroundTaskRequest,
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

  async wait(jobId: string): Promise<ISubagentJobResult> {
    const result = await this.backgroundTaskManager.wait(jobId);
    return { jobId: result.taskId, output: result.output, metadata: result.metadata };
  }

  list(): ISubagentJobState[] {
    return this.backgroundTaskManager
      .list({ kind: 'agent' })
      .map((state) => this.toSubagentState(state));
  }

  get(jobId: string): ISubagentJobState | undefined {
    const state = this.backgroundTaskManager.get(jobId);
    return state?.kind === 'agent' ? this.toSubagentState(state) : undefined;
  }

  async cancel(jobId: string, reason?: string): Promise<void> {
    await this.backgroundTaskManager.cancel(jobId, reason);
  }

  async close(jobId: string): Promise<void> {
    await this.backgroundTaskManager.close(jobId);
  }

  async send(jobId: string, prompt: string): Promise<void> {
    await this.backgroundTaskManager.send(jobId, { prompt });
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

  private nextTaskId(request: IBackgroundTaskRequest): string {
    if (request.kind === 'agent') {
      this.sequence += 1;
      return `agent_${this.sequence}`;
    }
    this.processSequence += 1;
    return `process_${this.processSequence}`;
  }

  private toBackgroundRequest(request: ISubagentSpawnRequest): IAgentBackgroundTaskRequest {
    return {
      kind: 'agent',
      agentType: request.type,
      label: request.label,
      parentSessionId: request.parentSessionId,
      mode: request.mode,
      depth: request.depth,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model,
      isolation: request.isolation,
      allowedTools: request.allowedTools,
      disallowedTools: request.disallowedTools,
      timeoutMs: request.timeoutMs,
      idleTimeoutMs: request.idleTimeoutMs,
      maxRuntimeMs: request.maxRuntimeMs,
      outputLimitBytes: request.outputLimitBytes,
      maxTextDeltas: request.maxTextDeltas,
      repetitionWindow: request.repetitionWindow,
      repetitionThreshold: request.repetitionThreshold,
      metadata: request.metadata,
      permissionPolicy: 'inherit-allowlist',
    };
  }

  private toSubagentState(state: IBackgroundTaskState): ISubagentJobState {
    return {
      id: state.id,
      type: state.agentType ?? state.label,
      label: state.label,
      parentSessionId: state.parentSessionId,
      status: state.status,
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
        jobId: task.taskId,
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

function toSubagentStartRequest(request: IAgentBackgroundTaskRequest): ISubagentSpawnRequest {
  return {
    type: request.agentType,
    label: request.label,
    parentSessionId: request.parentSessionId,
    mode: request.mode,
    depth: request.depth,
    cwd: request.cwd,
    prompt: request.prompt,
    model: request.model,
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
    timeoutMs: request.timeoutMs,
    idleTimeoutMs: request.idleTimeoutMs,
    maxRuntimeMs: request.maxRuntimeMs,
    outputLimitBytes: request.outputLimitBytes,
    maxTextDeltas: request.maxTextDeltas,
    repetitionWindow: request.repetitionWindow,
    repetitionThreshold: request.repetitionThreshold,
    isolation: request.isolation,
    metadata: request.metadata,
  };
}

function toBackgroundResult(result: ISubagentJobResult): IBackgroundTaskResult {
  return {
    taskId: result.jobId,
    kind: 'agent',
    output: result.output,
    metadata: result.metadata,
  };
}
