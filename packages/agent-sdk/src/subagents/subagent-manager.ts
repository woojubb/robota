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
    return { jobId: result.taskId, output: result.output };
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
      allowedTools: request.allowedTools,
      disallowedTools: request.disallowedTools,
      timeoutMs: request.timeoutMs,
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
      worktreePath: state.worktreePath,
      branchName: state.branchName,
      promptPreview: state.promptPreview ?? '',
      currentTool: state.currentAction,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      result: state.result?.output,
      error: state.error?.message,
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
        result: subagentHandle.result.then((result) => toBackgroundResult(result)),
        cancel: (reason?: string) => subagentHandle.cancel(reason),
      };

      if (subagentHandle.send) {
        const send = subagentHandle.send;
        handle.send = (input) => send(input.prompt ?? '');
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
  };
}

function toBackgroundResult(result: ISubagentJobResult): IBackgroundTaskResult {
  return {
    taskId: result.jobId,
    kind: 'agent',
    output: result.output,
  };
}
