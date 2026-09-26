/**
 * GUI-005 — the transport-neutral session reducer for the GUI presentation layer. Reconstructs conversation
 * state from the wire `TServerMessage` stream, independent of HOW the bytes arrive (a `TMakeSessionClient`
 * factory over `{onMessage, onStatusChange}`). The core is **generic over its status type** (default
 * `TConnectionStatus`) so a surface with extra connection states (e.g. the browser WebRTC surface) can widen it
 * WITHOUT this core depending on that surface's types — keeping the dependency direction acyclic.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import {
  applyPromptEvent,
  askResponse,
  permissionResponse,
  type TPendingPrompt,
} from './prompt-state.js';
import { describeUiIntentForGui, uiIntentCommandName } from './ui-intent-state.js';
import { createWsSessionClient } from '../client/ws-session-client.js';
import { SERVER_MESSAGE_HANDLING } from './server-message-handling.js';
import { usePersonalUsageState } from './use-personal-usage.js';

import type {
  IActiveTool,
  ISessionClientHandle,
  ISessionNotice,
  IWsSessionState,
  TCommandCatalog,
  TConversationEntry,
  TMakeSessionClient,
  TSessionStatus,
} from './session-client-types.js';
import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type { TPermissionResultValue } from '@robota-sdk/agent-interface-session';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';
import type { TServerMessage } from '@robota-sdk/agent-transport';

export type {
  IActiveTool,
  ICommandOutputEntry,
  IConversationMessage,
  IToolGroupEntry,
  ISessionClientHandle,
  ISessionNotice,
  IWsSessionState,
  TConversationEntry,
  TMakeSessionClient,
} from './session-client-types.js';

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function useSessionClient<TStatus extends string = TConnectionStatus>(
  makeClient: TMakeSessionClient<TStatus>,
): IWsSessionState<TStatus> {
  const [status, setStatus] = useState<TStatus>('disconnected' as TStatus);
  const [messages, setMessages] = useState<TConversationEntry[]>([]);
  const [activeTools, setActiveTools] = useState<IActiveTool[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [executionWorkspace, setExecutionWorkspace] = useState<IExecutionWorkspaceSnapshot | null>(
    null,
  );
  const [pendingPrompts, setPendingPrompts] = useState<readonly TPendingPrompt[]>([]);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionNotices, setSessionNotices] = useState<readonly ISessionNotice[]>([]);
  const [commandCatalog, setCommandCatalog] = useState<TCommandCatalog | null>(null);
  const [sessionStatus, setSessionStatus] = useState<TSessionStatus | null>(null);

  const clientRef = useRef<ISessionClientHandle | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef('');
  // The tools of the running turn, mirrored so the turn's end can keep them in the conversation.
  const activeToolsRef = useRef<IActiveTool[]>([]);
  // A screen this surface's command asked for and cannot show; it answers the command in place of
  // the command's own reply.
  const pendingIntentRef = useRef<{ name: string; text: string } | null>(null);
  const updateActiveTools = useCallback((next: (previous: IActiveTool[]) => IActiveTool[]): void => {
    activeToolsRef.current = next(activeToolsRef.current);
    setActiveTools(activeToolsRef.current);
  }, []);
  const appendEntry = useCallback((entry: TConversationEntry): void => {
    setMessages((previous) => [...previous, entry]);
  }, []);
  /** End the running turn: its tool calls and any streamed text stay in the conversation. */
  const finishTurn = useCallback(
    (toolStatus: (tool: IActiveTool) => IActiveTool['status']): void => {
      const finalText = streamingTextRef.current;
      const sid = streamingIdRef.current;
      const tools = activeToolsRef.current;
      streamingTextRef.current = '';
      streamingIdRef.current = null;
      setStreamingText('');
      setIsThinking(false);
      updateActiveTools(() => []);
      if (tools.length > 0) {
        appendEntry({
          id: nextId(),
          role: 'tools',
          tools: tools.map((tool) => ({ ...tool, status: toolStatus(tool) })),
        });
      }
      if (finalText) appendEntry({ id: sid ?? nextId(), role: 'assistant', content: finalText });
    },
    [appendEntry, updateActiveTools],
  );
  // Commands this surface sent whose result has not come back — a screen request pairs with one.
  const commandsInFlightRef = useRef(0);
  const send = useCallback((msg: TClientMessage): void => {
    if (msg.type === 'command') commandsInFlightRef.current += 1;
    clientRef.current?.send(msg);
  }, []);
  const { handleUsageMessage, ...personalUsageState } = usePersonalUsageState(send);

  const handleMessage = useCallback(
    (msg: TServerMessage): void => {
      // ARCH-2164: touching the exhaustive registry here keeps every decoded variant tied to an
      // explicit GUI ownership decision, including variants intentionally handled by focused views.
      void SERVER_MESSAGE_HANDLING[msg.type];
      if (handleUsageMessage(msg)) return;
      switch (msg.type) {
        case 'messages': {
          const reconstructed: TConversationEntry[] = msg.messages.flatMap((m) => {
            if (m.role !== 'user' && m.role !== 'assistant') return [];
            const content = m.content ?? '';
            return [{ id: nextId(), role: m.role as 'user' | 'assistant', content }];
          });
          setMessages(reconstructed);
          break;
        }
        case 'user_message': {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'user',
              content: msg.content ?? '',
              ...(msg.driverId ? { author: msg.driverId } : {}),
            },
          ]);
          break;
        }
        case 'text_delta': {
          setStreamingText((prev) => {
            const next = prev + msg.delta;
            streamingTextRef.current = next;
            if (streamingIdRef.current === null) {
              streamingIdRef.current = nextId();
            }
            return next;
          });
          break;
        }
        case 'thinking': {
          setIsThinking(msg.isThinking);
          break;
        }
        case 'tool_start': {
          const { state } = msg;
          const toolId = nextId();
          updateActiveTools((prev) => [
            ...prev,
            { id: toolId, name: state.toolName, status: 'running', input: state.firstArg },
          ]);
          break;
        }
        case 'tool_end': {
          const { state } = msg;
          updateActiveTools((prev) =>
            prev.map((t) =>
              t.name === state.toolName && t.status === 'running'
                ? { ...t, status: state.isRunning ? 'running' : 'done', result: state.result }
                : t,
            ),
          );
          break;
        }
        case 'execution_workspace_event': {
          setExecutionWorkspace(msg.snapshot);
          break;
        }
        case 'permission_request':
        case 'ask_request':
        case 'prompt_resolved': {
          // REMOTE-007/009: the paired owner renders + answers its own prompts (local == remote).
          setPendingPrompts((prev) => applyPromptEvent(prev, msg));
          break;
        }
        case 'ui_intent': {
          // CMD-004 Stage D: a command this surface issued requested a screen the GUI does not have.
          // The command's result follows; the unavailable line answers it (TC-05, never silent).
          const unavailable = {
            name: uiIntentCommandName(msg.event.intent),
            text: describeUiIntentForGui(msg.event.intent),
          };
          if (commandsInFlightRef.current > 0) {
            pendingIntentRef.current = unavailable;
          } else {
            // No command of ours awaits a reply (a model-run command, a broadcast): say it now.
            appendEntry({ id: nextId(), role: 'command', name: unavailable.name, content: unavailable.text, tone: 'info' });
          }
          break;
        }
        // CMD-004 Stage E: broadcast session events — a rename/clear executed by the HOST (from any
        // surface, co-driving included) is reflected here; never a silent drop.
        case 'session_renamed': {
          setSessionName(msg.event.name);
          break;
        }
        case 'history_cleared': {
          streamingTextRef.current = '';
          streamingIdRef.current = null;
          setStreamingText('');
          setMessages([]);
          break;
        }
        case 'error': {
          send({ type: 'get-status' });
          finishTurn((tool) => (tool.status === 'running' ? 'error' : tool.status));
          setSessionNotices((previous) => [
            ...previous,
            { id: nextId(), kind: 'session-error', message: msg.message },
          ]);
          break;
        }
        case 'protocol_error': {
          // A command can end in a protocol error instead of a result; a screen it asked for still shows.
          commandsInFlightRef.current = Math.max(0, commandsInFlightRef.current - 1);
          const unavailable = pendingIntentRef.current;
          pendingIntentRef.current = null;
          if (unavailable !== null) {
            appendEntry({ id: nextId(), role: 'command', name: unavailable.name, content: unavailable.text, tone: 'info' });
          }
          setSessionNotices((previous) => [
            ...previous,
            { id: nextId(), kind: 'protocol-error', message: msg.message },
          ]);
          break;
        }
        case 'commands': {
          setCommandCatalog({ commands: msg.commands, skills: msg.skills });
          break;
        }
        case 'session_status': {
          setSessionStatus(msg.status);
          break;
        }
        case 'command_result': {
          // A command may change the status (mode, effort, model) or the catalog (plugins, skills).
          send({ type: 'get-status' });
          send({ type: 'get-commands' });
          commandsInFlightRef.current = Math.max(0, commandsInFlightRef.current - 1);
          const unavailable = pendingIntentRef.current;
          pendingIntentRef.current = null;
          if (unavailable !== null && msg.success) {
            appendEntry({ id: nextId(), role: 'command', name: msg.name, content: unavailable.text, tone: 'info' });
            break;
          }
          // A command that starts a turn (a skill) says nothing itself; the turn is its answer.
          if (msg.message.trim().length === 0) break;
          appendEntry({
            id: nextId(),
            role: 'command',
            name: msg.name,
            content: msg.message,
            tone: msg.success ? 'success' : 'error',
          });
          break;
        }
        case 'complete':
        case 'interrupted': {
          send({ type: 'get-status' });
          finishTurn((tool) => (tool.status === 'running' ? 'done' : tool.status));
          break;
        }
      }
    },
    [appendEntry, finishTurn, handleUsageMessage, send, updateActiveTools],
  );

  const answerPermission = useCallback((id: string, result: TPermissionResultValue): void => {
    clientRef.current?.send(permissionResponse(id, result));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id)); // optimistic dismiss (prompt_resolved confirms)
  }, []);

  const answerAsk = useCallback((id: string, response: TActionResponse): void => {
    clientRef.current?.send(askResponse(id, response));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const dismissSessionNotice = useCallback((id: string): void => {
    setSessionNotices((previous) => previous.filter((notice) => notice.id !== id));
  }, []);

  useEffect(() => {
    const onStatusChange = (next: TStatus): void => {
      setStatus(next);
      // Every client learns what it can offer and what is in effect as soon as it is attached.
      if (next === 'connected') {
        // A reply lost with the old connection never arrives; stop waiting for it.
        commandsInFlightRef.current = 0;
        pendingIntentRef.current = null;
        client.send({ type: 'get-commands' });
        client.send({ type: 'get-status' });
      }
    };
    const client = makeClient({ onMessage: handleMessage, onStatusChange });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [makeClient, handleMessage]);

  return {
    status,
    messages,
    activeTools,
    streamingText,
    isThinking,
    executionWorkspace,
    sessionName,
    commandCatalog,
    sessionStatus,
    send,
    pendingPrompts,
    answerPermission,
    answerAsk,
    ...personalUsageState,
    sessionNotices,
    dismissSessionNotice,
  };
}

/** Connect to a `robota` sidecar over WebSocket (loopback / localhost path). */
export function useWsSession(url: string): IWsSessionState<TConnectionStatus> {
  const makeClient = useCallback<TMakeSessionClient<TConnectionStatus>>(
    (cb) => createWsSessionClient(url, cb),
    [url],
  );
  return useSessionClient(makeClient);
}
