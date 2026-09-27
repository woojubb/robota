import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-executor';

import {
  groupHeadline,
  groupState,
  mainThreadHeadline,
  mainThreadState,
  taskHeadline,
  taskState,
  trimPreview,
} from './execution-workspace-state.js';
import {
  EXECUTION_ORIGIN_METADATA_KEYS,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createMainThreadExecutionEntryId,
  type ICreateExecutionWorkspaceSnapshotInput,
  type ICreateMainThreadEntryInput,
  type IExecutionOrigin,
  type IExecutionSelfPacedLoopSummary,
  type IExecutionWorkspaceEntry,
  type IExecutionWorkspaceFilter,
  type IExecutionWorkspaceSnapshot,
  type TExecutionAttention,
  type TExecutionControl,
  type TExecutionOriginKind,
  type TExecutionWorkspaceVisibility,
  type IExecutionHeadline,
} from './execution-workspace-types.js';

import type { IBackgroundJobGroupState } from './background-job-orchestrator.js';
import type {
  IBackgroundTaskResult,
  IBackgroundTaskState,
  TBackgroundPrimitive,
} from '@robota-sdk/agent-interface-execution';

const SUCCESS_EXIT_CODE = 0;

/**
 * #2079: `IBackgroundTaskResult` is discriminated by kind now, and `exitCode`/`signalCode` exist
 * only on the process-kind member. `state.result` is still the full union (`IBackgroundTaskState` is
 * not itself discriminated), so this narrows on the RESULT's own `kind` before reading them — a
 * non-process result (or none) is never an unclean exit.
 */
function hasCleanProcessExit(result: IBackgroundTaskResult | undefined): boolean {
  if (result?.kind !== 'process') return true;
  return (result.exitCode ?? SUCCESS_EXIT_CODE) === SUCCESS_EXIT_CODE && !result.signalCode;
}

export function createExecutionWorkspaceSnapshot(
  input: ICreateExecutionWorkspaceSnapshotInput,
): IExecutionWorkspaceSnapshot {
  const taskGroupIds = createTaskGroupIdMap(input.groups);
  const entries = [
    createMainThreadEntry(input.mainThread),
    ...sortGroups(input.groups).map((group) => createBackgroundGroupEntry(group)),
    ...sortTasks(input.tasks)
      // #3288 §1: a stopped loop's task does not linger (cancel() only flips status, never removes
      // the record), and neither does a self-paced loop's fired one-shot wake timer, which the
      // manager moves to `completed` on its own — see `isLingeringTerminalLoopTask`. An ordinary
      // (non-loop) cancelled or completed task is unaffected: it stays listed and queryable.
      .filter((task) => !isLingeringTerminalLoopTask(task))
      .map((task) => createBackgroundTaskEntry(task, taskGroupIds.get(task.id))),
    ...sortSelfPacedLoops(input.selfPacedLoops ?? [])
      // Only `pending`/`running` need a projection of their own: `waiting` already has one (the
      // disposable wake timer `armSelfPacedTimer` spawns is itself a task above, carrying the same
      // `loopId`); `stopped`/`expired` must not linger, for the same reason a cancelled task above
      // does not.
      .filter((loop) => loop.phase === 'pending' || loop.phase === 'running')
      .map((loop) => createSelfPacedLoopEntry(loop, input.sessionId)),
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
    attention: input.pendingRequest !== undefined ? 'permission' : 'none',
    visibility: 'default',
    updatedAt: input.updatedAt,
    controls: ['select'],
    state: mainThreadState(input),
    ...withHeadline(mainThreadHeadline(input)),
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
    // CLI-1994: the forked session record an `attach` control switches the view onto.
    ...(state.kind === 'agent' && state.resumeSessionId !== undefined
      ? { resumeSessionId: state.resumeSessionId }
      : {}),
    state: taskState(state),
    ...withHeadline(taskHeadline(state)),
    // SCREEN-1992: the timestamp, so a surface can tick its own countdown (never baked text).
    ...(state.kind === 'scheduled' && state.status === 'sleeping' && state.nextFireAt !== undefined
      ? { nextFireAt: state.nextFireAt }
      : {}),
    // #3288 §1: the stable /loop stop <id> handle, present on any /loop-managed task — a fixed
    // cadence loop, or a self-paced loop's own disposable wake timer (metadata.sessionLoop is set
    // on both; see loopIdFromTaskMetadata).
    ...(() => {
      const loopId = loopIdFromTaskMetadata(state);
      return loopId === undefined ? {} : { loopId };
    })(),
    ...(() => {
      const deniedToolCalls = deniedToolCallsFromResult(state);
      return deniedToolCalls === undefined ? {} : { deniedToolCalls };
    })(),
  };
}

