---
'@robota-sdk/agent-transport-protocol': major
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-transport-webrtc': patch
---

**BREAKING — ARCH-030: `createWsHandler` takes the carrier's delivery boundary, not a raw `send`.**

`createWsHandler` had two outbound semantics on one connection. The session-event fan-out went through
a guard that reported carrier failures through `onDeliveryError`; every reply to an inbound frame got
the raw `send`. Eleven reply families were unguarded — five resolving from a Promise continuation, so a
reply landing after a disconnect escaped as an **unhandled rejection** while the carrier's cleanup was
never notified, and six synchronous ones that threw into the carrier's inbound listener instead.

`IWsHandlerOptions` now takes a single `deliver: TOutboundDeliver` in place of `send` and
`onDeliveryError`. **The carrier builds the boundary** from its own sink and its own failure policy and
passes it down — not the reverse, because a protocol layer handed a raw sink so it can hand a wrapper
back leaves the raw sink reachable, which is how the twelfth reply family gets added unguarded.

```ts
// before
const { onMessage, cleanup } = createWsHandler({
  session,
  send: (msg) => ws.send(JSON.stringify(msg)),
  onDeliveryError: (error) => ws.close(1011, error.message),
});

// after
const deliver = createOutboundDelivery(
  (msg) => ws.send(JSON.stringify(msg)),
  (error) => ws.close(1011, error.message),
);
const { onMessage, cleanup } = createWsHandler({ session, deliver });
```

`TOutboundDeliver` is branded and `createOutboundDelivery` is its only producer, so a plain
`(message: TServerMessage) => void` is refused by the compiler wherever a boundary is required.

**The boundary latches:** it reports at most one delivery failure per connection, after which frames are
dropped without a further report. All three carriers already treated a delivery failure as terminal and
each had grown its own latch; it belongs upstream of all three. `SessionResumeBridge` builds a fresh
boundary per `attach`, which is what un-latches the session after a reconnect, and buffers a frame
before the boundary so a dropped one still replays.

**`ISubscribeSessionEventsOptions` is no longer exported** from the package barrel. It is the options bag
of `subscribeSessionEvents`, which is package-internal, and it was already absent from the SPEC's public
API table. Its `onDeliveryError` member is gone regardless — carrier-failure containment is the
boundary's job now.

`agent-transport-ws` and `agent-transport-webrtc` are `patch`: `WsSessionDelivery` (whose raw `send` is
now private, with `deliver` the only public sink) and `PairingGate` are not on their packages' barrels,
and every barrel export of both packages keeps its signature.
