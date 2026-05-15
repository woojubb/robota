/**
 * Execution workspace helpers for InteractiveSession.
 *
 * Pure functions that build workspace snapshots, list/get entries,
 * read detail pages, and create task spawners. The class delegates to
 * these with thin wrappers.
 */

import type {
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceTaskSpawner,
} from '../background-tasks/index.js';
import {
  createExecutionWorkspaceSnapshot,
  createExecutionWorkspaceTaskSpawner,
  createMainThreadDetailPage,
  parseExecutionWorkspaceEntryId,
} from '../background-tasks/index.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import type { SessionExecutionController } from './interactive-session-execution-controller.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';

export interface IWorkspaceSnapshotDeps {
  sessionId: string;
  execCtrl: Pick<SessionExecutionController, 'executing' | 'pendingPrompt' | 'streamingText'>;
  histTracker: Pick<SessionHistoryTracker, 'getHistory'>;
  bgTracker: Pick<SessionBackgroundTaskTracker, 'getTaskSnapshots' | 'getGroupSnapshots'>;
}

export function buildExecutionWorkspaceSnapshot(
  deps: IWorkspaceSnapshotDeps,
  options: IExecutionWorkspaceSnapshotOptions = {},
): IExecutionWorkspaceSnapshot {
  const { sessionId, execCtrl, histTracker, bgTracker } = deps;
  const history = histTracker.getHistory();
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
    },
    tasks: bgTracker.getTaskSnapshots(),
    groups: bgTracker.getGroupSnapshots(),
    selectedEntryId: options.selectedEntryId,
    filter: options.filter,
  });
}

export function listWorkspaceEntries(
  getSnapshot: (options?: IExecutionWorkspaceSnapshotOptions) => IExecutionWorkspaceSnapshot,
  filter?: IExecutionWorkspaceFilter,
): IExecutionWorkspaceEntry[] {
  return [...getSnapshot({ filter }).entries];
}

export function getWorkspaceEntry(
  getSnapshot: (options?: IExecutionWorkspaceSnapshotOptions) => IExecutionWorkspaceSnapshot,
  entryId: string,
): IExecutionWorkspaceEntry | undefined {
  return getSnapshot().entries.find((entry) => entry.id === entryId);
}

export async function readWorkspaceDetail(
  entryId: string,
  getHistory: () => IHistoryEntry[],
  bgTracker: Pick<SessionBackgroundTaskTracker, 'readGroupDetail' | 'readTaskDetail'>,
  sessionId: string,
  cursor?: IExecutionDetailCursor,
): Promise<IExecutionDetailPage> {
  const entryRef = parseExecutionWorkspaceEntryId(entryId);
  if (!entryRef) throw new Error(`Unknown execution workspace entry: ${entryId}`);
  if (entryRef.kind === 'main_thread') {
    return createMainThreadDetailPage({ entryId, history: getHistory(), cursor });
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
