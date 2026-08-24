/**
 * The connection-scoped outbound delivery boundary (ARCH-030).
 *
 * Every outbound `TServerMessage` on one connection — session-event fan-out AND every reply to an
 * inbound frame — goes through ONE boundary that owns carrier-failure containment. Before this
 * existed, `subscribeSessionEvents` guarded its sends while the reply paths received the raw carrier
 * `send`, so a reply resolving after a disconnect threw from a Promise continuation, escaped as an
 * unhandled rejection, and left the carrier's cleanup — written, idempotent, and waiting — unnotified.
 *
 * WHO BUILDS IT. The **carrier**, from its own private sink and its own failure policy, and passes the
 * result down into the protocol handler. Not the other way round: the raw sink and the "what does a
 * failed send mean for this connection" decision both belong to the carrier, and handing the protocol
 * layer a raw sink so it can hand a wrapper back leaves the raw sink reachable — which is the hole a
 * twelfth reply family walks through next year.
 *
 * WHY IT IS BRANDED. {@link createOutboundDelivery} is the only producer of {@link TOutboundDeliver}, so
 * a plain `(message: TServerMessage) => void` is **refused by the compiler** wherever a boundary is
 * required. That turns "a new raw-send continuation cannot be added silently" from a scan that a rename
 * defeats into a type error at the call site. `src/__tests__` is inside this package's `tsconfig.json`
 * `include`, so the `@ts-expect-error` case pinning it is checked by `tsgo --noEmit`.
 *
 * IT LATCHES. A boundary reports AT MOST ONE delivery failure; after the first, it is closed and every
 * subsequent frame is dropped without a further report. All three carriers already treat a delivery
 * failure as terminal (`WsSessionDelivery.close` → `socket.close(1011)`, `WebRtcDeliveryLifecycle` →
 * `channel.close()`, `PairingGate` → `pairingChannel.close`) and each had grown its own latch to
 * suppress the repeats; the latch belongs upstream of all three. `SessionResumeBridge` already behaved
 * this way, so the handler path converges onto the bridge's semantics rather than the reverse.
 *
 * A boundary is not reusable across carriers: a latched one stays latched. `SessionResumeBridge` builds
 * a fresh boundary per `attach`, which is what un-latches the session after a reconnect.
 */

import type { TServerMessage } from './ws-protocol.js';

declare const outboundDeliveryBrand: unique symbol;

/**
 * Deliver one outbound frame on a connection. A carrier failure is REPORTED through the boundary's
 * error handler, never thrown at the caller — so a reply resolving after a disconnect cannot escape as
 * an unhandled rejection or out of the carrier's inbound listener.
 *
 * Only {@link createOutboundDelivery} produces one. The brand is the mechanism, not decoration: it is
 * what makes a raw carrier `send` unusable where a boundary is required.
 */
export type TOutboundDeliver = ((message: TServerMessage) => void) & {
  readonly [outboundDeliveryBrand]: true;

  /**
   * Bytes this carrier has ACCEPTED and not yet written to the peer — or `undefined` when it cannot
   * say.
   *
   * `deliver` returning is not delivery. Both carriers hand this boundary a fire-and-forget sink, so
   * a frame that has "been sent" may be sitting in a socket buffer the boundary cannot see. Anything
   * this boundary counted itself would be a count of what it HANDED OVER, which is a different
   * quantity from what the peer has not read — and a budget over the wrong quantity reports a
   * healthy connection for a peer that stopped reading (ARCH-030 / issue #1734).
   *
   * `undefined` is deliberately not `0`. A carrier that cannot report backpressure and a carrier with
   * nothing pending are different states, and collapsing them would let "unknown" satisfy any
   * threshold placed on this number.
   */
  readonly pendingBytes: () => number | undefined;
};

/**
 * Observe THIS connection's first outbound delivery failure. `event` is the `type` of the frame that
 * could not be delivered — a session event's own name for the fan-out (they are identical), and the
 * reply's type for a reply (`command_result`, `protocol_error`, …).
 *
 * Required, never optional: a carrier that could opt out of observing its own delivery failures is the
 * silent-failure shape this boundary exists to remove.
 */
