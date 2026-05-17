/**
 * ITransportAdapter implementation for WebSocket transport.
 *
 * Wraps createWsHandler into the unified ITransportAdapter interface.
 * After start(), the consumer must wire onMessage to their WebSocket.
 */

import { createWsHandler } from './ws-handler.js';

import type { TServerMessage } from './ws-protocol.js';
import type { IInteractiveSession } from '@robota-sdk/agent-framework';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';

export interface IWsTransportOptions {
  /** Send a JSON message to the connected WebSocket client. */
  send: (message: TServerMessage) => void;
}

export function createWsTransport(
  options: IWsTransportOptions,
): ITransportAdapter<IInteractiveSession> & { onMessage: ((data: string) => void) | null } {
  let session: IInteractiveSession | null = null;
  let cleanup: (() => void) | null = null;

  return {
    name: 'ws',
    onMessage: null,
    attach(s: IInteractiveSession) {
      session = s;
    },
    async start() {
      if (!session) throw new Error('No session attached. Call attach() first.');
      const handler = createWsHandler({ session, send: options.send });
      cleanup = handler.cleanup;
      this.onMessage = handler.onMessage;
    },
    async stop() {
      cleanup?.();
      cleanup = null;
      this.onMessage = null;
    },
  };
}
