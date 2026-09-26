# @robota-sdk/agent-transport-ws

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-transport@3.0.0-beta.82
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-transport@3.0.0-beta.81
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

- e82215f: **ARCH-011: replace the ambiguous transport lifecycle stub with executable conformance.**

  `ITransportAdapter` now requires a frozen `service | runner` lifecycle descriptor. `start()` resolves
  at the concrete transport's documented readiness boundary; start before attach and repeated active
  start reject a stable lifecycle error, repeated stop is safe, and stopped adapters can reattach and
  restart.

  Runner adapters launch separately and expose a typed terminal outcome through
  `waitForCompletion()`. The registry accepts base adapters, rejects duplicate names, keeps
  configuration as an optional capability, returns complete ordered records whose pending slots become
  registry-owned `abandoned` outcomes on stop/rollback, and exposes a real-runner-only first-failure
  wait. It serializes startup/stop, rejects active restart before mutation, and reverses partial startup
  from the currently failing adapter with typed safe rollback details. Runtime host and serve mode
  propagate real nonzero runner results without treating normal shutdown abandonment as failure.

  HTTP, MCP, both WebSocket adapters, WebRTC, and headless invoke one shared public conformance kit.
  The former `TuiTransport` export is removed because it ignored the attached session; use `renderApp`
  or `TuiInteractionChannel`, which honestly own their session lifecycle.

### Minor Changes

- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.
- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
- 5c5ff23: TRANS-001: payload-agnostic transport — opaque binary frames + consumer-declared event types

  The WS transport now carries **arbitrary payloads** alongside the text-agent protocol on one
  connection, instead of forcing every app-level payload through the `text_delta`/`submit` wire
  protocol.

  - `agent-interface-transport` adds the channel contracts (`IBinaryFrame`, `IChannelEventFrame`,
    `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelEventMap`,
    `TChannelFrame`, `TChannelReceiveResult`). Content-neutral carrier mechanics — no payload domain.
  - `agent-transport-protocol` adds the pure channel frame codec (`encodeBinaryFrame`,
    `encodeChannelEventFrame`, `decodeChannelFrame`, `isChannelFrame`). `TClientMessage` /
    `TServerMessage` are unchanged.
  - `agent-transport-ws` becomes a carrier that routes by WebSocket frame opcode — TEXT to the
    text-agent protocol profile, BINARY to consumer-declared channels — and `WsTransport` now
    implements `IPayloadChannelHost` (`registerChannel`). `PayloadChannelRegistry` is exported.

  Additive only: existing transports, consumers, and the agent wire protocol are untouched.

### Patch Changes

- 235da81: **BREAKING — ARCH-030: `createWsHandler` takes the carrier's delivery boundary, not a raw `send`.**

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

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 94cc355: REMOTE-002 Stage A: extract the transport-neutral session bridge + wire protocol into a new
  `@robota-sdk/agent-transport-protocol` package (`createWsHandler`, `TClientMessage`/`TServerMessage`); repoint
  `agent-transport-ws` and `agent-web-ui` at it (no pass-through re-export). Add a new
  `@robota-sdk/agent-transport-webrtc` package: a `WebRtcTransport` (`IConfigurableTransport`, `defaultEnabled:false`)
  that carries an `IInteractiveSession` over an `RTCDataChannel` reusing the shared handler, with a lazily-loaded
  optional `werift` peer dependency that throws an explicit "WebRTC transport unavailable" error on absence (never a
  silent no-op). No user-facing enable path and no auth in Stage A (that lands in Stage B); the transport is proven
  by an in-process loopback data-channel round-trip only.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; its protocol-consumer role now lives in `@robota-sdk/agent-transport-webrtc-web`.)

- Updated dependencies [7b6234c]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [50d2c9f]
- Updated dependencies [1698be4]
- Updated dependencies [a5961c9]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [d6b9404]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-transport@3.0.0-beta.80
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77

## 3.0.0-beta.76

### Minor Changes

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

### Patch Changes

- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
