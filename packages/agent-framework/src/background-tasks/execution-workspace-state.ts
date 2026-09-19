/**
 * SCREEN-1992 — the normalized state word and the one-line headline every workspace entry carries.
 *
 * Derived here, once, from the detailed task/group/main-thread state so no surface re-derives
 * "needs input" from `status` × `attention` on its own. The table is total over every status the
 * contracts declare; a cancelled or paused task is `stopped`, never `completed`.
 */
import type { IBackgroundJobGroupState } from './background-job-orchestrator.js';
import type {
  ICreateMainThreadEntryInput,
  IExecutionHeadline,
  TExecutionNormalizedState,
} from './execution-workspace-types.js';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

const TASK_STATE: Record<IBackgroundTaskState['status'], TExecutionNormalizedState> = {
  queued: 'working',
  running: 'working',
  sleeping: 'working',
  waiting_permission: 'needs-input',
  paused: 'stopped',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'stopped',
};

export function taskState(state: IBackgroundTaskState): TExecutionNormalizedState {
  return TASK_STATE[state.status];
}

/** A parked prompt wins; an executing turn is working; an idle thread has completed its last turn. */
export function mainThreadState(input: ICreateMainThreadEntryInput): TExecutionNormalizedState {
  if (input.pendingRequest !== undefined) return 'needs-input';
  return input.isExecuting ? 'working' : 'completed';
}

export function groupState(group: IBackgroundJobGroupState): TExecutionNormalizedState {
  if (group.results.some((result) => result.status === 'failed')) return 'failed';
  if (group.status === 'completed') return 'completed';
  return 'working';
}

const PREVIEW_MAX_LENGTH = 120;

/**
 * One line, bounded: whitespace (including newlines) collapsed and the text cut at the row width.
 * The headline and the preview share this rule so a surface can tell them apart by equality.
 */
export function trimPreview(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > PREVIEW_MAX_LENGTH
    ? `${normalized.slice(0, PREVIEW_MAX_LENGTH)}...`
    : normalized;
}

function headline(
  kind: IExecutionHeadline['kind'],
  text: string | undefined,
): IExecutionHeadline | undefined {
  const line = trimPreview(text);
  return line ? { kind, text: line } : undefined;
}

/** Question for a waiting task, result for a terminal one, activity otherwise. */
export function taskHeadline(state: IBackgroundTaskState): IExecutionHeadline | undefined {
  switch (state.status) {
    case 'failed':
      return headline('result', state.error?.message);
    case 'completed':
      return headline('result', state.result?.output);
    case 'cancelled':
    case 'paused':
      return headline('result', state.status);
    case 'waiting_permission':
      return headline('question', state.currentAction ?? 'waiting for permission');
    default:
      return headline(
        'activity',
        state.currentAction ??
          state.schedule?.agentInstruction ??
          state.promptPreview ??
          state.commandPreview,
      );
  }
}

export function mainThreadHeadline(
  input: ICreateMainThreadEntryInput,
): IExecutionHeadline | undefined {
  if (input.pendingRequest !== undefined) return headline('question', input.pendingRequest.text);
  return headline(input.isExecuting ? 'activity' : 'result', input.preview);
}

export function groupHeadline(group: IBackgroundJobGroupState): IExecutionHeadline | undefined {
  const kind = group.status === 'completed' ? 'result' : 'activity';
  return headline(
    kind,
    group.results
      .map((result) => result.summary ?? result.error?.message)
      .join(' ')
      .trim() || `${group.results.length}/${group.taskIds.length} tasks`,
  );
}
