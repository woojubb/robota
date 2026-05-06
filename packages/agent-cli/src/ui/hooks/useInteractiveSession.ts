/**
 * Hook: thin React bridge over TuiStateManager + InteractiveSession.
 *
 * TuiStateManager owns all rendering state and event→state logic (testable).
 * This hook only connects TuiStateManager to React re-renders and handles
 * slash command routing (TUI-specific input processing).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  InteractiveSession,
  CommandRegistry,
  createBuiltinCommandModule,
  SkillCommandSource,
} from '@robota-sdk/agent-sdk';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IInteractiveSessionStore,
  TSubagentRunnerFactory,
  TPermissionResultValue,
} from '@robota-sdk/agent-sdk';
import type {
  IAIProvider,
  TPermissionMode,
  TToolArgs,
  IHistoryEntry,
  TSessionEndReason,
} from '@robota-sdk/agent-core';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { IPermissionRequest } from '../types.js';
import { TuiStateManager } from '../tui-state-manager.js';
import { useSlashRouting } from './useSlashRouting.js';
import { CommandEffectQueue, type ICommandEffectQueue } from './command-effect-queue.js';
import { reloadPluginCommandSource } from '../../plugins/plugin-command-source-loader.js';

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
  backgroundTasks: import('../tui-state-manager.js').IBackgroundTaskViewModel[];
  permissionRequest: IPermissionRequest | null;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  handleSubmit: (input: string) => Promise<void>;
  handleAbort: () => void;
  handleCancelQueue: () => void;
  handleShutdown: (reason?: TSessionEndReason) => Promise<void>;
}

interface IInitState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  commandEffectQueue: ICommandEffectQueue;
  manager: TuiStateManager;
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

function initializeSession(
  props: IInteractiveSessionProps,
  permissionHandler: (toolName: string, toolArgs: TToolArgs) => Promise<TPermissionResultValue>,
): IInitState {
  const interactiveSession = new InteractiveSession({
    cwd: props.cwd,
    provider: props.provider,
    permissionMode: props.permissionMode,
    maxTurns: props.maxTurns,
    permissionHandler,
    sessionStore: props.sessionStore,
    resumeSessionId: props.resumeSessionId,
    forkSession: props.forkSession,
    sessionName: props.sessionName,
    backgroundTaskRunners: props.backgroundTaskRunners,
    subagentRunnerFactory: props.subagentRunnerFactory,
    commandModules: props.commandModules,
    commandHostAdapters: props.commandHostAdapters,
  });

  const registry = new CommandRegistry();
  registry.addModule(createBuiltinCommandModule());
  for (const module of props.commandModules ?? []) {
    registry.addModule(module);
  }
  registry.addSource(new SkillCommandSource(props.cwd));

  reloadPluginCommandSource(registry);

  const manager = new TuiStateManager();
  const commandEffectQueue = new CommandEffectQueue();

  return { interactiveSession, registry, manager, commandEffectQueue };
}

export function useInteractiveSession(props: IInteractiveSessionProps): IInteractiveSessionState {
  const [, forceRender] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  // Permission queue (TUI-specific — needs React state for UI)
  const permissionQueueRef = useRef<
    Array<{
      toolName: string;
      toolArgs: TToolArgs;
      resolve: (result: TPermissionResultValue) => void;
    }>
  >([]);
  const processingRef = useRef(false);

  const processNextPermission = useCallback(() => {
    if (processingRef.current) return;
    const next = permissionQueueRef.current[0];
    if (!next) {
      setPermissionRequest(null);
      return;
    }
    processingRef.current = true;
    setPermissionRequest({
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result: TPermissionResultValue) => {
        permissionQueueRef.current.shift();
        processingRef.current = false;
        setPermissionRequest(null);
        next.resolve(result);
        setTimeout(() => processNextPermission(), 0);
      },
    });
  }, []);

  const permissionHandler = useCallback(
    (toolName: string, toolArgs: TToolArgs): Promise<TPermissionResultValue> =>
      new Promise<TPermissionResultValue>((resolve) => {
        permissionQueueRef.current.push({ toolName, toolArgs, resolve });
        processNextPermission();
      }),
    [processNextPermission],
  );

  // Initialize once
  const stateRef = useRef<IInitState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = initializeSession(props, permissionHandler);
  }
  const { interactiveSession, registry, manager, commandEffectQueue } = stateRef.current;

  // Connect TuiStateManager to React re-renders
  manager.onChange = () => forceRender((n) => n + 1);

  // Sync restored history immediately (session resume restores history in constructor)
  if (manager.history.length === 0) {
    const restored = interactiveSession.getFullHistory();
    if (restored.length > 0) {
      manager.syncHistory(restored);
    }
  }

  // Connect InteractiveSession events to TuiStateManager
  useEffect(() => {
    const onCompact = (): void => applyCompactEventToManager(interactiveSession, manager);
    const onSkillActivation = (): void =>
      applySkillActivationEventToManager(interactiveSession, manager);

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
    interactiveSession.on('background_task_event', manager.onBackgroundTaskEvent);

    // Sync context state and restored history after async initialization
    const initCheck = setInterval(() => {
      try {
        const ctx = interactiveSession.getContextState();
        manager.setContextState({
          percentage: ctx.usedPercentage,
          usedTokens: ctx.usedTokens,
          maxTokens: ctx.maxTokens,
        });
        // Sync restored history (from session resume) on first init
        const restored = interactiveSession.getFullHistory();
        if (restored.length > 0) {
          manager.syncHistory(restored);
        }
        clearInterval(initCheck);
      } catch {
        /* Not yet initialized */
      }
    }, 200);

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
      interactiveSession.off('background_task_event', manager.onBackgroundTaskEvent);
    };
  }, [interactiveSession, manager]);

  // Sync messages on every thinking state change:
  // - thinking=true: "You:" and "System: Invoking..." are already in messages
  // - thinking=false: complete/interrupted messages are in messages
  useEffect(() => {
    manager.syncHistory(interactiveSession.getFullHistory());
    if (!manager.isThinking) {
      manager.setPendingPrompt(interactiveSession.getPendingPrompt());
    }
  }, [manager.isThinking, interactiveSession, manager]);

  // Slash command routing (delegated to useSlashRouting)
  const handleSubmit = useSlashRouting(interactiveSession, registry, manager, commandEffectQueue);

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
    backgroundTasks: manager.backgroundTasks,
    permissionRequest,
    contextState: manager.contextState,
    handleSubmit,
    handleAbort,
    handleCancelQueue,
    handleShutdown,
  };
}
