/**
 * Execution workspace helpers for InteractiveSession.
 *
 * Pure functions that build workspace snapshots, list/get entries,
 * read detail pages, and create task spawners. The class delegates to
 * these with thin wrappers.
 */

import {
  createExecutionWorkspaceSnapshot,
  createExecutionWorkspaceTaskSpawner,
  createMainThreadDetailPage,
  parseExecutionWorkspaceEntryId,
} from '../background-tasks/index.js';

import type { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import type { SessionExecutionController } from './interactive-session-execution-controller.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type {
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionDetailRecord,
  IExecutionOrigin,
  IExecutionPendingRequest,
  IExecutionSelfPacedLoopSummary,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceTaskSpawner,
} from '../background-tasks/index.js';
import { isChatEntry } from '@robota-sdk/agent-core';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

export interface IWorkspaceSnapshotDeps {
  sessionId: string;
  execCtrl: Pick<SessionExecutionController, 'executing' | 'pendingPrompt' | 'streamingText'>;
  histTracker: Pick<SessionHistoryTracker, 'getHistory'>;
  bgTracker: Pick<SessionBackgroundTaskTracker, 'getTaskSnapshots' | 'getGroupSnapshots'>;
  /** SCREEN-1992: the parked permission/ask the main thread waits on, when the session has one. */
  pendingRequest?: () => IExecutionPendingRequest | undefined;
  /** #3288 §1: this session's self-paced loops, for the `pending`/`running` ones' own entries. */
  selfPacedLoops?: () => readonly IExecutionSelfPacedLoopSummary[];
}

export function buildExecutionWorkspaceSnapshot(
  deps: IWorkspaceSnapshotDeps,
  options: IExecutionWorkspaceSnapshotOptions = {},
): IExecutionWorkspaceSnapshot {
  const { sessionId, execCtrl, histTracker, bgTracker } = deps;
  const history = histTracker.getHistory();
  const pendingRequest = deps.pendingRequest?.();
  return createExecutionWorkspaceSnapshot({
    sessionId,
    mainThread: {
      sessionId,
      isExecuting: execCtrl.executing,
      hasPendingPrompt: execCtrl.pendingPrompt !== null,
      historyLength: history.length,
      updatedAt: history.at(-1)?.timestamp.toISOString() ?? new Date(0).toISOString(),
      preview:
        execCtrl.streamingText.trim().length > 0
          ? execCtrl.streamingText
          : lastConversationText(history),
      ...(pendingRequest === undefined ? {} : { pendingRequest }),
    },
    tasks: bgTracker.getTaskSnapshots(),
    groups: bgTracker.getGroupSnapshots(),
    selfPacedLoops: deps.selfPacedLoops?.(),
    selectedEntryId: options.selectedEntryId,
    filter: options.filter,
  });
}

/**
 * The main thread previews its conversation: the text of the last chat message. The last record is
 * often bookkeeping (a usage observation, an event), whose type name is not something to show.
 */
function lastConversationText(history: readonly IHistoryEntry[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!;
    if (!isChatEntry(entry)) continue;
    const content = (entry.data as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && content.trim().length > 0) return content;
  }
  return undefined;
}

export async function readWorkspaceDetail(
  entryId: string,
  getHistory: () => IHistoryEntry[],
  bgTracker: Pick<SessionBackgroundTaskTracker, 'readGroupDetail' | 'readTaskDetail'>,
  sessionId: string,
  cursor?: IExecutionDetailCursor,
  pendingRequest?: IExecutionPendingRequest,
  /**
   * #3288 §1: a `pending`/`running` self-paced loop's OWN entry has no `IBackgroundTaskState` of its
   * own to read (see `execution-workspace-projection.ts`'s module note) — `bgTracker.readTaskDetail`
   * would throw "Unknown background task" for it. Checked before falling through to that, so a loop
   * entry reads from its own durable state instead.
   */
  getSelfPacedLoop?: (loopId: string) => ISessionLoopState | undefined,
): Promise<IExecutionDetailPage> {
  const entryRef = parseExecutionWorkspaceEntryId(entryId);
  if (!entryRef) throw new Error(`Unknown execution workspace entry: ${entryId}`);
  if (entryRef.kind === 'main_thread') {
    return createMainThreadDetailPage({
      entryId,
      history: getHistory(),
      cursor,
      ...(pendingRequest === undefined ? {} : { pendingRequest }),
    });
  }
  if (entryRef.kind === 'background_group') {
    return bgTracker.readGroupDetail(entryId, entryRef.sourceId, sessionId);
  }
  const loop = getSelfPacedLoop?.(entryRef.sourceId);
  if (loop) return createSelfPacedLoopDetailPage(entryId, loop);
  return bgTracker.readTaskDetail(entryId, entryRef.sourceId, cursor);
}

/**
 * #3288 §1: a self-paced loop's detail page, built from its own durable state — never from a
 * background-task record, which it may not have one of at all (see `readWorkspaceDetail`). One page,
 * no cursor: the loop's own state is small and fixed-shape, not a growing transcript.
 *
 * `reason`/`delaySeconds` are NOT cleared when a `waiting` loop claims its next wake (`pending`) —
 * they describe the previous iteration's own outcome, so they read as "last outcome" here rather
 * than this iteration's (not-yet-decided) one. Absent on a loop's very first iteration, when no
 * decision has been committed yet.
 */
function createSelfPacedLoopDetailPage(entryId: string, loop: ISessionLoopState): IExecutionDetailPage {
  const firstLine = loop.instruction.split('\n')[0]!.trim() || loop.instruction;
  const records: IExecutionDetailRecord[] = [
    { id: `${entryId}:instruction`, kind: 'message', text: firstLine },
    {
      id: `${entryId}:status`,
      kind: 'progress',
      text:
        `Phase: ${loop.phase}` +
        (loop.nextAllowedAt ? ` — next wake ${loop.nextAllowedAt}` : ''),
    },
    { id: `${entryId}:iterations`, kind: 'progress', text: `Iteration ${loop.generation}` },
  ];
  if (loop.reason !== undefined) {
    records.push({
      id: `${entryId}:last-outcome`,
      kind: 'result',
      text:
        loop.delaySeconds !== undefined
          ? `Last outcome: next check in ${loop.delaySeconds}s — ${loop.reason}`
          : `Last outcome: ${loop.reason}`,
    });
  }
  return { entryId, records };
}

export function buildWorkspaceTaskSpawner(
  bgTracker: Pick<SessionBackgroundTaskTracker, 'getManagerOrThrow' | 'getOrchestratorOrThrow'>,
  sessionId: string,
  cwd: string,
  origin: IExecutionOrigin,
): IExecutionWorkspaceTaskSpawner {
  return createExecutionWorkspaceTaskSpawner({
    manager: bgTracker.getManagerOrThrow(),
    groupOrchestrator: bgTracker.getOrchestratorOrThrow(sessionId),
    sessionId,
    cwd,
    origin: { ...origin, sessionId: origin.sessionId || sessionId },
  });
}
