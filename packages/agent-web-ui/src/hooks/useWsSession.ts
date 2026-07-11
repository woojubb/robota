/**
 * React hook that connects to an agent-cli sidecar WebSocket and
 * reconstructs conversation state from TServerMessage events.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import {
  applyPromptEvent,
  askResponse,
  permissionResponse,
  type TPendingPrompt,
} from './prompt-state.js';
import { createDeviceCredentialStore } from '../client/device-credential-store.js';
import {
  createRtcSessionClient,
  type IRtcSessionClientOptions,
  type TRtcConnectionStatus,
} from '../client/rtc-session-client.js';
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
}

export interface IActiveTool {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  input?: unknown;
  result?: unknown;
}

/** The connection status shown by the UI — the WS statuses plus the RTC pairing/failed states. */
export type TSessionStatus = TConnectionStatus | TRtcConnectionStatus;

/** The minimal session-client surface both the WS and RTC clients satisfy. */
export interface ISessionClientHandle {
  connect: () => void;
  disconnect: () => void;
  send: (msg: TClientMessage) => void;
}

/** Factory the hook calls to build its client from the message/status callbacks. */
export type TMakeSessionClient = (callbacks: {
  onMessage: (msg: TServerMessage) => void;
  onStatusChange: (status: TSessionStatus) => void;
}) => ISessionClientHandle;

export interface IWsSessionState {
  status: TSessionStatus;
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  executionWorkspace: IExecutionWorkspaceSnapshot | null;
  send: (msg: TClientMessage) => void;
  /** REMOTE-007/009: prompts awaiting the owner's answer (permission/ask), rendered by the UI. */
  pendingPrompts: readonly TPendingPrompt[];
  /** Answer a pending permission prompt (sends `permission-response`). */
  answerPermission: (id: string, result: TPermissionResultValue) => void;
  /** Answer a pending ask prompt (sends `ask-response`). */
  answerAsk: (id: string, response: TActionResponse) => void;
}

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function useSessionClient(makeClient: TMakeSessionClient): IWsSessionState {
  const [status, setStatus] = useState<TSessionStatus>('disconnected');
  const [messages, setMessages] = useState<IConversationMessage[]>([]);
  const [activeTools, setActiveTools] = useState<IActiveTool[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [executionWorkspace, setExecutionWorkspace] = useState<IExecutionWorkspaceSnapshot | null>(
    null,
  );
  const [pendingPrompts, setPendingPrompts] = useState<readonly TPendingPrompt[]>([]);

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
          { id: nextId(), role: 'user', content: msg.content ?? '' },
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
    send,
    pendingPrompts,
    answerPermission,
    answerAsk,
  };
}

/** Connect to an agent-cli sidecar over WebSocket (localhost path). */
export function useWsSession(url: string): IWsSessionState {
  const makeClient = useCallback<TMakeSessionClient>((cb) => createWsSessionClient(url, cb), [url]);
  return useSessionClient(makeClient);
}

/** Connect to a paired host over WebRTC (REMOTE-009 Stage D). Memoized on the primitive connection fields. */
export function useRtcSession(
  options: Pick<
    IRtcSessionClientOptions,
    'relayUrl' | 'rendezvous' | 'secret' | 'iceServers' | 'forceTurn'
  >,
): IWsSessionState {
  const { relayUrl, rendezvous, secret, iceServers, forceTurn } = options;
  // REMOTE-012 E3: a stable per-session credential store (IndexedDB) so first-pair enrolls this device.
  const deviceCredentials = useMemo(() => createDeviceCredentialStore(), []);
  const makeClient = useCallback<TMakeSessionClient>(
    (cb) =>
      createRtcSessionClient(
        {
          relayUrl,
          rendezvous,
          secret,
          ...(iceServers ? { iceServers } : {}),
          ...(forceTurn ? { forceTurn } : {}),
          deviceCredentials,
        },
        cb,
      ),
    [relayUrl, rendezvous, secret, iceServers, forceTurn, deviceCredentials],
  );
  return useSessionClient(makeClient);
}
