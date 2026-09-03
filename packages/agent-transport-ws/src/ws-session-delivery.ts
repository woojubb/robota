import {
  createOutboundDelivery,
  createPendingStallClock,
  DEFAULT_MAX_PENDING_BYTES,
  isOverPendingBudget,
} from '@robota-sdk/agent-transport-protocol';
import { WebSocket } from 'ws';

import type {
  IPendingStallClock,
  TOutboundDeliver,
  TServerMessage,
} from '@robota-sdk/agent-transport-protocol';

/**
 * Connection-scoped session delivery lifecycle shared by sync and async WebSocket failures.
 *
 * ARCH-030: {@link deliver} is the ONLY way out of this class. The raw sink — the `readyState` check
 * plus `socket.send` — is private, so no caller can put a frame on this socket outside the connection's
 * one outbound boundary. That is not stylistic: the previous shape exposed a public `send` that threw
 * on a closed socket, and every reply the protocol handler produced went through it unguarded.
 */
export class WsSessionDelivery {
  private cleanupProtocol = (): void => undefined;
  private detachSink = (): void => undefined;
  private closed = false;
  /**
   * Issue #2306: ONE drain clock for the socket. `bufferedAmount` does not distinguish text from
   * binary, so both halves observe the same clock — a slow reader of payload frames is caught when a
   * JSON reply is attempted, and the reverse.
   */
  private readonly stallClock: IPendingStallClock = createPendingStallClock();

  /**
   * The connection's outbound boundary. Built here, from this class's own sink and its own `close`
   * policy, and passed DOWN into `createWsHandler` — the carrier owns both halves, so it builds the
   * boundary rather than handing the protocol layer a raw sink to wrap.
   */
  readonly deliver: TOutboundDeliver;

  constructor(private readonly socket: WebSocket) {
    this.deliver = createOutboundDelivery(
      (message) => this.rawSend(message),
      () => this.close(),
      // ARCH-030 / issue #1734: the socket's own count of what it has accepted and not yet written.
      // Read at call time — it changes underneath.
      () => this.socket.bufferedAmount,
      DEFAULT_MAX_PENDING_BYTES,
      this.stallClock,
    );
  }

  /**
   * Put a TRANS-001 payload frame on this socket, under the SAME budget and the same close policy as
   * the text protocol (ARCH-030 / issue #1734).
   *
   * A WebSocket carries two kinds of outbound frame over one socket, and until this existed the
   * binary half went straight to `socket.send` — outside the boundary, with no budget, and with a
   * failure that could only surface as a throw inside a listener. `bufferedAmount` does not
   * distinguish the two, so a non-reading peer accumulating payload frames was invisible to a budget
   * that only guarded the other half.
   *
   * It is not `deliver`: that boundary is typed for `TServerMessage` and its brand is what makes a
   * raw send unusable where a protocol frame is required. Widening it to accept bytes would remove
   * the property the brand exists for.
   */
  readonly deliverBinary = (frame: Uint8Array): void => {
    if (this.closed) return;
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (
      isOverPendingBudget(this.socket.bufferedAmount) ||
      this.stallClock.observe(this.socket.bufferedAmount) !== undefined
    ) {
      this.close();
      return;
    }
    this.socket.send(frame, { binary: true }, (error) => {
      if (error) this.close();
    });
  };

  private rawSend(message: TServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.send(JSON.stringify(message), (error) => {
      if (error) this.close();
    });
  }

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
