import { useState, useCallback, useEffect } from 'react';
import { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-sdk';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IInteractiveSession,
  IInteractiveSessionStore,
  TSubagentRunnerFactory,
  IExecutionDetailPage,
  IExecutionWorkspaceSnapshot,
  TShellExecFn,
} from '@robota-sdk/agent-sdk';
import type {
  IAIProvider,
  TPermissionMode,
  IHistoryEntry,
  TSessionEndReason,
} from '@robota-sdk/agent-core';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { IPermissionRequest } from '../types.js';
import { TuiStateManager } from '../tui-state-manager.js';
import { useSlashRouting } from './useSlashRouting.js';
import { CommandEffectQueue, type ICommandEffectQueue } from './command-effect-queue.js';
import { usePermissionQueue } from './usePermissionQueue.js';
import { initializeSession, type IInitState } from './use-interactive-session-init.js';

const SESSION_INIT_POLL_MS = 200;

export interface IInteractiveSessionProps {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  language?: string;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
}

export interface IInteractiveSessionState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  commandEffectQueue: ICommandEffectQueue;
  history: IHistoryEntry[];
  addEntry: (entry: IHistoryEntry) => void;
  streamingText: string;
  activeTools: import('@robota-sdk/agent-sdk').IToolState[];
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

export function applySkillActivationEventToManager(
  interactiveSession: IHistoryReadableSession,
  manager: IHistorySyncManager,
): void {
  manager.syncHistory(interactiveSession.getFullHistory());
}

function syncExecutionWorkspaceFromSession(
  interactiveSession: InteractiveSession,
  manager: TuiStateManager,
): void {
  try {
    manager.syncExecutionWorkspaceSnapshot(
      interactiveSession.getExecutionWorkspaceSnapshot({
        selectedEntryId: manager.selectedExecutionEntryId,
      }),
    );
  } catch {
    // allow-fallback: session may not be initialized yet; swallow until ready
    /* Session not initialized yet */
  }
}

