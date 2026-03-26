/**
 * ITransportAdapter implementation for WebSocket transport.
 *
 * Wraps createWsHandler into the unified ITransportAdapter interface.
 * After start(), the consumer must wire onMessage to their WebSocket.
 */

import type { InteractiveSession, ITransportAdapter } from '@robota-sdk/agent-sdk';
import { createWsHandler } from './ws-handler.js';
import type { TServerMessage } from './ws-handler.js';

export interface IWsTransportOptions {
  /** Send a JSON message to the connected WebSocket client. */
  send: (message: TServerMessage) => void;
}

export function createWsTransport(
  options: IWsTransportOptions,
): ITransportAdapter & { onMessage: ((data: string) => void) | null } {
  let session: InteractiveSession | null = null;
  let cleanup: (() => void) | null = null;

  return {
    name: 'ws',
    onMessage: null,
    attach(s: InteractiveSession) {
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