export type TDeliveryErrorHandler = (error: Error, event: TServerMessage['type']) => void;

/**
 * Build the outbound delivery boundary for ONE connection from that connection's raw sink and its
 * failure policy.
 *
 * @param send - the carrier's raw sink. May throw; that is what makes it raw.
 * @param onDeliveryError - the carrier's failure policy, invoked at most once. A handler that itself
 *   throws is isolated: a diagnostic cannot reverse an already-committed session operation.
 * @param pendingBytes - the carrier's own backpressure reading. Optional because not every carrier
 *   has one; omitted, the boundary answers `undefined` rather than inventing a number.
 */
/**
 * Default outbound backpressure budget, in bytes the carrier has accepted and not yet written.
 *
 * 8 MiB. The number is a policy, not a measurement, and it is stated here rather than inlined so a
 * reader can find the one place that decides it. It is well above any single frame this protocol
 * produces and well below a figure at which a non-reading peer could exhaust the host — the property
 * that matters is that SOME finite budget exists, because the previous behaviour was unbounded.
 *
 * A carrier that cannot report `pendingBytes` is not subject to it: `undefined` is unknown, not zero,
 * so no threshold applies to it. That is deliberate and it is a gap — a carrier with no backpressure
 * reading has no budget — recorded rather than hidden behind a default of `0`, which would refuse
 * every frame on such a carrier.
 */
const BYTES_PER_MIB = Number('1024') * Number('1024');
export const DEFAULT_MAX_PENDING_BYTES = Number('8') * BYTES_PER_MIB;

/**
 * Is this carrier holding more than the budget allows?
 *
 * Exported because a WebSocket carries TWO kinds of outbound frame over one socket — the text
 * protocol and TRANS-001's payload channels — and only one of them goes through
 * {@link createOutboundDelivery}. A budget the binary path re-implemented would be a second opinion
 * about one socket's backpressure; a budget it skipped would leave the same non-reading peer
 * unbounded on the other half of the connection.
 *
 * `undefined` is unknown, not zero: a carrier that cannot report backpressure is never over budget.
 */
export function isOverPendingBudget(
  pending: number | undefined,
  limit: number = DEFAULT_MAX_PENDING_BYTES,
): boolean {
  return pending !== undefined && pending > limit;
}

export function createOutboundDelivery(
  send: (message: TServerMessage) => void,
  onDeliveryError: TDeliveryErrorHandler,
  pendingBytes?: () => number | undefined,
  maxPendingBytes: number = DEFAULT_MAX_PENDING_BYTES,
): TOutboundDeliver {
  let closed = false;
  const deliver = (message: TServerMessage): void => {
    if (closed) return;
    // The budget is checked BEFORE the send, not after: a peer that has stopped reading is detected
    // by what the carrier is still holding, and adding one more frame first would make the boundary
    // the last contributor to the overflow it is reporting.
    const pending = pendingBytes?.();
    if (isOverPendingBudget(pending, maxPendingBytes)) {
      closed = true;
      reportFailure(
        new Error(
          `outbound backpressure budget exceeded: ${pending} byte(s) pending, limit ${maxPendingBytes}. ` +
            'The peer has accepted frames it is not reading.',
        ),
        message.type,
      );
      return;
    }
    try {
      send(message);
    } catch (error) {
      // allow-fallback: this IS the boundary — a carrier send failure is a CARRIER lifecycle failure,
      // reported to the carrier's own policy (which closes the connection). It is never swallowed, and
      // re-throwing it would fail a session operation that has already committed.
      closed = true;
      reportFailure(error instanceof Error ? error : new Error(String(error)), message.type);
    }
  };
  function reportFailure(error: Error, event: TServerMessage['type']): void {
    try {
      onDeliveryError(error, event);
    } catch {
      // allow-fallback: the carrier-owned diagnostic is the LAST step of a failure already being
      // reported. A throw from it has nowhere left to go, and letting it out would make a committed
      // session operation fail for the sake of a diagnostic.
    }
  }
  return Object.assign(deliver, {
    pendingBytes: (): number | undefined => pendingBytes?.(),
  }) as TOutboundDeliver;
}
