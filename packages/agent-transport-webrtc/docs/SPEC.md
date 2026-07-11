# agent-transport-webrtc Specification

## Scope

WebRTC P2P transport (REMOTE-001 / REMOTE-002 Stage A). Carries an `IInteractiveSession` over an
`RTCDataChannel` so an external remote client can co-drive a live `agent-cli` session directly, peer-to-peer,
without routing session content through any server. Reuses the transport-neutral session bridge + wire protocol
from `@robota-sdk/agent-transport-protocol` (the same `createWsHandler` the WebSocket transport uses) so the
protocol is shared, not duplicated.

## Boundaries

- Does NOT own the session bridge or wire protocol — that is `@robota-sdk/agent-transport-protocol`
  (`createWsHandler`, `TClientMessage`/`TServerMessage`). This package only carries those frames over a data
  channel; it has **no** `webrtc → ws` package edge.
- Owns the **pairing GATE** (REMOTE-008), not the pairing crypto — the directional-HMAC handshake +
  DTLS-fingerprint channel binding is `@robota-sdk/agent-remote-pairing` (a zero-dep isomorphic leaf). The gate must
  live here because only the transport can see the offer/answer DTLS fingerprints and the pre-session channel frames;
  this is the sole reason for the `webrtc → agent-remote-pairing` edge (recorded in project-structure.md).
- Does NOT own signaling — SDP/ICE rendezvous is an injected `ISignalingClient` port (a real server lives in
  `apps/remote-signaling`; tests use the in-memory pair). The transport never inspects signaling internals.
- Does NOT bundle the WebRTC implementation. `werift` (pure-TS) is an **optional peer dependency** loaded lazily;
  its absence surfaces an explicit "WebRTC transport unavailable" throw at point-of-use — never a silent no-op or
  degraded path (no-fallback rule).
- **No enable path here.** `defaultEnabled` is `false`, the transport is NOT registered in `agent-cli`, and there is
  no `/remote-control` command; the enable path (command + composition-root wiring + QR) is REMOTE-008 Steps 2-4.
- **Pairing gate (REMOTE-008 Step 1) is opt-in via the `secret` option.** With a `secret`, the data channel is
  phase-separated: pre-accept it carries only pairing frames (routed to the handshake; non-pairing frames DROPPED),
  and only after the handshake accepts (channel-bound to the DTLS fingerprints) is the session bridge built —
  fail closed on mismatch/timeout (channel closed, session never exposed). Without a `secret` (loopback/tests) the
  channel is exposed immediately, unchanged.

## Architecture Overview

`WebRtcTransport` implements `IConfigurableTransport<IInteractiveSession>` (`name='webrtc'`,
`defaultEnabled:false`). The host is the **offerer**: `start()` lazily loads `werift`, opens an
`RTCPeerConnection`, subscribes ICE candidates to the injected signaling client, serializes inbound
answer/ICE signals (so `setRemoteDescription` always precedes any `addIceCandidate` — werift does not buffer
trickle candidates that precede the remote description), creates the `robota-session` data channel, and sends the
SDP offer. The data channel is wired **eagerly at creation** (not on `open`): `createWsHandler({ session, send })`
is built immediately and `onMessage` subscribed at once, because werift does not buffer inbound frames that
arrive before a subscription and the remote can send its first `TClientMessage` before the host's channel opens.
Outbound `send` runs under try/catch (werift buffers sends while `connecting`; only a `closing`/`closed` channel
throws). `stop()` tears down the handler, signal subscription, and peer.

**Pairing gate (REMOTE-008, when `options.secret` is set).** The eager `onMessage` subscription becomes a ROUTING
SWITCH into `PairingGate` (`src/pairing-gate.ts`) — never a deferred subscription. The local DTLS fingerprint is
captured from the offer SDP; the remote fingerprint from the answer SDP in the signal branch, where the gate is then
constructed (the channel cannot open until DTLS, i.e. post-answer, so no frame precedes the gate). Pre-accept the
gate routes pairing frames to `startPairingHandshake` and DROPS everything else; on `result` accept it builds
`createWsHandler` and switches routing to the session; on reject/timeout it closes the channel and exposes nothing.
The transport's optional `onPaired`/`onPairingFailed` callbacks fire on gate accept/reject so the host can drive its
lifecycle (REMOTE-008: status `paired`, and teardown of the peer/signaling on failure so nothing leaks). **REMOTE-012
E3:** when `IWebRtcTransportOptions.reconnect` (an `IHostReconnectConfig`) is set, the gate becomes reactive — the
client's first frame selects **first-pair** (B3 handshake, then a mutual identity-key enrollment exchange that pins
the device key before the session is exposed) or **reconnect** (the mutual `startHostReconnect` against the pinned
device + host identity keys, no re-pair). `onPaired` carries the first-pair `IPairingResult` (its `sessionKey` is
reserved for E4). Without `reconnect`, the gate is exactly the B4 first-pair-only gate.

## Type Ownership

| Type                                 | Location                  | Purpose                                                                                       |
| ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------- |
| `IWebRtcTransportOptions`            | `src/webrtc-transport.ts` | Construction options (injected signaling, optional ICE servers, optional pairing `secret`).   |
| `ISignalingClient`, `ISignalMessage` | `src/signaling.ts`        | Signaling port + opaque SDP/ICE message envelope.                                             |
| `IWeriftModule`, `TModuleResolver`   | `src/werift-loader.ts`    | Lazy-loaded werift surface + injectable resolver seam.                                        |
| `PairingGate`, `IPairingGateOptions` | `src/pairing-gate.ts`     | REMOTE-008 fail-closed routing switch (pairing frames → handshake; session only post-accept). |