/**
 * #3288 §1: an agent task's own denied-tool-call count (#3312's `IBackgroundTaskDeniedToolCalls`,
 * additive — absent on a task with nothing refused). Flattened to the total here; the entry carries
 * a count for the panel's label, not the by-reason breakdown.
 */
function deniedToolCallsFromResult(state: IBackgroundTaskState): number | undefined {
  if (state.kind !== 'agent' || state.result?.kind !== 'agent') return undefined;
  const denied = state.result.deniedToolCalls;
  return denied && denied.total > 0 ? denied.total : undefined;
}

/**
 * #3288 §1: a `/loop`-managed task's stable loop id (`loopIdOf` in agent-command's loop-command.ts
 * computes the identical answer server-side, for `/loop stop` itself — the two must never drift, so
 * this mirrors it exactly). Absent on any task `/loop` did not create.
 */
function loopIdFromTaskMetadata(state: IBackgroundTaskState): string | undefined {
  if (state.metadata?.['sessionLoop'] !== true) return undefined;
  const stableId = state.metadata['sessionLoopId'];
  return typeof stableId === 'string' && stableId.length > 0 ? stableId : state.id;
}

/**
 * #3288 §1: whether a loop task's own record should stop appearing — the record itself is never
 * deleted by `cancel()` (only `close()` does that), so this is a snapshot-time filter, not a mutation.
 *
 * Two terminal statuses reach this, for different reasons: an operator-stopped loop's task is
 * `cancelled` (see above); a self-paced loop's disposable one-shot wake timer (`armSelfPacedTimer`)
 * fires and — having no next cron occurrence — is moved to `completed` by the manager on its own,
 * while the LIVE loop keeps going under its own `pending`/`running`/`waiting` entry (see
 * `createSelfPacedLoopEntry`). Without dropping the fired timer too, every iteration would leave a
 * second "Loop: …" row stuck at "Done" beside the real one. A fixed-cadence loop's own recurring
 * task always has a next occurrence, so it never reaches `completed` this way — only this filter's
 * `cancelled` half ever applies to it.
 */
function isLingeringTerminalLoopTask(task: IBackgroundTaskState): boolean {
  return (
    task.metadata?.['sessionLoop'] === true &&
    (task.status === 'cancelled' || task.status === 'completed')
  );
}

const SELF_PACED_LOOP_LABEL = 'Loop: ';
const SELF_PACED_LOOP_TITLE_LENGTH = 48;

/** #3288 §1: a `pending`/`running` self-paced loop, projected with no `IBackgroundTaskState` of its
 * own to draw from — see the module-level note on `createExecutionWorkspaceSnapshot`. */
function createSelfPacedLoopEntry(
  loop: IExecutionSelfPacedLoopSummary,
  sessionId: string,
): IExecutionWorkspaceEntry {
  const status = loop.phase === 'running' ? 'running' : 'queued';
  return {
    id: createBackgroundTaskExecutionEntryId(loop.loopId),
    sourceId: loop.loopId,
    kind: 'background_task',
    parentId: createMainThreadExecutionEntryId(sessionId),
    origin: { kind: 'slash_command', sessionId, commandName: 'loop' },
    taskKind: 'scheduled',
    status,
    title: `${SELF_PACED_LOOP_LABEL}${loop.instruction.slice(0, SELF_PACED_LOOP_TITLE_LENGTH)}`,
    subtitle: 'self-paced',
    preview: trimPreview(loop.instruction),
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: loop.createdAt,
    controls: ['select', 'cancel'],
    state: 'working',
    loopId: loop.loopId,
  };
}

