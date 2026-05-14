import type { IBackgroundTaskState, TBackgroundPrimitive } from '@robota-sdk/agent-runtime';
import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-runtime';
import type { IBackgroundJobGroupState } from './background-job-orchestrator.js';
import {
  EXECUTION_ORIGIN_METADATA_KEYS,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createMainThreadExecutionEntryId,
  type ICreateExecutionWorkspaceSnapshotInput,
  type ICreateMainThreadEntryInput,
  type IExecutionOrigin,
  type IExecutionWorkspaceEntry,
  type IExecutionWorkspaceFilter,
  type IExecutionWorkspaceSnapshot,
  type TExecutionAttention,
  type TExecutionControl,
  type TExecutionOriginKind,
  type TExecutionWorkspaceVisibility,
} from './execution-workspace-types.js';

const PREVIEW_MAX_LENGTH = 120;
const SUCCESS_EXIT_CODE = 0;

export function createExecutionWorkspaceSnapshot(
  input: ICreateExecutionWorkspaceSnapshotInput,
): IExecutionWorkspaceSnapshot {
  const taskGroupIds = createTaskGroupIdMap(input.groups);
  const entries = [
    createMainThreadEntry(input.mainThread),
    ...sortGroups(input.groups).map((group) => createBackgroundGroupEntry(group)),
    ...sortTasks(input.tasks).map((task) =>
      createBackgroundTaskEntry(task, taskGroupIds.get(task.id)),
    ),
  ].filter((entry) => matchesExecutionWorkspaceFilter(entry, input.filter));
  return {
    sessionId: input.sessionId,
    selectedEntryId:
      input.selectedEntryId ??
      entries.find((entry) => entry.kind === 'main_thread')?.id ??
      createMainThreadExecutionEntryId(input.sessionId),
    updatedAt: entries[0]?.updatedAt ?? input.mainThread.updatedAt,
    entries,
  };
}

function createMainThreadEntry(input: ICreateMainThreadEntryInput): IExecutionWorkspaceEntry {
  return {
    id: createMainThreadExecutionEntryId(input.sessionId),
    sourceId: input.sessionId,
    kind: 'main_thread',
    origin: { kind: 'user_prompt', sessionId: input.sessionId },
    status: input.isExecuting ? 'active' : 'idle',
    title: 'Main thread',
    subtitle: input.hasPendingPrompt ? 'prompt queued' : `${input.historyLength} history entries`,
    preview: trimPreview(input.preview),
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: input.updatedAt,
    controls: ['select'],
  };
}

function createBackgroundTaskEntry(
  state: IBackgroundTaskState,
  groupId: string | undefined,
): IExecutionWorkspaceEntry {
  return {
    id: createBackgroundTaskExecutionEntryId(state.id),
    sourceId: state.id,
    kind: 'background_task',
    parentId: state.parentTaskId
      ? createBackgroundTaskExecutionEntryId(state.parentTaskId)
      : createMainThreadExecutionEntryId(state.parentSessionId),
    ...(groupId ? { groupId: createBackgroundGroupExecutionEntryId(groupId) } : {}),
    origin: readExecutionOrigin(state.metadata, {
      kind: 'system',
      sessionId: state.parentSessionId,
    }),
    taskKind: state.kind,
    status: state.status,
    title: state.label,
    subtitle: createTaskSubtitle(state),
    preview: createTaskPreview(state),
    currentAction: state.currentAction,
    unread: state.unread,
    attention: createTaskAttention(state),
    visibility: createTaskVisibility(state),
    updatedAt: state.lastActivityAt ?? state.updatedAt,
    controls: createTaskControls(state),
  };
}

function createBackgroundGroupEntry(group: IBackgroundJobGroupState): IExecutionWorkspaceEntry {
  const preview = trimPreview(
    group.results.map((result) => result.summary ?? result.error?.message).join(' '),
  );
  return {
    id: createBackgroundGroupExecutionEntryId(group.id),
    sourceId: group.id,
    kind: 'background_group',
    parentId: createMainThreadExecutionEntryId(group.parentSessionId),
    origin: { kind: 'system', sessionId: group.parentSessionId, label: group.label },
    status: group.status,
    title: group.label ?? group.id,
    subtitle: `${group.results.length}/${group.taskIds.length} tasks`,
    preview,
    unread: false,
    attention: createGroupAttention(group),
    visibility: group.status === 'completed' ? 'collapsed' : 'default',
    updatedAt: group.updatedAt,
    controls: group.status === 'running' ? ['select', 'wait'] : ['select'],
  };
}

