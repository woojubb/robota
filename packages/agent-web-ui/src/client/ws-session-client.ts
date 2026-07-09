/**
 * Browser WebSocket client for a running agent-cli sidecar session.
 * Wraps the native WebSocket API with typed agent-transport-ws messages.
 */

import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-protocol';

export type { TServerMessage, TClientMessage };

export type TConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface IWsSessionClientCallbacks {
  onMessage: (msg: TServerMessage) => void;
  onStatusChange: (status: TConnectionStatus) => void;
}

export interface IWsSessionClient {
  connect: () => void;
  disconnect: () => void;
  send: (msg: TClientMessage) => void;
  status: () => TConnectionStatus;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function createWsSessionClient(
  url: string,
  callbacks: IWsSessionClientCallbacks,
): IWsSessionClient {
  let ws: WebSocket | null = null;
  let currentStatus: TConnectionStatus = 'disconnected';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalDisconnect = false;

  function setStatus(s: TConnectionStatus): void {
    currentStatus = s;
    callbacks.onStatusChange(s);
  }

  function scheduleReconnect(): void {
    if (intentionalDisconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    reconnectTimer = setTimeout(() => {
      reconnectAttempts++;
      doConnect();
    }, RECONNECT_DELAY_MS);
  }

  function doConnect(): void {
    setStatus('connecting');
    ws = new WebSocket(url);

    ws.onopen = (): void => {
      reconnectAttempts = 0;
      setStatus('connected');
      // Request full message history on connect
      send({ type: 'get-messages' });
    };

    ws.onmessage = (event: MessageEvent): void => {
      const data = event.data;
      if (typeof data !== 'string') return;
      let msg: TServerMessage;
      try {
        msg = JSON.parse(data) as TServerMessage;
      } catch {
        // A malformed frame must not throw inside the handler (it would break the
        // socket's message pump and freeze the UI). Surface it via the normal path.
        callbacks.onMessage({
          type: 'protocol_error',
          message: 'Malformed message from server (invalid JSON)',
        });
        return;
      }
      callbacks.onMessage(msg);
    };

    ws.onclose = (): void => {
      ws = null;
      if (!intentionalDisconnect) {
        setStatus('disconnected');
        scheduleReconnect();
      } else {
        setStatus('disconnected');
      }
    };

    ws.onerror = (): void => {
      setStatus('error');
    };
  }

  function connect(): void {
    intentionalDisconnect = false;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    doConnect();
  }

  function disconnect(): void {
    intentionalDisconnect = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
    setStatus('disconnected');
  }

  function send(msg: TClientMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  return { connect, disconnect, send, status: () => currentStatus };
}
