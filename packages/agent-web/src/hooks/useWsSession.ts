/**
 * React hook that connects to an agent-cli sidecar WebSocket and
 * reconstructs conversation state from TServerMessage events.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createWsSessionClient } from '../client/ws-session-client.js';
import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport-ws';

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

export interface IWsSessionState {
  status: TConnectionStatus;
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  send: (msg: TClientMessage) => void;
}

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function useWsSession(url: string): IWsSessionState {
  const [status, setStatus] = useState<TConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<IConversationMessage[]>([]);
  const [activeTools, setActiveTools] = useState<IActiveTool[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const clientRef = useRef<ReturnType<typeof createWsSessionClient> | null>(null);
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

  useEffect(() => {
    const client = createWsSessionClient(url, {
      onMessage: handleMessage,
      onStatusChange: setStatus,
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [url, handleMessage]);

  return { status, messages, activeTools, streamingText, isThinking, send };
}
