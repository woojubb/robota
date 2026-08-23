/**
 * ITransportAdapter implementation for WebSocket transport.
 *
 * Wraps createWsHandler into the unified ITransportAdapter interface.
 * After start(), the consumer must wire onMessage to their WebSocket.
 */

import { createOutboundDelivery, createWsHandler } from '@robota-sdk/agent-transport-protocol';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportAdapter,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession, TServerMessage } from '@robota-sdk/agent-transport-protocol';

export interface IWsTransportOptions {
  /** Send a JSON message to the connected WebSocket client. */
  send: (message: TServerMessage) => void;
  /** Owning socket lifecycle callback for outbound session-event delivery failures. */
  onDeliveryError?: (error: Error, event: string) => void;
}

export interface IWsTransport extends ITransportAdapter<IInteractiveSession> {
  attach(session: IProtocolSession): void;
  onMessage: ((data: string) => void) | null;
}

export function createWsTransport(options: IWsTransportOptions): IWsTransport {
  let session: IProtocolSession | null = null;
  let cleanup: (() => void) | null = null;
  const lifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`WebSocket transport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'ws',
    });

  const transport: IWsTransport = {
    name: 'ws',
    lifecycle: Object.freeze({ kind: 'service' }),
    onMessage: null,
    attach(s: IProtocolSession) {
      session = s;
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (cleanup) throw lifecycleError('already-started');
      // ARCH-030: this adapter is the carrier here, so it builds the connection's outbound boundary
      // from its own injected sink and its own failure policy, then passes it down.
      const deliver = createOutboundDelivery(options.send, (error, event) => {
        handler.cleanup();
        cleanup = null;
        transport.onMessage = null;
        options.onDeliveryError?.(error, event);
      });
      const handler = createWsHandler({ session, deliver });
      cleanup = handler.cleanup;
      this.onMessage = handler.onMessage;
    },
    async stop() {
      cleanup?.();
      cleanup = null;
      this.onMessage = null;
      session = null;
    },
  };
  return transport;
}
