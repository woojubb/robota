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

/**
 * ARCH-031: the keys `toSubagentState` passes through untouched — every task-state key that is
 * neither transformed by that hop nor deliberately withheld from a subagent job.
 */
type TCarriedSubagentStateKey = Exclude<
  keyof IBackgroundTaskState,
  // Transformed by the hop.
  | 'agentType'
  | 'status'
  | 'promptPreview'
  | 'currentAction'
  | 'result'
  | 'error'
  // Withheld — task-only, with no subagent-job meaning.
  | 'kind'
  | 'parentTaskId'
  | 'lastActivityAt'
  | 'commandPreview'
  | 'unread'
  | 'nextFireAt'
  | 'schedule'
>;

/** The keys `toSubagentState` writes itself, rather than passing through. */
type TWrittenSubagentStateKey =
  'type' | 'status' | 'promptPreview' | 'currentTool' | 'result' | 'error';

/**
 * The floor, both directions. `TCarriedLeak` catches a key added to `IBackgroundTaskState` and left
 * undecided — the spread would ship it on a transport-serialised object that never declared it, and
 * TypeScript does not excess-property-check spreads. `TDeclaredGap` catches the opposite: a key
 * added to `ISubagentJobState` that nothing carries or writes. Either one stops being `never` and
 * this file stops compiling.
 */
type TCarriedLeak = Exclude<TCarriedSubagentStateKey, keyof ISubagentJobState>;
type TDeclaredGap = Exclude<
  keyof ISubagentJobState,
  TCarriedSubagentStateKey | TWrittenSubagentStateKey
>;
/**
 * Asserting via a CONSTRAINT, not an assignment: `never` is assignable to every type, so
 * `const x: TCarriedLeak = undefined as never` would have been a check that cannot fail. Only
 * `never` satisfies `T extends never`.
 */
type TAssertNever<T extends never> = T;
export type TNoCarriedLeak = TAssertNever<TCarriedLeak>;
export type TNoDeclaredGap = TAssertNever<TDeclaredGap>;

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

  /**
   * ARCH-031: the state hop of the same seam, and the last hand-written literal on it. It was a
   * 24-key copy into a `Pick`-derived type, so the ~17 optional keys could be dropped silently —
   * adding one to `ISubagentJobState`'s `Pick<>` list compiled clean and carried nothing. Now the
   * pass-through half is the rest of the destructuring, so it is total by construction: only the
   * keys this hop genuinely TRANSFORMS or deliberately WITHHOLDS are named, and each one that is
   * withheld is a task-only concept a subagent job has no reader for.
   *
   * The spread makes the pass-through a blacklist, so the floor below closes the other direction: a
   * field added to `IBackgroundTaskState` and NOT added to `ISubagentJobState`'s `Pick<>` would flow
   * through `...carried` onto a transport-serialised object, and TypeScript does not
   * excess-property-check spreads. `TCarriedSubagentStateKey` is a compile error the moment the two
   * sets disagree, in either direction.
   */
  private toSubagentState(state: IBackgroundTaskState): ISubagentJobState {
    const {
      // Transformed by this hop.
      agentType,
      status,
      promptPreview,
      currentAction,
      result,
      error,
      // Withheld — task-only, with no subagent-job meaning.
      kind: _kind,
      parentTaskId: _parentTaskId,
      lastActivityAt: _lastActivityAt,
      commandPreview: _commandPreview,
      unread: _unread,
      nextFireAt: _nextFireAt,
      schedule: _schedule,
      ...carried
    } = state;
    return {
      ...carried,
      type: agentType ?? carried.label,
      // SELFHOST-012: `paused` is a scheduled-task-only status; a subagent is never a scheduled task, so this
      // branch is unreachable — narrowed here only to keep the projection assignable to TSubagentJobStatus.
      status: status === 'paused' ? 'sleeping' : status,
      promptPreview: promptPreview ?? '',
      currentTool: currentAction,
      result: result?.output,
      error: error?.message,
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
