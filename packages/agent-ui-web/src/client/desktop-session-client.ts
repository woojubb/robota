import { decodeFrame, decodeServerMessage } from '@robota-sdk/agent-transport/client';

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';
import type { ISessionClientHandle } from '../hooks/session-client-types.js';
import type { TConnectionStatus } from './ws-session-client.js';

/** The secure desktop preload exposes frames, never an owner credential or a daemon endpoint. */
export interface IDesktopSessionBridge {
  subscribe(onFrame: (frame: string) => void, onClose: () => void, onReady: () => void): () => void;
  send(frame: string): boolean;
  close(): void;
}

export function createDesktopSessionClient(
  bridge: IDesktopSessionBridge,
  callbacks: {
    readonly onMessage: (message: TServerMessage) => void;
    readonly onStatusChange: (status: TConnectionStatus) => void;
  },
): ISessionClientHandle {
  let connected = false;
  let subscribed = false;
  let release: (() => void) | undefined;
  let failed = false;
  let revoked = false;
  const close = (): void => {
    revoked = true;
    connected = false;
    if (!failed && subscribed) callbacks.onStatusChange('disconnected');
  };
  return {
    connect() {
      if (revoked || failed) return;
      if (subscribed) return;
      subscribed = true;
      callbacks.onStatusChange('connecting');
      try {
        release = bridge.subscribe(
          (frame) => {
            if (!subscribed || failed || revoked) return;
            const decoded = decodeFrame(frame, decodeServerMessage);
            if (!decoded.ok) {
              failed = true;
              connected = false;
              bridge.close();
              callbacks.onStatusChange('error');
              return;
            }
            callbacks.onMessage(decoded.message);
          },
          close,
          () => {
            if (!subscribed || failed || revoked) return;
            connected = true;
            callbacks.onStatusChange('connected');
            bridge.send(JSON.stringify({ type: 'get-messages' }));
          },
        );
      } catch {
        close();
      }
    },
    disconnect() {
      subscribed = false;
      connected = false;
      release?.();
      release = undefined;
      callbacks.onStatusChange('disconnected');
    },
    send(message: TClientMessage) {
      if (!connected || failed) return;
      if (!bridge.send(JSON.stringify(message))) {
        bridge.close();
        close();
      }
    },
  };
}