`TClientMessage`/`TServerMessage`/`IWsHandlerOptions` are re-consumed from `@robota-sdk/agent-transport-protocol`
(their SSOT) — this package does not re-declare them.

## Public API Surface

| Export                        | Kind     | Description                                                                                              |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `WebRtcTransport`             | class    | `IConfigurableTransport` carrying a session over an `RTCDataChannel`.                                    |
| `IWebRtcTransportOptions`     | type     | Construction options.                                                                                    |
| `IIceServer`                  | type     | A STUN/TURN server (`urls` + optional `username`/`credential`; REMOTE-010).                              |
| `IHostReconnectConfig`        | type     | E3 host reconnect/enrollment config for the gate (host identity + device resolver + enroll; REMOTE-012). |
| `createInMemorySignalingPair` | function | In-process signaling pair for loopback/tests (no server).                                                |
| `WsSignalingClient`           | class    | Production `ISignalingClient` over a `ws` socket to the relay (REMOTE-004).                              |
| `IWsSignalingClientOptions`   | type     | `WsSignalingClient` options (url, rendezvous, onError, onReady, socket factory).                         |
| `IWebSocketLike`              | type     | Minimal socket surface `WsSignalingClient` needs (injectable in tests).                                  |
| `ISignalingClient`            | type     | Signaling port (send/onSignal/close by rendezvous).                                                      |
| `ISignalMessage`              | type     | Opaque SDP/ICE envelope.                                                                                 |
| `TSignalKind`                 | type     | `'offer' \| 'answer' \| 'ice'`.                                                                          |
| `loadWerift`                  | function | Lazy-load the optional `werift` peer dep (throws on absence).                                            |
| `IWeriftModule`               | type     | The subset of the werift surface this transport constructs.                                              |

## Extension Points

- **Signaling** is swappable via `ISignalingClient` — the in-memory pair, a WebSocket client to
  `apps/remote-signaling`, or any other rendezvous can be injected without touching the transport.
- **REMOTE-010 TURN:** `IWebRtcTransportOptions.iceServers` is `readonly IIceServer[]` — TURN servers carry
  `username`/`credential` (+ `urls` may be a string or array). The host reads + validates them from
  `transports.webrtc.options.iceServers` at the `agent-cli` composition root; `forceTurn` requires a TURN server.
- **ICE servers** (STUN/TURN) are supplied via `IWebRtcTransportOptions.iceServers`; omitted → host-candidate /
  loopback only.
- **WebRTC implementation** is isolated behind `loadWerift`/`IWeriftModule`; switching to a native impl
  (`node-datachannel`) is a recorded design decision, not a runtime fallback.

## Error Taxonomy

- `werift` absent → `loadWerift` throws `WebRTC transport unavailable — install the optional peer dependency
"werift" …` at point-of-use (never a silent degrade).
- `start()` before `attach()` → throws `WebRtcTransport: attach() must be called before start()`.
- A `send` on a `closing`/`closed` channel is dropped (the peer is gone) — matching WebSocket send-after-close
  semantics; it is never a partial/duplicated frame.

## Test Strategy

`src/__tests__/webrtc-transport.test.ts`: metadata (`name='webrtc'`, `defaultEnabled:false`), the
`attach()`-before-`start()` guard, and TC-03 — a Node↔Node loopback that opens an `RTCPeerConnection` +
`RTCDataChannel` between two in-process peers (in-memory signaling, stubbed session — no real provider) and
round-trips a `TClientMessage` (`get-messages`) → session → `TServerMessage` (`messages`) through the reused
handler. `src/__tests__/werift-loader.test.ts`: TC-05 — `loadWerift` resolves the real module when installed and
throws the explicit "unavailable" error (via an injected throwing resolver) when it cannot be resolved.
`src/__tests__/pairing-gate.test.ts` (REMOTE-008 Step 1): the fail-closed routing switch with a stub channel +
injected handshake/handler — session exposed ONLY post-accept, non-pairing frames dropped pre-accept, channel closed
on reject, frames ignored post-close.

## Dependencies

`@robota-sdk/agent-interface-transport` (contracts) + `@robota-sdk/agent-transport-protocol` (shared handler +
protocol) + `@robota-sdk/agent-remote-pairing` (REMOTE-008 pairing gate; zero-dep isomorphic leaf — no cycle).
`werift` is an **optional peer dependency** (lazy-loaded); it is a dev dependency here only to run the loopback tests.

## Class Contract Registry

### Interface Implementations

| Class             | Implements                                    | Location                  |
| ----------------- | --------------------------------------------- | ------------------------- |
| `WebRtcTransport` | `IConfigurableTransport<IInteractiveSession>` | `src/webrtc-transport.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                                                   | Consumer                         | Location                                         |
| ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `agent-interface-transport` `IConfigurableTransport`                    | `WebRtcTransport`                | `src/webrtc-transport.ts`                        |
| `agent-transport-protocol` `createWsHandler`                            | `WebRtcTransport`, `PairingGate` | `src/webrtc-transport.ts`, `src/pairing-gate.ts` |
| `agent-remote-pairing` `startPairingHandshake`/`extractDtlsFingerprint` | `PairingGate`, `WebRtcTransport` | `src/pairing-gate.ts`, `src/webrtc-transport.ts` |
