import {
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
  MAX_INBOUND_FRAME_BYTES,
} from '@robota-sdk/agent-transport/client';

import type { IWsSessionClientCallbacks } from './ws-session-client.js';
import type { ISessionClientHandle } from '../hooks/session-client-types.js';
import type { TClientMessage } from '@robota-sdk/agent-transport';

/** A context-isolated preload exposes only this session facade, never its MessagePort. */
export interface IDesktopSessionBridge {
  listen(onFrame: (frame: string) => void, onClose: () => void, onReady: () => void): () => void;
  send(frame: string): boolean;
  close(): void;
}

function fits(frame: string): boolean {
  return (
    frame.length <= MAX_INBOUND_FRAME_BYTES &&
    new TextEncoder().encode(frame).byteLength <= MAX_INBOUND_FRAME_BYTES
  );
}

/** One bridge belongs to one admitted session and is never reconnected after revocation. */
export function createDesktopSessionClient(
  bridge: IDesktopSessionBridge,
  callbacks: IWsSessionClientCallbacks,
): ISessionClientHandle {
  let state: 'idle' | 'connecting' | 'connected' | 'closed' = 'idle';
  let unsubscribe: (() => void) | undefined;
  let ready = false;

  function finish(status: 'disconnected' | 'error'): void {
    if (state === 'closed') return;
    state = 'closed';
    unsubscribe?.();
    unsubscribe = undefined;
    bridge.close();
    callbacks.onStatusChange(status);
  }

  function send(message: TClientMessage): void {
    if (state !== 'connected') return;
    try {
      const decoded = decodeClientMessage(message);
      const frame = JSON.stringify(message);
      if (!decoded.ok || !fits(frame) || !bridge.send(frame)) finish('error');
    } catch {
      finish('error');
    }
  }

  function connect(): void {
    if (state !== 'idle') return;
    state = 'connecting';
    callbacks.onStatusChange('connecting');
    if (state !== 'connecting') return;
    function activate(): void {
      if (!ready || !unsubscribe || state !== 'connecting') return;
      state = 'connected';
      callbacks.onStatusChange('connected');
      send({ type: 'get-messages' });
    }
    try {
      const release = bridge.listen(
        (frame) => {
          if (state !== 'connected') return;
          if (typeof frame !== 'string' || !fits(frame)) {
            finish('error');
            return;
          }
          const decoded = decodeFrame(frame, decodeServerMessage);
          if (!decoded.ok) {
            finish('error');
            return;
          }
          callbacks.onMessage(decoded.message);
        },
        () => finish('disconnected'),
        () => {
          ready = true;
          activate();
        },
      );
      if (state !== 'connecting') {
        release();
        return;
      }
      unsubscribe = release;
      activate();
    } catch {
      finish('error');
    }
  }

  return { connect, send, disconnect: () => finish('disconnected') };
}
