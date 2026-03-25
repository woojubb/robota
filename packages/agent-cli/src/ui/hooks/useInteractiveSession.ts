/**
 * Hook: bridge InteractiveSession (SDK, pure TypeScript) events
 * to React state for TUI rendering.
 *
 * This is the ONLY place where SDK's InteractiveSession meets React.
 * All business logic lives in SDK; this hook only converts events → state.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-sdk';
import type { IAIProvider, IToolState, IExecutionResult } from '@robota-sdk/agent-sdk';
import type { TPermissionMode, TUniversalMessage, TToolArgs } from '@robota-sdk/agent-core';
import { createSystemMessage } from '@robota-sdk/agent-core';
import type { TPermissionResult } from '@robota-sdk/agent-sessions';
import { buildSkillPrompt } from '../../utils/skill-prompt.js';
import type { IPermissionRequest } from '../types.js';

/** Max messages kept in React state for rendering */
const MAX_RENDERED_MESSAGES = 100;

/** Side-effect flags for TUI-specific actions */
export interface ISideEffects {
  _pendingModelId?: string;
  _pendingLanguage?: string;
  _resetRequested?: boolean;
  _exitRequested?: boolean;
  _triggerPluginTUI?: boolean;
}

export interface IInteractiveSessionProps {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
}

export interface IInteractiveSessionState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  messages: TUniversalMessage[];
  addMessage: (msg: TUniversalMessage) => void;
  setMessages: React.Dispatch<React.SetStateAction<TUniversalMessage[]>>;
  streamingText: string;
  activeTools: IToolState[];
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
}

function initializeSession(
  props: IInteractiveSessionProps,
  permissionHandler: (toolName: string, toolArgs: TToolArgs) => Promise<TPermissionResult>,
): IInitState {
  const interactiveSession = new InteractiveSession({
    cwd: props.cwd,
    provider: props.provider,
    permissionMode: props.permissionMode,
    maxTurns: props.maxTurns,
    permissionHandler,
  });

  // Registry for autocomplete UI — InteractiveSession manages commands internally
  const registry = new CommandRegistry();

  return { interactiveSession, registry };
}

