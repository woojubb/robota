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

/** The slice of `RTCDataChannel` an outbound boundary needs — `send`, and nothing else. */
export interface IDataChannelSink {
  send: (data: string) => void;
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
  );
}