function sortSelfPacedLoops(
  loops: readonly IExecutionSelfPacedLoopSummary[],
): readonly IExecutionSelfPacedLoopSummary[] {
  // SCREEN-010: the same stable-order rule as sortTasks — no per-loop start time is available here,
  // so order by id (deterministic, and matches the "loops in `/loop list`" ordering closely enough
  // for the small, occasional set of concurrently-active loops).
  return [...loops].sort((left, right) => left.loopId.localeCompare(right.loopId));
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
    state: groupState(group),
    ...withHeadline(groupHeadline(group)),
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
  if (state.kind === 'agent' && state.status === 'running') controls.push('send');
  if (state.logPath || state.transcriptPath) controls.push('read_log');
  // CLI-1994: a task that resumed a forked record can be ATTACHED to — offered whenever the request
  // carried the id; a terminal task or a missing record is refused at attach time, with the reason.
  if (state.kind === 'agent' && state.resumeSessionId !== undefined) controls.push('attach');
  return controls;
}

/** FLOW-006: max characters of the wake instruction shown inline in the workspace row. */
const WAKE_PREVIEW_LENGTH = 32;

function createTaskSubtitle(state: IBackgroundTaskState): string | undefined {
  if (state.kind === 'agent') return state.agentType ?? state.cwd;
  // FLOW-006: distinguish an agent-wake schedule (carries an instruction) from a shell-only
  // schedule with a `↻ wake` marker + a truncated instruction preview. SCREEN-1992: the next fire
  // is no longer baked here as text — the entry carries `nextFireAt` for a live countdown.
  const wakeInstruction = state.kind === 'scheduled' ? state.schedule?.agentInstruction : undefined;
  if (state.status === 'sleeping' && wakeInstruction !== undefined) {
    return `↻ wake "${truncateWakePreview(wakeInstruction)}"`;
  }
  return state.cwd;
}

function withHeadline(value: IExecutionHeadline | undefined): { headline?: IExecutionHeadline } {
  return value === undefined ? {} : { headline: value };
}

function truncateWakePreview(instruction: string): string {
  const trimmed = instruction.trim();
  return trimmed.length > WAKE_PREVIEW_LENGTH
    ? `${trimmed.slice(0, WAKE_PREVIEW_LENGTH)}…`
    : trimmed;
}

function createTaskPreview(state: IBackgroundTaskState): string | undefined {
  if (state.status === 'failed') return trimPreview(state.error?.message);
  if (state.status === 'completed') return trimPreview(state.result?.output);
  return trimPreview(state.kind === 'agent' ? state.promptPreview : state.commandPreview);
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
    hasCleanProcessExit(state.result) &&
    !(state.kind === 'agent' && state.worktreePath) &&
    !(state.kind === 'agent' && state.branchName)
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

// SCREEN-010: order by a STABLE key (creation/start order), not by `lastActivityAt`. Sorting by
// last activity made every running task jump to the top on each activity tick, so the list churned
// constantly. `startedAt` is fixed once a task starts, so ascending order keeps each row in its slot
// once it appears; new tasks append. `id` is the deterministic tiebreaker for not-yet-started tasks.
function sortTasks(tasks: readonly IBackgroundTaskState[]): IBackgroundTaskState[] {
  return [...tasks].sort((left, right) => {
    const leftKey = left.startedAt ?? left.updatedAt;
    const rightKey = right.startedAt ?? right.updatedAt;
    const byStart = leftKey.localeCompare(rightKey);
    return byStart !== 0 ? byStart : left.id.localeCompare(right.id);
  });
}

function sortGroups(groups: readonly IBackgroundJobGroupState[]): IBackgroundJobGroupState[] {
  // Stable order too (SCREEN-010): groups carry no start time, so order by their creation id.
  return [...groups].sort((left, right) => left.id.localeCompare(right.id));
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
