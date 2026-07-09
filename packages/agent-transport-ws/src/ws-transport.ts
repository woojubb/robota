/**
 * ITransportAdapter implementation for WebSocket transport.
 *
 * Wraps createWsHandler into the unified ITransportAdapter interface.
 * After start(), the consumer must wire onMessage to their WebSocket.
 */

import { createWsHandler } from '@robota-sdk/agent-transport-protocol';

import type { IInteractiveSession, ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

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
