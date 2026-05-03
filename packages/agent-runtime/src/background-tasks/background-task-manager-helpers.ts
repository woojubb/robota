import {
  BackgroundTaskError,
  type IBackgroundTaskError,
  type IBackgroundTaskHandle,
  type IBackgroundTaskListFilter,
  type IBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskState,
  type TBackgroundPrimitive,
  type TBackgroundTaskTimeoutReason,
} from './types.js';

export interface ITrackedBackgroundTask {
  state: IBackgroundTaskState;
  request: IBackgroundTaskRequest;
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
  const logPath = result.metadata?.['logPath'];
  if (typeof logPath === 'string') state.logPath = logPath;
  const transcriptPath = result.metadata?.['transcriptPath'];
  if (typeof transcriptPath === 'string') state.transcriptPath = transcriptPath;
  const timeoutReason = result.metadata?.['timeoutReason'];
  if (isBackgroundTaskTimeoutReason(timeoutReason)) state.timeoutReason = timeoutReason;
}

export function isBackgroundTaskTimeoutReason(
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

export function createQueuedBackgroundTaskState(
  id: string,
  request: IBackgroundTaskRequest,
  now: string,
  previewLength: number,
): IBackgroundTaskState {
  const preview =
    request.kind === 'agent'
      ? { promptPreview: request.prompt.slice(0, previewLength) }
      : { commandPreview: request.command.slice(0, previewLength) };

  return {
    id,
    kind: request.kind,
    label: request.label,
    agentType: request.kind === 'agent' ? request.agentType : undefined,
    status: 'queued',
    mode: request.mode,
    parentSessionId: request.parentSessionId,
    parentTaskId: request.parentTaskId,
    depth: request.depth,
    cwd: request.cwd,
    updatedAt: now,
    unread: false,
    isolation: request.kind === 'agent' ? request.isolation : undefined,
    ...preview,
  };
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

export function cloneBackgroundTaskState(state: IBackgroundTaskState): IBackgroundTaskState {
  return {
    ...state,
    result: state.result ? { ...state.result } : undefined,
    error: state.error ? { ...state.error } : undefined,
  };
}
