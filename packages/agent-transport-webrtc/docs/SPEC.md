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
- Does NOT own signaling — SDP/ICE rendezvous is an injected `ISignalingClient` port (a real server lives in
  `apps/remote-signaling`; tests use the in-memory pair). The transport never inspects signaling internals.
- Does NOT bundle the WebRTC implementation. `werift` (pure-TS) is an **optional peer dependency** loaded lazily;
  its absence surfaces an explicit "WebRTC transport unavailable" throw at point-of-use — never a silent no-op or
  degraded path (no-fallback rule).
- **Stage A carries no auth and no enable path.** `defaultEnabled` is `false`, the transport is NOT registered in
  `agent-cli`, and there is no `/remote-control` command; it is exercised only by loopback tests. Pairing/auth
  and the enable path land in Stage B.

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

## Type Ownership

| Type                                 | Location                  | Purpose                                                           |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| `IWebRtcTransportOptions`            | `src/webrtc-transport.ts` | Construction options (injected signaling + optional ICE servers). |
| `ISignalingClient`, `ISignalMessage` | `src/signaling.ts`        | Signaling port + opaque SDP/ICE message envelope.                 |
| `IWeriftModule`, `TModuleResolver`   | `src/werift-loader.ts`    | Lazy-loaded werift surface + injectable resolver seam.            |

`TClientMessage`/`TServerMessage`/`IWsHandlerOptions` are re-consumed from `@robota-sdk/agent-transport-protocol`
(their SSOT) — this package does not re-declare them.

## Public API Surface

| Export                        | Kind     | Description                                                           |
| ----------------------------- | -------- | --------------------------------------------------------------------- |
| `WebRtcTransport`             | class    | `IConfigurableTransport` carrying a session over an `RTCDataChannel`. |
| `IWebRtcTransportOptions`     | type     | Construction options.                                                 |
| `createInMemorySignalingPair` | function | In-process signaling pair for loopback/tests (no server).             |
| `ISignalingClient`            | type     | Signaling port (send/onSignal/close by rendezvous).                   |
| `ISignalMessage`              | type     | Opaque SDP/ICE envelope.                                              |
| `loadWerift`                  | function | Lazy-load the optional `werift` peer dep (throws on absence).         |
| `IWeriftModule`               | type     | The subset of the werift surface this transport constructs.           |

## Extension Points

- **Signaling** is swappable via `ISignalingClient` — the in-memory pair, a WebSocket client to
  `apps/remote-signaling`, or any other rendezvous can be injected without touching the transport.
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

## Dependencies

`@robota-sdk/agent-interface-transport` (contracts) + `@robota-sdk/agent-transport-protocol` (shared handler +
protocol). `werift` is an **optional peer dependency** (lazy-loaded); it is a dev dependency here only to run the
loopback tests.

## Class Contract Registry

### Interface Implementations

| Class             | Implements                                    | Location                  |
| ----------------- | --------------------------------------------- | ------------------------- |
| `WebRtcTransport` | `IConfigurableTransport<IInteractiveSession>` | `src/webrtc-transport.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                                | Consumer          | Location                  |
| ---------------------------------------------------- | ----------------- | ------------------------- |
| `agent-interface-transport` `IConfigurableTransport` | `WebRtcTransport` | `src/webrtc-transport.ts` |
| `agent-transport-protocol` `createWsHandler`         | `WebRtcTransport` | `src/webrtc-transport.ts` |
