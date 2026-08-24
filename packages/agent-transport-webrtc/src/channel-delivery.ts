/**
 * The data channel's outbound delivery boundary (ARCH-030).
 *
 * Both places that build a bare `createWsHandler` in this package — `PairingGate`'s no-`resumeBridge`
 * branch and `WebRtcTransport`'s no-secret branch — need exactly the same thing: serialize a
 * `TServerMessage` onto an `RTCDataChannel` and route a send failure into that carrier's own failure
 * policy. Written inline at both sites it was two copies of one decision, and it pushed both files past
 * their size ceilings. One owner, named after what it is.
 */

import { createOutboundDelivery } from '@robota-sdk/agent-transport-protocol';

import type { TOutboundDeliver } from '@robota-sdk/agent-transport-protocol';

/**
 * The slice of `RTCDataChannel` an outbound boundary needs.
 *
 * `bufferedAmount` is optional because the slice is structural — a test double may omit it — but a
 * real `RTCDataChannel` always has it, so the production path reports a real number rather than a
 * placeholder (ARCH-030 / issue #1734).
 */
export interface IDataChannelSink {
  send: (data: string) => void;
  readonly bufferedAmount?: number;
}

/**
 * Build the connection's outbound boundary over a data channel.
 *
 * @param channel - the data channel to serialize onto. `send` may throw once the channel is closing.
 * @param onDeliveryError - this carrier's failure policy, invoked at most once (the boundary latches).
 */
export function createChannelDelivery(
  channel: IDataChannelSink,
  onDeliveryError: (error: Error, event: string) => void,
): TOutboundDeliver {
  return createOutboundDelivery(
    (message) => channel.send(JSON.stringify(message)),
    (error, event) => onDeliveryError(error, event),
    // Read at CALL time, not captured: `bufferedAmount` is a live property and a value read once
    // would answer with the backpressure of the moment the boundary was built.
    () => channel.bufferedAmount,
  );
}
