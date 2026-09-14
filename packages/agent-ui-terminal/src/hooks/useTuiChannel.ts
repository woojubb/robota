/**
 * useTuiChannel — React hook that subscribes to the bounded TUI channel port.
 */

import { useState, useEffect, useCallback } from 'react';

import type {
  ITuiAppChannelPort,
  ITuiCommandQueryPort,
  ITuiRuntimeStatusSnapshot,
  ITuiSessionUiEventPort,
} from '../tui-app-channel-port.js';
import type { ITuiSessionEventNotice } from '../tui-session-events.js';
import type { IPendingPermissionRequest } from '../types.js';
import type {
  IActionRequest,
  IHistoryEntry,
  TActionResponse,
  TPermissionMode,
  TSessionEndReason,
} from '@robota-sdk/agent-core';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type { IToolState } from '@robota-sdk/agent-interface-session';

export interface ITuiChannelState {
  uiEventPort: ITuiSessionUiEventPort;
  commandQueryPort: ITuiCommandQueryPort;
  history: readonly IHistoryEntry[];
  addEntry: (entry: IHistoryEntry) => void;
  streamingText: string;
  activeTools: readonly IToolState[];
  isThinking: boolean;
  isAborting: boolean;
  /** ERR-001 G2: humanized message of the last failed turn (null once the next turn starts). */
  lastErrorMessage: string | null;
  /** ERR-001 G3: no provider activity for a while during a turn — connection may be stalled. */
  isStalled: boolean;
  sessionEventNotices: readonly ITuiSessionEventNotice[];
  isShuttingDown: boolean;
  pendingPrompt: string | null;
  /** REMOTE-014 E5: total queued turns across all drivers (owner + co-drivers); >1 means a co-driver is queued. */
  pendingCount: number;
  executionWorkspaceSnapshot: IExecutionWorkspaceSnapshot | null;
  selectedExecutionEntryId?: string;
  permissionRequest: IPendingPermissionRequest | null;
  /** CMD-004: the unified action awaiting a user answer, or null. */
  pendingUserAction: IActionRequest | null;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  handleSubmit: (input: string) => Promise<void>;
  handleAbort: () => void;
  handleCancelQueue: () => void;
  handleShutdown: (reason?: TSessionEndReason) => Promise<void>;
  sendAgentJob: (taskId: string, input: string) => Promise<void>;
  resolveUserAction: (request: IActionRequest, response: TActionResponse) => void;
  getRuntimeStatusSnapshot: (fallback: TPermissionMode) => ITuiRuntimeStatusSnapshot;
  selectExecutionWorkspaceEntry: (entryId: string) => void;
  readExecutionWorkspaceDetail: (entryId: string) => Promise<IExecutionDetailPage>;
}

interface IHistoryReadableSession {
  getFullHistory(): IHistoryEntry[];
}

interface IHistorySyncManager {
  syncHistory(entries: IHistoryEntry[]): void;
}

export function applyCompactEventToManager(
  interactiveSession: IHistoryReadableSession,
  manager: IHistorySyncManager,
): void {
  manager.syncHistory(interactiveSession.getFullHistory());
}

export function useTuiChannel(channel: ITuiAppChannelPort): ITuiChannelState {
  const [, forceRender] = useState(0);

  useEffect(() => channel.subscribe(() => forceRender((n) => n + 1)), [channel]);
  const snapshot = channel.getSnapshot();

  // SCREEN-014 fix: these are consumed in `useEffect` dependency arrays in App. `channel` is stable
  // (created once), so memoize them — a fresh closure each render made the detail-loading effect
  // re-run every render and `setState`-loop ("Maximum update depth exceeded") whenever a background
  // entry was selected.
  const selectExecutionWorkspaceEntry = useCallback(
    (id: string) => channel.selectExecutionWorkspaceEntry(id),
    [channel],
  );
  const readExecutionWorkspaceDetail = useCallback(
    (id: string) => channel.readExecutionWorkspaceDetail(id),
    [channel],
  );

  return {
    uiEventPort: channel.getSessionUiEventPort(),
    commandQueryPort: channel.getCommandQueryPort(),
    history: snapshot.history,
    addEntry: (entry) => channel.addEntry(entry),
    streamingText: snapshot.streamingText,
    activeTools: snapshot.activeTools,
    isThinking: snapshot.isThinking,
    isAborting: snapshot.isAborting,
    lastErrorMessage: snapshot.lastErrorMessage,
    isStalled: snapshot.isStalled,
    sessionEventNotices: snapshot.sessionEventNotices,
    isShuttingDown: snapshot.isShuttingDown,
    pendingPrompt: snapshot.pendingPrompt,
    pendingCount: snapshot.pendingCount,
    executionWorkspaceSnapshot: snapshot.executionWorkspaceSnapshot,
    selectedExecutionEntryId: snapshot.selectedExecutionEntryId,
    permissionRequest: snapshot.permissionRequest,
    pendingUserAction: snapshot.pendingUserAction,
    contextState: snapshot.contextState,
    handleSubmit: (input) => channel.handleInput(input),
    handleAbort: () => channel.abort(),
    handleCancelQueue: () => channel.cancelQueue(),
    handleShutdown: (reason) => channel.shutdown({ reason }),
    sendAgentJob: (taskId, input) => channel.sendAgentJob(taskId, input),
    resolveUserAction: (request, response) => channel.resolveUserAction(request, response),
    getRuntimeStatusSnapshot: (fallback) => channel.getRuntimeStatusSnapshot(fallback),
    selectExecutionWorkspaceEntry,
    readExecutionWorkspaceDetail,
  };
}
