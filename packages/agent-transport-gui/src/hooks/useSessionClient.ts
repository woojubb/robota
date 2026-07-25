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
import {
  applyUiIntentEvent,
  removeUiIntentNotice,
  type TUiIntentNotice,
} from './ui-intent-state.js';
import { createWsSessionClient } from '../client/ws-session-client.js';

import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type {
  IExecutionWorkspaceSnapshot,
  TActionResponse,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

export interface IConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  /** REMOTE-014 E5: the co-driving author of a user turn (display-only; absent/owner = the local owner). */
  author?: string;
}

export interface IActiveTool {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  input?: unknown;
  result?: unknown;
}

/** The minimal session-client surface a transport (WS, RTC, …) satisfies. Generic over its status type. */
export interface ISessionClientHandle {
  connect: () => void;
  disconnect: () => void;
  send: (msg: TClientMessage) => void;
}

/** Factory the hook calls to build its client from the message/status callbacks. */
export type TMakeSessionClient<TStatus extends string = TConnectionStatus> = (callbacks: {
  onMessage: (msg: TServerMessage) => void;
  onStatusChange: (status: TStatus) => void;
}) => ISessionClientHandle;

export interface IWsSessionState<TStatus extends string = TConnectionStatus> {
  status: TStatus;
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  executionWorkspace: IExecutionWorkspaceSnapshot | null;
  /** CMD-004 Stage E: the session name, following the broadcast `session_renamed` (host-executed rename). */
  sessionName: string | null;
  send: (msg: TClientMessage) => void;
  /** REMOTE-007/009: prompts awaiting the owner's answer (permission/ask), rendered by the UI. */
  pendingPrompts: readonly TPendingPrompt[];
  /** Answer a pending permission prompt (sends `permission-response`). */
  answerPermission: (id: string, result: TPermissionResultValue) => void;
  /** Answer a pending ask prompt (sends `ask-response`). */
  answerAsk: (id: string, response: TActionResponse) => void;
  /**
   * CMD-004 Stage D: explicit notices for `ui_intent`s this surface cannot render as a screen
   * (requester-routed to this surface by the server; never a silent drop — TC-05).
   */
  uiIntentNotices: readonly TUiIntentNotice[];
  /** Dismiss one ui_intent notice by id. */
  dismissUiIntentNotice: (id: string) => void;
}

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function useSessionClient<TStatus extends string = TConnectionStatus>(
  makeClient: TMakeSessionClient<TStatus>,
): IWsSessionState<TStatus> {
  const [status, setStatus] = useState<TStatus>('disconnected' as TStatus);
  const [messages, setMessages] = useState<IConversationMessage[]>([]);
  const [activeTools, setActiveTools] = useState<IActiveTool[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [executionWorkspace, setExecutionWorkspace] = useState<IExecutionWorkspaceSnapshot | null>(
    null,
  );
  const [pendingPrompts, setPendingPrompts] = useState<readonly TPendingPrompt[]>([]);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [uiIntentNotices, setUiIntentNotices] = useState<readonly TUiIntentNotice[]>([]);

  const clientRef = useRef<ISessionClientHandle | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef('');

  const handleMessage = useCallback((msg: TServerMessage): void => {
    switch (msg.type) {
      case 'messages': {
        const reconstructed: IConversationMessage[] = msg.messages.flatMap((m) => {
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
        setActiveTools((prev) => [
          ...prev,
          { id: toolId, name: state.toolName, status: 'running', input: state.firstArg },
        ]);
        break;
      }
      case 'tool_end': {
        const { state } = msg;
        setActiveTools((prev) =>
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
        // CMD-004 Stage D: a command this surface issued requested a screen — fold it into an
        // explicit visible notice (the GUI has no such screen yet; TC-05, never a silent no-op).
        setUiIntentNotices((prev) => applyUiIntentEvent(prev, msg));
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
      case 'complete':
      case 'interrupted': {
        const finalText = streamingTextRef.current;
        const sid = streamingIdRef.current;
        streamingTextRef.current = '';
        streamingIdRef.current = null;
        setStreamingText('');
        setIsThinking(false);
        setActiveTools([]);
        if (finalText) {
          setMessages((prev) => [
            ...prev,
            { id: sid ?? nextId(), role: 'assistant', content: finalText },
          ]);
        }
        break;
      }
    }
  }, []);

  const send = useCallback((msg: TClientMessage): void => {
    clientRef.current?.send(msg);
  }, []);

  const answerPermission = useCallback((id: string, result: TPermissionResultValue): void => {
    clientRef.current?.send(permissionResponse(id, result));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id)); // optimistic dismiss (prompt_resolved confirms)
  }, []);

  const answerAsk = useCallback((id: string, response: TActionResponse): void => {
    clientRef.current?.send(askResponse(id, response));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const dismissUiIntentNotice = useCallback((id: string): void => {
    setUiIntentNotices((prev) => removeUiIntentNotice(prev, id));
  }, []);

  useEffect(() => {
    const client = makeClient({ onMessage: handleMessage, onStatusChange: setStatus });
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
    send,
    pendingPrompts,
    answerPermission,
    answerAsk,
    uiIntentNotices,
    dismissUiIntentNotice,
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
