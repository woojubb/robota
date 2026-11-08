import {
  BackgroundTaskError,
  type IAgentBackgroundTaskState,
  type IBackgroundTaskError,
  type IBackgroundTaskHandle,
  type IBackgroundTaskListFilter,
  type TBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskState,
  type IProcessBackgroundTaskState,
  type IScheduledBackgroundTaskState,
  type IToolInvocationBackgroundTaskState,
  type TBackgroundPrimitive,
  type TBackgroundTaskKind,
  type TBackgroundTaskStatus,
  type TBackgroundTaskTimeoutReason,
} from './types.js';

export interface ITrackedBackgroundTask {
  state: IBackgroundTaskState;
  request: TBackgroundTaskRequest;
  completion: Promise<IBackgroundTaskResult>;
  resolve: (result: IBackgroundTaskResult) => void;
  reject: (error: BackgroundTaskError) => void;
  handle?: IBackgroundTaskHandle;
  idleTimer?: ReturnType<typeof setTimeout>;
  maxRuntimeTimer?: ReturnType<typeof setTimeout>;
  recentText: string;
  outputBytes: number;
  textDeltas: number;
  lastNormalizedDelta?: string;
  repeatedDeltaCount: number;
}

const TIMEOUT_REASONS = new Set<TBackgroundTaskTimeoutReason>([
  'idle',
  'max_runtime',
  'output_limit',
  'repetition',
  'stale_worker',
]);
const MIN_REPEATED_SENTENCE_LENGTH = 12;

export function createDeferred(): {
  promise: Promise<IBackgroundTaskResult>;
  resolve: (result: IBackgroundTaskResult) => void;
  reject: (error: BackgroundTaskError) => void;
} {
  let resolveFn: (result: IBackgroundTaskResult) => void = () => {};
  let rejectFn: (error: BackgroundTaskError) => void = () => {};
  const promise = new Promise<IBackgroundTaskResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.catch(() => {});
  return { promise, resolve: resolveFn, reject: rejectFn };
}

export function createRunnerError(message: string): BackgroundTaskError {
  return new BackgroundTaskError('runner', message);
}

export function normalizeBackgroundTaskError(error: Error | string): IBackgroundTaskError {
  if (error instanceof BackgroundTaskError) {
    return {
      category: error.category,
      message: error.message,
      recoverable: error.recoverable,
    };
  }
  const message = error instanceof Error ? error.message : error;
  return { category: 'runner', message, recoverable: true };
}

export function toBackgroundTaskErrorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

export function applyBackgroundTaskResultMetadataToState(
  state: IBackgroundTaskState,
  result: IBackgroundTaskResult,
): void {
  // #2079: the worktree-isolation fields are agent-only on the discriminated state — their sole
  // producer is `worktree-subagent-runner.ts`, which only ever starts an agent-kind task.
  if (state.kind === 'agent') {
    const worktreePath = result.metadata?.['worktreePath'];
    if (typeof worktreePath === 'string') state.worktreePath = worktreePath;
    const branchName = result.metadata?.['branchName'];
    if (typeof branchName === 'string') state.branchName = branchName;
    const worktreeStatus = result.metadata?.['worktreeStatus'];
    if (typeof worktreeStatus === 'string') state.worktreeStatus = worktreeStatus;
    const worktreeNextAction = result.metadata?.['worktreeNextAction'];
    if (typeof worktreeNextAction === 'string') state.worktreeNextAction = worktreeNextAction;
    const worktreeBaseRevision = result.metadata?.['worktreeBaseRevision'];
    if (typeof worktreeBaseRevision === 'string') state.worktreeBaseRevision = worktreeBaseRevision;
    const parentWorktreeStatus = result.metadata?.['parentWorktreeStatus'];
    if (typeof parentWorktreeStatus === 'string') state.parentWorktreeStatus = parentWorktreeStatus;
  }
  const logPath = result.metadata?.['logPath'];
  if (typeof logPath === 'string') state.logPath = logPath;
  const transcriptPath = result.metadata?.['transcriptPath'];
  if (typeof transcriptPath === 'string') state.transcriptPath = transcriptPath;
  const timeoutReason = result.metadata?.['timeoutReason'];
  if (isBackgroundTaskTimeoutReason(timeoutReason)) state.timeoutReason = timeoutReason;
}

function isBackgroundTaskTimeoutReason(
  value: TBackgroundPrimitive | undefined,
): value is TBackgroundTaskTimeoutReason {
  return typeof value === 'string' && TIMEOUT_REASONS.has(value as TBackgroundTaskTimeoutReason);
}

export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

export function normalizeRepeatedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function trimRecentText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

export function hasRepeatedSentence(text: string, threshold: number): boolean {
  if (threshold <= 1) return false;
  const normalized = normalizeRepeatedText(text);
  if (!normalized) return false;
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= MIN_REPEATED_SENTENCE_LENGTH);
  if (sentences.length < threshold) return false;

  let previous = '';
  let count = 0;
  for (const sentence of sentences) {
    if (sentence === previous) {
      count += 1;
    } else {
      previous = sentence;
      count = 1;
    }
    if (count >= threshold) return true;
  }
  return false;
}

/**
 * MCP-004 §S1: `IToolInvocationBackgroundTaskRequest` keeps its provenance as primitive fields
 * (data only — no nested object). This projects those same fields into `metadata` so `/tasks` and
 * every other metadata-only reader can see them without knowing the request shape, alongside
 * whatever `request.metadata` already carries.
 */
