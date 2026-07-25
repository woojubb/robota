/**
 * useTuiChannel — React hook that subscribes to TuiInteractionChannel state changes.
 *
 * Returns the same shape as the former IInteractiveSessionState so that App.tsx
 * changes are minimal.
 */

import { useState, useEffect, useCallback } from 'react';

import type { TuiInteractionChannel } from '../TuiInteractionChannel.js';
import type { IPendingPermissionRequest } from '../types.js';
import type { IActionRequest, IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';
import type { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-framework';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceSnapshot,
  IToolState,
} from '@robota-sdk/agent-interface-transport';

export interface IInteractiveSessionState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  history: IHistoryEntry[];
  addEntry: (entry: IHistoryEntry) => void;
  streamingText: string;
  activeTools: IToolState[];
  isThinking: boolean;
  isAborting: boolean;
  /** ERR-001 G2: humanized message of the last failed turn (null once the next turn starts). */
  lastErrorMessage: string | null;
  /** ERR-001 G3: no provider activity for a while during a turn — connection may be stalled. */
  isStalled: boolean;
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

export function useTuiChannel(channel: TuiInteractionChannel): IInteractiveSessionState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    channel.onChange = () => forceRender((n) => n + 1);
    return () => {
      channel.onChange = null;
    };
  }, [channel]);

  const manager = channel.stateManager;

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
    interactiveSession: channel.getSession(),
    registry: channel.getRegistry(),
    history: manager.history,
    addEntry: (e) => manager.addEntry(e),
    streamingText: manager.streamingText,
    activeTools: manager.activeTools,
    isThinking: manager.isThinking,
    isAborting: manager.isAborting,
    lastErrorMessage: manager.lastErrorMessage,
    isStalled: manager.isStalled,
    isShuttingDown: channel.isShuttingDown,
    pendingPrompt: manager.pendingPrompt,
    // Read live from the session (the co-drive queue is session-owned); optional getter → 0 on older mocks.
    pendingCount: channel.getSession().getPendingCount?.() ?? (manager.pendingPrompt ? 1 : 0),
    executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
    selectedExecutionEntryId: manager.selectedExecutionEntryId,
    permissionRequest: channel.permissionRequest,
    pendingUserAction: channel.pendingUserAction ?? null,
    contextState: manager.contextState,
    handleSubmit: (input) => channel.handleInput(input),
    handleAbort: () => channel.abort(),
    handleCancelQueue: () => channel.cancelQueue(),
    handleShutdown: (reason) => channel.shutdown({ reason }),
    selectExecutionWorkspaceEntry,
    readExecutionWorkspaceDetail,
  };
}
