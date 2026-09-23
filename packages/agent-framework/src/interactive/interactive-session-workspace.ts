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
  IExecutionOrigin,
  IExecutionPendingRequest,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceTaskSpawner,
} from '../background-tasks/index.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

export interface IWorkspaceSnapshotDeps {
  sessionId: string;
  execCtrl: Pick<SessionExecutionController, 'executing' | 'pendingPrompt' | 'streamingText'>;
  histTracker: Pick<SessionHistoryTracker, 'getHistory'>;
  bgTracker: Pick<SessionBackgroundTaskTracker, 'getTaskSnapshots' | 'getGroupSnapshots'>;
  /** SCREEN-1992: the parked permission/ask the main thread waits on, when the session has one. */
  pendingRequest?: () => IExecutionPendingRequest | undefined;
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
          : (history.at(-1)?.type as string | undefined),
      ...(pendingRequest === undefined ? {} : { pendingRequest }),
    },
    tasks: bgTracker.getTaskSnapshots(),
    groups: bgTracker.getGroupSnapshots(),
    selectedEntryId: options.selectedEntryId,
    filter: options.filter,
  });
}

export async function readWorkspaceDetail(
  entryId: string,
  getHistory: () => IHistoryEntry[],
  bgTracker: Pick<SessionBackgroundTaskTracker, 'readGroupDetail' | 'readTaskDetail'>,
  sessionId: string,
  cursor?: IExecutionDetailCursor,
  pendingRequest?: IExecutionPendingRequest,
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
  return bgTracker.readTaskDetail(entryId, entryRef.sourceId, cursor);
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
