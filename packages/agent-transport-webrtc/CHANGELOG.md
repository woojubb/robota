# @robota-sdk/agent-transport-webrtc

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
- 94cc355: REMOTE-002 Stage A: extract the transport-neutral session bridge + wire protocol into a new
  `@robota-sdk/agent-transport-protocol` package (`createWsHandler`, `TClientMessage`/`TServerMessage`); repoint
  `agent-transport-ws` and `agent-web-ui` at it (no pass-through re-export). Add a new
  `@robota-sdk/agent-transport-webrtc` package: a `WebRtcTransport` (`IConfigurableTransport`, `defaultEnabled:false`)
  that carries an `IInteractiveSession` over an `RTCDataChannel` reusing the shared handler, with a lazily-loaded
  optional `werift` peer dependency that throws an explicit "WebRTC transport unavailable" error on absence (never a
  silent no-op). No user-facing enable path and no auth in Stage A (that lands in Stage B); the transport is proven
  by an in-process loopback data-channel round-trip only.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; its protocol-consumer role now lives in `@robota-sdk/agent-transport-webrtc-web`.)

- 2c69a3f: REMOTE-004 Stage B2: production WebRTC signaling + relay abuse-hardening (still no user-facing enable path).

  - Add `WsSignalingClient` — a production `ISignalingClient` over a `ws` socket to the `@robota-sdk/remote-signaling`
    relay (Node host-side): joins a rendezvous, buffers signals produced before the socket opens and flushes them,
    and surfaces relay/socket errors through an explicit `onError` (no silent degrade). An `onReady` callback fires
    once the rendezvous join is confirmed.
  - Expose opt-in `forceTurn` on `IWebRtcTransportOptions` (relay-only ICE) as defense-in-depth.
  - The private `@robota-sdk/remote-signaling` relay is hardened in-layer (safe by default): a per-source
    token-bucket bounds join floods, rendezvous ids are single-use (a distinct third peer is refused for the id's
    lifetime, even after one of the pair leaves), a half-open rendezvous expires after a TTL, and concurrent
    rendezvous are capped — all with injected clock/scheduler for deterministic tests.
  - `CVE-2024-29415` (werift-transitive `ip` SSRF) is discharged as a reviewed re-accept: werift never calls the
    vulnerable `ip.isPublic`/`isPrivate`/`address` (verified + guarded by a regression test), so the
    `ignoreCves` entry is retained with a documented non-reachability rationale.

- 92bf33e: Add the pairing gate to the WebRTC transport (REMOTE-008 Step 1, security milestone). When a pairing
  `secret` is configured, the data channel is phase-separated: pre-accept it carries only pairing frames
  (routed to the directional-HMAC handshake bound to the DTLS fingerprints; any non-pairing frame is
  dropped), and only after the handshake accepts is the session bridge built — fail closed on
  mismatch/timeout (channel closed, session never exposed). Without a `secret` the channel is exposed
  immediately, unchanged. Introduces a dependency on the zero-dep `@robota-sdk/agent-remote-pairing` leaf
  (the gate must live where the SDP fingerprints and channel frames are visible).
- 9f602df: Add user-supplied TURN fallback for remote control (REMOTE-010 / Stage E1) so P2P works behind symmetric
  NAT / restrictive firewalls. The host reads + validates `transports.webrtc.options.iceServers`/`forceTurn`
  at the agent-cli composition root (a fail-closed validator narrowing the untyped value → `IIceServer[]`;
  `IWebRtcTransportOptions.iceServers` widened to carry TURN `username`/`credential`), and the browser reads a
  validated `ice`/`forceTurn` pairing-URL query param (fail-closed decoder for the attacker-influenceable value;
  `forceTurn` → `iceTransportPolicy: 'relay'`) — both threaded into their `RTCPeerConnection`. `forceTurn` without
  a TURN server fails closed (else ICE gathers no candidates and silently never connects). Absent ICE config ⇒
  host-candidate-only, unchanged.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser-side ICE/`forceTurn` handling described here now lives in `@robota-sdk/agent-transport-webrtc-web`.)

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
- 2db1b97: Remote-control pairing binds to the negotiated DTLS certificate.

  - The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
    SDP text, and builds the pairing gate once the DTLS handshake completes.
  - An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
    fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
  - A start takes one answer (host) and a connection takes one offer (browser client); a later description is
    ignored.

- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [a5961c9]
- Updated dependencies [4dd45cc]
- Updated dependencies [040f31f]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [4772067]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [d312755]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [2db1b97]
- Updated dependencies [07b627f]
- Updated dependencies [1f45110]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [833afe1]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-transport@3.0.0-beta.80
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.80
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.80
