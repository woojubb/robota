import { WebSocket } from 'ws';

import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

/** Connection-scoped session delivery lifecycle shared by sync and async WebSocket failures. */
export class WsSessionDelivery {
  private cleanupProtocol = (): void => undefined;
  private detachSink = (): void => undefined;
  private closed = false;

  constructor(private readonly socket: WebSocket) {}

  readonly send = (message: TServerMessage): void => {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.send(JSON.stringify(message), (error) => {
      if (error) this.close();
    });
  };

  bindProtocolCleanup(cleanup: () => void): void {
    this.cleanupProtocol = cleanup;
  }

  bindSinkDetach(detach: () => void): void {
    this.detachSink = detach;
  }

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.detachSink();
    this.cleanupProtocol();
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(1011, 'session event delivery failed');
    }
  };
}