function readExecutionOrigin(
  metadata: Record<string, TBackgroundPrimitive> | undefined,
  fallback: IExecutionOrigin,
): IExecutionOrigin {
  const kind = toExecutionOriginKind(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.kind]);
  const sessionId = toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.sessionId]);
  return {
    kind: kind ?? fallback.kind,
    sessionId: sessionId ?? fallback.sessionId,
    turnId: toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.turnId]) ?? fallback.turnId,
    commandName:
      toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.commandName]) ?? fallback.commandName,
    toolCallId:
      toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.toolCallId]) ?? fallback.toolCallId,
    skillId: toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.skillId]) ?? fallback.skillId,
    label: toStringValue(metadata?.[EXECUTION_ORIGIN_METADATA_KEYS.label]) ?? fallback.label,
  };
}

function createTaskGroupIdMap(groups: readonly IBackgroundJobGroupState[]): Map<string, string> {
  return new Map(groups.flatMap((group) => group.taskIds.map((taskId) => [taskId, group.id])));
}

function createTaskControls(state: IBackgroundTaskState): readonly TExecutionControl[] {
  const controls: TExecutionControl[] = ['select'];
  if (isTerminalBackgroundTaskStatus(state.status)) controls.push('close');
  else controls.push('cancel');
  if (state.logPath || state.transcriptPath) controls.push('read_log');
  return controls;
}

function createTaskSubtitle(state: IBackgroundTaskState): string | undefined {
  if (state.kind === 'agent') return state.agentType ?? state.cwd;
  if (state.status === 'sleeping' && state.nextFireAt !== undefined) {
    return `next: ${formatNextFireAt(state.nextFireAt)}`;
  }
  return state.cwd;
}

function formatNextFireAt(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'now';
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  return `${Math.round(diffMin / 60)}h`;
}

function createTaskPreview(state: IBackgroundTaskState): string | undefined {
  if (state.status === 'failed') return trimPreview(state.error?.message);
  if (state.status === 'completed') return trimPreview(state.result?.output);
  return trimPreview(state.promptPreview ?? state.commandPreview);
}

function createTaskAttention(state: IBackgroundTaskState): TExecutionAttention {
  if (state.status === 'failed') return 'failed';
  if (state.status === 'waiting_permission') return 'permission';
  if (state.unread) return 'unread';
  if (state.status === 'completed') return 'completed';
  return 'none';
}

function createTaskVisibility(state: IBackgroundTaskState): TExecutionWorkspaceVisibility {
  if (
    state.status === 'completed' &&
    !state.unread &&
    !state.error &&
    (state.result?.exitCode ?? SUCCESS_EXIT_CODE) === SUCCESS_EXIT_CODE &&
    !state.result?.signalCode &&
    !state.worktreePath &&
    !state.branchName
  ) {
    return 'collapsed';
  }
  return 'default';
}

function createGroupAttention(group: IBackgroundJobGroupState): TExecutionAttention {
  if (group.results.some((result) => result.status === 'failed')) return 'failed';
  if (group.status === 'completed') return 'completed';
  return 'none';
}

function matchesExecutionWorkspaceFilter(
  entry: IExecutionWorkspaceEntry,
  filter: IExecutionWorkspaceFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.includeMainThread === false && entry.kind === 'main_thread') return false;
  if (filter.kinds && !filter.kinds.includes(entry.kind)) return false;
  if (filter.visibility && !filter.visibility.includes(entry.visibility)) return false;
  return true;
}

function sortTasks(tasks: readonly IBackgroundTaskState[]): IBackgroundTaskState[] {
  return [...tasks].sort((left, right) =>
    (right.lastActivityAt ?? right.updatedAt).localeCompare(left.lastActivityAt ?? left.updatedAt),
  );
}

function sortGroups(groups: readonly IBackgroundJobGroupState[]): IBackgroundJobGroupState[] {
  return [...groups].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function trimPreview(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > PREVIEW_MAX_LENGTH
    ? `${normalized.slice(0, PREVIEW_MAX_LENGTH)}...`
    : normalized;
}

function toStringValue(value: TBackgroundPrimitive | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toExecutionOriginKind(
  value: TBackgroundPrimitive | undefined,
): TExecutionOriginKind | undefined {
  if (
    value === 'user_prompt' ||
    value === 'slash_command' ||
    value === 'model_command' ||
    value === 'tool_call' ||
    value === 'skill' ||
    value === 'transport' ||
    value === 'system'
  ) {
    return value;
  }
  return undefined;
}