function resolveBackgroundTaskMetadata(
  request: TBackgroundTaskRequest,
): Record<string, TBackgroundPrimitive> | undefined {
  const base = request.metadata ? { ...request.metadata } : undefined;
  if (request.kind !== 'tool-invocation') return base;
  return {
    ...base,
    toolName: request.toolName,
    serverId: request.serverId,
    sourceName: request.sourceName,
    ...(request.securityIdentity !== undefined
      ? { securityIdentity: request.securityIdentity }
      : {}),
    permissionMode: request.permissionMode,
    provenanceOwner: request.provenanceOwner,
  };
}

export function createQueuedBackgroundTaskState(
  id: string,
  request: TBackgroundTaskRequest,
  now: string,
  previewLength: number,
  /**
   * MCP-004 §S1: `'queued'` for every runner as before; a runner declaring
   * `admission: 'already-running'` constructs its state as `'running'` from the start, so
   * `background_task_created` is emitted with a state that is already running — `spawn` never
   * enqueues or transitions it (`background-task-manager.ts`).
   */
  status: TBackgroundTaskStatus = 'queued',
): IBackgroundTaskState {
  const metadata = resolveBackgroundTaskMetadata(request);
  const base = {
    id,
    label: request.label,
    status,
    mode: request.mode,
    parentSessionId: request.parentSessionId,
    parentTaskId: request.parentTaskId,
    depth: request.depth,
    cwd: request.cwd,
    updatedAt: now,
    unread: false,
    ...(metadata ? { metadata } : {}),
  };
  // #2079: switch-by-kind construction — the same pattern `decodeBackgroundTaskResult` and
  // `decodeBackgroundTaskState` use — so a kind-specific field can only ever land on its own
  // member, with no cast needed to satisfy the discriminated `IBackgroundTaskState`.
  switch (request.kind) {
    case 'agent': {
      const state: IAgentBackgroundTaskState = {
        ...base,
        kind: 'agent',
        agentType: request.agentType,
        isolation: request.isolation,
        promptPreview: request.prompt.slice(0, previewLength),
        // CLI-1994: carried so a surface can offer `attach` on a forked conversation's task.
        ...(request.resumeSessionId !== undefined
          ? { resumeSessionId: request.resumeSessionId }
          : {}),
      };
      return state;
    }
    case 'process': {
      const state: IProcessBackgroundTaskState = {
        ...base,
        kind: 'process',
        commandPreview: request.command.slice(0, previewLength),
      };
      return state;
    }
    case 'tool-invocation': {
      const state: IToolInvocationBackgroundTaskState = {
        ...base,
        kind: 'tool-invocation',
        commandPreview: `${request.toolName} (${request.serverId})`.slice(0, previewLength),
      };
      return state;
    }
    case 'scheduled': {
      // A scheduled task previews a shell command, an agent-wake instruction, or both.
      const previewSource = request.command ?? request.agentInstruction;
      const state: IScheduledBackgroundTaskState = {
        ...base,
        kind: 'scheduled',
        ...(previewSource !== undefined
          ? { commandPreview: previewSource.slice(0, previewLength) }
          : {}),
        // FLOW-003: capture the reconstructable schedule so a resumed session can re-arm the cron job.
        schedule: {
          cronExpression: request.cronExpression,
          ...(request.agentInstruction !== undefined
            ? { agentInstruction: request.agentInstruction }
            : {}),
          ...(request.command !== undefined ? { command: request.command } : {}),
          ...(request.shell !== undefined ? { shell: request.shell } : {}),
          ...(request.env !== undefined ? { env: { ...request.env } } : {}),
        },
      };
      return state;
    }
  }
}

export function matchesBackgroundTaskFilter(
  state: IBackgroundTaskState,
  filter?: IBackgroundTaskListFilter,
): boolean {
  if (!filter) return true;
  if (filter.kind && state.kind !== filter.kind) return false;
  if (filter.status && state.status !== filter.status) return false;
  if (filter.mode && state.mode !== filter.mode) return false;
  return true;
}

function cloneBackgroundTaskResult<K extends TBackgroundTaskKind>(
  result: IBackgroundTaskResult<K> | undefined,
): IBackgroundTaskResult<K> | undefined {
  if (!result) return undefined;
  return { ...result, metadata: result.metadata ? { ...result.metadata } : undefined };
}

/**
 * #2079: `state.result` is now `IBackgroundTaskResult<K>` — correlated with `state.kind` — so a
 * clone built by spreading `state` and then overwriting `result`/`schedule` generically would let
 * TypeScript re-widen `result` to the full union and lose that correlation. The switch keeps each
 * branch's `state` (and its `result`) narrowed to its own kind throughout.
 */
export function cloneBackgroundTaskState(state: IBackgroundTaskState): IBackgroundTaskState {
  const metadata = state.metadata ? { ...state.metadata } : undefined;
  const error = state.error ? { ...state.error } : undefined;
  switch (state.kind) {
    case 'agent':
      return { ...state, metadata, error, result: cloneBackgroundTaskResult(state.result) };
    case 'process':
      return { ...state, metadata, error, result: cloneBackgroundTaskResult(state.result) };
    case 'tool-invocation':
      return { ...state, metadata, error, result: cloneBackgroundTaskResult(state.result) };
    case 'scheduled':
      return {
        ...state,
        metadata,
        error,
        result: cloneBackgroundTaskResult(state.result),
        schedule: state.schedule
          ? { ...state.schedule, env: state.schedule.env ? { ...state.schedule.env } : undefined }
          : undefined,
      };
  }
}
