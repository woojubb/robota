/**
 * Hook: thin React bridge over TuiStateManager + InteractiveSession.
 *
 * TuiStateManager owns all rendering state and event→state logic (testable).
 * This hook only connects TuiStateManager to React re-renders and handles
 * slash command routing (TUI-specific input processing).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  InteractiveSession,
  CommandRegistry,
  BuiltinCommandSource,
  SkillCommandSource,
  PluginCommandSource,
  BundlePluginLoader,
  buildSkillPrompt,
} from '@robota-sdk/agent-sdk';
import type { IAIProvider, TPermissionResultValue } from '@robota-sdk/agent-sdk';
import type {
  TPermissionMode,
  TUniversalMessage,
  TToolArgs,
  IHistoryEntry,
} from '@robota-sdk/agent-core';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { randomUUID } from 'node:crypto';
import type { IPermissionRequest } from '../types.js';
import { TuiStateManager } from '../tui-state-manager.js';

/** Side-effect flags for TUI-specific actions */
export interface ISideEffects {
  _pendingModelId?: string;
  _pendingLanguage?: string;
  _resetRequested?: boolean;
  _exitRequested?: boolean;
  _triggerPluginTUI?: boolean;
  _triggerResumePicker?: boolean;
  _sessionName?: string;
}

import type { SessionStore } from '@robota-sdk/agent-sessions';

export interface IInteractiveSessionProps {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: SessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
}

export interface IInteractiveSessionState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  history: IHistoryEntry[];
  addEntry: (entry: IHistoryEntry) => void;
  streamingText: string;
  activeTools: import('@robota-sdk/agent-sdk').IToolState[];
  isThinking: boolean;
  isAborting: boolean;
  pendingPrompt: string | null;
  permissionRequest: IPermissionRequest | null;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  handleSubmit: (input: string) => Promise<void>;
  handleAbort: () => void;
  handleCancelQueue: () => void;
}

interface IInitState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  manager: TuiStateManager;
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
  });

  const registry = new CommandRegistry();
  registry.addSource(new BuiltinCommandSource());
  registry.addSource(new SkillCommandSource(props.cwd));

  const pluginsDir = join(homedir(), '.robota', 'plugins');
  const loader = new BundlePluginLoader(pluginsDir);
  try {
    const plugins = loader.loadPluginsSync();
    if (plugins.length > 0) {
      registry.addSource(new PluginCommandSource(plugins));
    }
  } catch {
    // No plugins dir or load failed
  }

  const manager = new TuiStateManager();

  return { interactiveSession, registry, manager };
}

export function useInteractiveSession(props: IInteractiveSessionProps): IInteractiveSessionState {
  const [, forceRender] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);

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
  const { interactiveSession, registry, manager } = stateRef.current;

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
    interactiveSession.on('text_delta', manager.onTextDelta);
    interactiveSession.on('tool_start', manager.onToolStart);
    interactiveSession.on('tool_end', manager.onToolEnd);
    interactiveSession.on('thinking', manager.onThinking);
    interactiveSession.on('complete', manager.onComplete);
    interactiveSession.on('interrupted', manager.onInterrupted);
    interactiveSession.on('error', manager.onError);

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

  // Slash command routing (TUI-specific input processing)
  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/);
        const cmd = parts[0]?.toLowerCase() ?? '';
        const args = parts.slice(1).join(' ');

        const result = await interactiveSession.executeCommand(cmd, args);
        if (result) {
          manager.addEntry(messageToHistoryEntry(createSystemMessage(result.message)));
          const effects = interactiveSession as InteractiveSession & ISideEffects;
          if (result.data?.modelId) {
            effects._pendingModelId = result.data.modelId as string;
            return;
          }
          if (result.data?.language) {
            effects._pendingLanguage = result.data.language as string;
            return;
          }
          if (result.data?.resetRequested) {
            effects._resetRequested = true;
            return;
          }
          if (result.data?.triggerResumePicker) {
            effects._triggerResumePicker = true;
            return;
          }
          if (result.data?.name) {
            effects._sessionName = result.data.name as string;
            return;
          }
          const ctx = interactiveSession.getContextState();
          manager.setContextState({
            percentage: ctx.usedPercentage,
            usedTokens: ctx.usedTokens,
            maxTokens: ctx.maxTokens,
          });
          return;
        }

        const skillCmd = registry
          .getCommands()
          .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
        if (skillCmd) {
          manager.addEntry({
            id: randomUUID(),
            timestamp: new Date(),
            category: 'event',
            type: 'skill-invocation',
            data: {
              skillName: cmd,
              source: skillCmd.source,
              message: `Invoking ${skillCmd.source}: ${cmd}`,
            },
          });
          const prompt = await buildSkillPrompt(input, registry);
          if (prompt) {
            const qualifiedName = registry.resolveQualifiedName(cmd);
            const hookInput = qualifiedName
              ? `/${qualifiedName}${input.slice(1 + cmd.length)}`
              : input;
            await interactiveSession.submit(prompt, input, hookInput);
            manager.setPendingPrompt(interactiveSession.getPendingPrompt());
            return;
          }
        }

        if (cmd === 'exit') {
          (interactiveSession as InteractiveSession & ISideEffects)._exitRequested = true;
          return;
        }
        if (cmd === 'plugin') {
          (interactiveSession as InteractiveSession & ISideEffects)._triggerPluginTUI = true;
          return;
        }

        manager.addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`),
          ),
        );
        return;
      }
      await interactiveSession.submit(input);
      manager.setPendingPrompt(interactiveSession.getPendingPrompt());
    },
    [interactiveSession, registry, manager],
  );

  const handleAbort = useCallback(() => {
    manager.setAborting(true);
    interactiveSession.abort();
  }, [interactiveSession, manager]);

  const handleCancelQueue = useCallback(() => {
    interactiveSession.cancelQueue();
    manager.setPendingPrompt(null);
  }, [interactiveSession, manager]);

  return {
    interactiveSession,
    registry,
    history: manager.history,
    addEntry: (entry: IHistoryEntry) => manager.addEntry(entry),
    streamingText: manager.streamingText,
    activeTools: manager.activeTools,
    isThinking: manager.isThinking,
    isAborting: manager.isAborting,
    pendingPrompt: manager.pendingPrompt,
    permissionRequest,
    contextState: manager.contextState,
    handleSubmit,
    handleAbort,
    handleCancelQueue,
  };
}