export function useInteractiveSession(props: IInteractiveSessionProps): IInteractiveSessionState {
  const [messages, setMessages] = useState<TUniversalMessage[]>([]);
  const addMessage = useCallback((msg: TUniversalMessage) => {
    setMessages((prev) => {
      const updated = [...prev, msg];
      return updated.length > MAX_RENDERED_MESSAGES
        ? updated.slice(-MAX_RENDERED_MESSAGES)
        : updated;
    });
  }, []);

  const [streamingText, setStreamingText] = useState('');
  const [activeTools, setActiveTools] = useState<IToolState[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [contextState, setContextState] = useState({ percentage: 0, usedTokens: 0, maxTokens: 0 });
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);

  const permissionQueueRef = useRef<
    Array<{ toolName: string; toolArgs: TToolArgs; resolve: (result: TPermissionResult) => void }>
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
      resolve: (result: TPermissionResult) => {
        permissionQueueRef.current.shift();
        processingRef.current = false;
        setPermissionRequest(null);
        next.resolve(result);
        setTimeout(() => processNextPermission(), 0);
      },
    });
  }, []);

  const permissionHandler = useCallback(
    (toolName: string, toolArgs: TToolArgs): Promise<TPermissionResult> =>
      new Promise<TPermissionResult>((resolve) => {
        permissionQueueRef.current.push({ toolName, toolArgs, resolve });
        processNextPermission();
      }),
    [processNextPermission],
  );

  const stateRef = useRef<IInitState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = initializeSession(props, permissionHandler);
  }
  const { interactiveSession, registry } = stateRef.current;

  useEffect(() => {
    let streamBuf = '';
    const onTextDelta = (delta: string): void => {
      streamBuf += delta;
      setStreamingText(streamBuf);
    };
    const onToolStart = (state: IToolState): void => {
      setActiveTools((prev) => [...prev, state]);
    };
    const onToolEnd = (state: IToolState): void => {
      setActiveTools((prev) =>
        prev.map((t) => (t.toolName === state.toolName && t.isRunning ? state : t)),
      );
    };
    const onThinking = (thinking: boolean): void => {
      setIsThinking(thinking);
      if (thinking) {
        // Clear streaming state at the START of new execution, not at the end.
        // This preserves tool list for display after execution completes.
        streamBuf = '';
        setStreamingText('');
        setActiveTools([]);
      } else {
        setIsAborting(false);
      }
    };
    const onComplete = (result: IExecutionResult): void => {
      setContextState({
        percentage: result.contextState.usedPercentage,
        usedTokens: result.contextState.usedTokens,
        maxTokens: result.contextState.maxTokens,
      });
    };
    const onInterrupted = (): void => {
      /* messages managed by InteractiveSession */
    };
    const onError = (): void => {
      /* error messages managed by InteractiveSession */
    };

    interactiveSession.on('text_delta', onTextDelta);
    interactiveSession.on('tool_start', onToolStart);
    interactiveSession.on('tool_end', onToolEnd);
    interactiveSession.on('thinking', onThinking);
    interactiveSession.on('complete', onComplete);
    interactiveSession.on('interrupted', onInterrupted);
    interactiveSession.on('error', onError);

    // Sync context state after async initialization completes
    const initCheck = setInterval(() => {
      try {
        const ctx = interactiveSession.getContextState();
        setContextState({
          percentage: ctx.usedPercentage,
          usedTokens: ctx.usedTokens,
          maxTokens: ctx.maxTokens,
        });
        clearInterval(initCheck);
      } catch {
        // Not yet initialized — retry
      }
    }, 200);
    return () => {
      clearInterval(initCheck);
      interactiveSession.off('text_delta', onTextDelta);
      interactiveSession.off('tool_start', onToolStart);
      interactiveSession.off('tool_end', onToolEnd);
      interactiveSession.off('thinking', onThinking);
      interactiveSession.off('complete', onComplete);
      interactiveSession.off('interrupted', onInterrupted);
      interactiveSession.off('error', onError);
    };
  }, [interactiveSession]);

  useEffect(() => {
    if (!isThinking) {
      const sessionMessages = interactiveSession.getMessages();
      if (sessionMessages.length > 0) {
        setMessages(
          sessionMessages.length > MAX_RENDERED_MESSAGES
            ? sessionMessages.slice(-MAX_RENDERED_MESSAGES)
            : [...sessionMessages],
        );
      }
      setPendingPrompt(interactiveSession.getPendingPrompt());
    }
  }, [isThinking, interactiveSession]);

  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/);
        const cmd = parts[0]?.toLowerCase() ?? '';
        const args = parts.slice(1).join(' ');

        const result = await interactiveSession.executeCommand(cmd, args);
        if (result) {
          addMessage(createSystemMessage(result.message));
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
          const ctx = interactiveSession.getContextState();
          setContextState({
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
          addMessage(createSystemMessage(`Invoking ${skillCmd.source}: ${cmd}`));
          const prompt = await buildSkillPrompt(input, registry);
          if (prompt) {
            // Resolve qualified name for hook matching (e.g., /audit → /rulebased-harness:audit)
            const qualifiedName = registry.resolveQualifiedName(cmd);
            const hookInput = qualifiedName
              ? `/${qualifiedName}${input.slice(1 + cmd.length)}`
              : input;
            await interactiveSession.submit(prompt, input, hookInput);
            setPendingPrompt(interactiveSession.getPendingPrompt());
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

        addMessage(createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`));
        return;
      }
      await interactiveSession.submit(input);
      // Sync queue state immediately so UI shows "Queued:" indicator
      setPendingPrompt(interactiveSession.getPendingPrompt());
    },
    [interactiveSession, registry, addMessage],
  );

  const handleAbort = useCallback(() => {
    setIsAborting(true);
    interactiveSession.abort();
  }, [interactiveSession]);
  const handleCancelQueue = useCallback(() => {
    interactiveSession.cancelQueue();
    setPendingPrompt(null);
  }, [interactiveSession]);

  // Context state is initialized after async session setup.
  // Don't call getContextState() synchronously — it may throw before init.

  return {
    interactiveSession,
    registry,
    messages,
    addMessage,
    setMessages,
    streamingText,
    activeTools,
    isThinking,
    isAborting,
    pendingPrompt,
    permissionRequest,
    contextState,
    handleSubmit,
    handleAbort,
    handleCancelQueue,
  };
}