export function useInteractiveSession(props: IInteractiveSessionProps): IInteractiveSessionState {
  const [, forceRender] = useState(0);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { permissionHandler, permissionRequest } = usePermissionQueue();

  // Initialize once — useState lazy initializer runs exactly once per mount, safe for Concurrent Mode
  const [initState] = useState<IInitState>(() => initializeSession(props, permissionHandler));
  const { interactiveSession, registry, manager, commandEffectQueue } = initState;

  manager.onChange = () => forceRender((n) => n + 1);

  // Sync restored history immediately (session resume restores history in constructor)
  if (manager.history.length === 0) {
    const restored = interactiveSession.getFullHistory();
    if (restored.length > 0) {
      manager.syncHistory(restored);
    }
  }

  // Start transports (settings-driven: WS + web-monitor based on registry config).
  useEffect(() => {
    if (!props.transportRegistry) return;
    const reg = props.transportRegistry;
    reg.startAll(interactiveSession).catch(() => undefined);
    return () => {
      reg.stopAll().catch(() => undefined);
    };
  }, [interactiveSession, props.transportRegistry]);

  // Connect InteractiveSession events to TuiStateManager
  useEffect(() => {
    const onCompact = (): void => applyCompactEventToManager(interactiveSession, manager);
    const onSkillActivation = (): void =>
      applySkillActivationEventToManager(interactiveSession, manager);
    const onExecutionWorkspaceEvent = (
      event: import('@robota-sdk/agent-sdk').IExecutionWorkspaceEvent,
    ): void => manager.syncExecutionWorkspaceSnapshot(event.snapshot);

    interactiveSession.on('text_delta', manager.onTextDelta);
    interactiveSession.on('tool_start', manager.onToolStart);
    interactiveSession.on('tool_end', manager.onToolEnd);
    interactiveSession.on('thinking', manager.onThinking);
    interactiveSession.on('complete', manager.onComplete);
    interactiveSession.on('interrupted', manager.onInterrupted);
    interactiveSession.on('error', manager.onError);
    interactiveSession.on('context_update', manager.onContextUpdate);
    interactiveSession.on('compact', onCompact);
    interactiveSession.on('skill_activation', onSkillActivation);
    interactiveSession.on('execution_workspace_event', onExecutionWorkspaceEvent);

    // Sync context state and restored history after async initialization
    const initCheck = setInterval(() => {
      try {
        const ctx = interactiveSession.getContextState();
        manager.setContextState({
          percentage: ctx.usedPercentage,
          usedTokens: ctx.usedTokens,
          maxTokens: ctx.maxTokens,
        });
        const restored = interactiveSession.getFullHistory();
        if (restored.length > 0) {
          manager.syncHistory(restored);
        }
        syncExecutionWorkspaceFromSession(interactiveSession, manager);
        clearInterval(initCheck);
      } catch {
        // allow-fallback: session initializes asynchronously; poll until ready
        /* Not yet initialized */
      }
    }, SESSION_INIT_POLL_MS);

    return () => {
      clearInterval(initCheck);
      interactiveSession.off('text_delta', manager.onTextDelta);
      interactiveSession.off('tool_start', manager.onToolStart);
      interactiveSession.off('tool_end', manager.onToolEnd);
      interactiveSession.off('thinking', manager.onThinking);
      interactiveSession.off('complete', manager.onComplete);
      interactiveSession.off('interrupted', manager.onInterrupted);
      interactiveSession.off('error', manager.onError);
      interactiveSession.off('context_update', manager.onContextUpdate);
      interactiveSession.off('compact', onCompact);
      interactiveSession.off('skill_activation', onSkillActivation);
      interactiveSession.off('execution_workspace_event', onExecutionWorkspaceEvent);
    };
  }, [interactiveSession, manager]);

  // Sync messages on every thinking state change:
  // - thinking=true: "You:" and "System: Invoking..." are already in messages
  // - thinking=false: complete/interrupted messages are in messages
  useEffect(() => {
    manager.syncHistory(interactiveSession.getFullHistory());
    syncExecutionWorkspaceFromSession(interactiveSession, manager);
    if (!manager.isThinking) {
      manager.setPendingPrompt(interactiveSession.getPendingPrompt());
    }
  }, [manager.isThinking, interactiveSession, manager]);

  const handleSubmit = useSlashRouting(
    interactiveSession,
    registry,
    manager,
    commandEffectQueue,
    props.reloadPluginCommandSource,
  );

  const handleAbort = useCallback(() => {
    manager.setAborting(true);
    interactiveSession.abort();
  }, [interactiveSession, manager]);

  const handleCancelQueue = useCallback(() => {
    interactiveSession.cancelQueue();
    manager.setPendingPrompt(null);
  }, [interactiveSession, manager]);

  const handleShutdown = useCallback(
    async (reason: TSessionEndReason = 'prompt_input_exit'): Promise<void> => {
      if (isShuttingDown) return;
      setIsShuttingDown(true);
      manager.addEntry(messageToHistoryEntry(createSystemMessage('Shutting down...')));
      await interactiveSession.shutdown({ reason, message: 'CLI shutdown' });
    },
    [interactiveSession, manager, isShuttingDown],
  );

  const selectExecutionWorkspaceEntry = useCallback(
    (entryId: string): void => manager.selectExecutionWorkspaceEntry(entryId),
    [manager],
  );

  const readExecutionWorkspaceDetail = useCallback(
    (entryId: string): Promise<IExecutionDetailPage> =>
      interactiveSession.readExecutionWorkspaceDetail(entryId),
    [interactiveSession],
  );

  return {
    interactiveSession,
    registry,
    commandEffectQueue,
    history: manager.history,
    addEntry: (entry: IHistoryEntry) => manager.addEntry(entry),
    streamingText: manager.streamingText,
    activeTools: manager.activeTools,
    isThinking: manager.isThinking,
    isAborting: manager.isAborting,
    isShuttingDown,
    pendingPrompt: manager.pendingPrompt,
    executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
    selectedExecutionEntryId: manager.selectedExecutionEntryId,
    permissionRequest,
    contextState: manager.contextState,
    handleSubmit,
    handleAbort,
    handleCancelQueue,
    handleShutdown,
    selectExecutionWorkspaceEntry,
    readExecutionWorkspaceDetail,
  };
}
