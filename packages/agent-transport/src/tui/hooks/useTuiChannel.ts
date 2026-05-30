/**
 * useTuiChannel — React hook that subscribes to TuiInteractionChannel state changes.
 *
 * Returns the same shape as the former IInteractiveSessionState so that App.tsx
 * changes are minimal.
 */

import { useState, useEffect } from 'react';

import type { TuiInteractionChannel } from '../TuiInteractionChannel.js';
import type { ICommandEffectQueue } from './command-effect-queue.js';
import type { IPermissionRequest } from '../types.js';
import type { IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';
import type { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-framework';
import type {
  IToolState,
  IExecutionWorkspaceSnapshot,
  IExecutionDetailPage,
} from '@robota-sdk/agent-framework';

export interface IInteractiveSessionState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  commandEffectQueue: ICommandEffectQueue;
  history: IHistoryEntry[];
  addEntry: (entry: IHistoryEntry) => void;
  streamingText: string;
  activeTools: IToolState[];
  isThinking: boolean;
  isAborting: boolean;
  isShuttingDown: boolean;
  pendingPrompt: string | null;
  executionWorkspaceSnapshot: IExecutionWorkspaceSnapshot | null;
  selectedExecutionEntryId?: string;
  permissionRequest: IPermissionRequest | null;
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

  return {
    interactiveSession: channel.getSession(),
    registry: channel.getRegistry(),
    commandEffectQueue: channel.getCommandEffectQueue(),
    history: manager.history,
    addEntry: (e) => manager.addEntry(e),
    streamingText: manager.streamingText,
    activeTools: manager.activeTools,
    isThinking: manager.isThinking,
    isAborting: manager.isAborting,
    isShuttingDown: channel.isShuttingDown,
    pendingPrompt: manager.pendingPrompt,
    executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
    selectedExecutionEntryId: manager.selectedExecutionEntryId,
    permissionRequest: channel.permissionRequest,
    contextState: manager.contextState,
    handleSubmit: (input) => channel.handleInput(input),
    handleAbort: () => channel.abort(),
    handleCancelQueue: () => channel.cancelQueue(),
    handleShutdown: (reason) => channel.shutdown({ reason }),
    selectExecutionWorkspaceEntry: (id) => channel.selectExecutionWorkspaceEntry(id),
    readExecutionWorkspaceDetail: (id) => channel.readExecutionWorkspaceDetail(id),
  };
}
