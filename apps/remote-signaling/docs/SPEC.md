# Remote Signaling Server Specification

## Scope

Minimal, content-blind WebRTC **signaling relay** (REMOTE-001 / REMOTE-002 Stage A). Two NAT'd peers — a host
running `agent-cli` with remote-control enabled and an external remote client — exchange SDP offers/answers and
ICE candidates through this relay to establish a direct P2P `RTCDataChannel`. Owns the rendezvous pairing + the
SDP/ICE relay logic and the WebSocket server entrypoint.

## Boundaries

- Does NOT own the WebRTC transport — that is `@robota-sdk/agent-transport-webrtc`; this app only rendezvous-pairs
  peers and relays their opaque signaling blobs.
- Does NOT carry session content. It relays **only** `offer`/`answer`/`ice` frames verbatim and holds no session
  state — only transient per-rendezvous membership dropped on disconnect.
- Does NOT import any `@robota-sdk` runtime package. It is a dumb relay (dependency: `ws` only).
- Carries **NO auth/trust in Stage A** (pairing lands in Stage B). It exposes an `onJoinAttempt` rate-limit/auth
  seam that is a no-op until then. It binds **loopback/ephemeral by default** and is not wired into any default
  runnable / publish / deploy path (REMOTE-002 TC-06).

## Architecture Overview

`SignalingRelay` (`src/relay.ts`) is pure in-memory routing over an `ISignalingPeer` abstraction: a peer `join`s
a rendezvous id (≤2 peers), then every `signal` frame it sends is forwarded verbatim to its counterpart in the
same rendezvous — never echoed to the sender, never cross-forwarded between rendezvous ids, and any non-signaling
frame (or an unknown `kind`) is rejected, never relayed. `startSignalingServer` (`src/server.ts`) wraps each `ws`
socket as an `ISignalingPeer`, delegates every frame to the relay, binds `127.0.0.1` on an ephemeral port by
default, and returns a handle exposing the resolved port + a `close()`.

## Frame Protocol

| Inbound frame                             | Effect                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `{ type: 'join', rendezvous }`            | Join (or move to) a rendezvous; replies `{ type:'joined' }`.  |
| `{ type: 'signal', kind, data }`          | Relay verbatim to the counterpart; `kind∈{offer,answer,ice}`. |
| anything else / unknown `kind` / pre-join | Rejected with `{ type:'error', reason }`; never forwarded.    |

`data` is opaque — the relay never inspects it.

## Type Ownership

| Type                                                                     | Location        | Purpose                        |
| ------------------------------------------------------------------------ | --------------- | ------------------------------ |
| `ISignalingPeer`, `ISignalingRelayHooks`, `TInboundFrame`, `TSignalKind` | `src/relay.ts`  | Relay contracts.               |
| `ISignalingServerOptions`, `ISignalingServerHandle`                      | `src/server.ts` | Server start options + handle. |

## Public API Surface

| Export                     | Kind     | Description                                           |
| -------------------------- | -------- | ----------------------------------------------------- |
| `SignalingRelay`           | class    | Content-blind rendezvous + SDP/ICE relay logic.       |
| `startSignalingServer`     | function | Bind the relay over WebSocket; returns a stop handle. |
| `MAX_PEERS_PER_RENDEZVOUS` | const    | Peer cap per rendezvous (2).                          |

## Extension Points

`ISignalingRelayHooks.onJoinAttempt` is the Stage-B seam for rate-limiting / pairing-based admission; returning
`false` rejects the join. No relay logic change is needed to add it.

## Error Taxonomy

Every rejection is a `{ type:'error', reason }` frame to the offending peer only: `invalid-json`,
`malformed-frame`, `empty-rendezvous`, `join-rejected`, `rendezvous-full`, `unsupported-frame`, `not-joined`.
No fallback behavior — a rejected frame is never partially relayed.

## Test Strategy

`src/__tests__/relay.test.ts`: unit tests over in-memory fake peers assert SDP/ICE relay to the counterpart
only, that a non-signaling payload (and an unknown signal kind) is never forwarded (TC-04), no cross-rendezvous
forwarding, the ≤2-peer cap, no-state-after-leave, and pre-join rejection; plus a loopback/ephemeral integration
test that starts the real `ws` server on `127.0.0.1:0` and relays an offer between two live sockets (TC-06
loopback binding).

## Class Contract Registry

### Interface Implementations

None (the relay is a concrete class; `ISignalingPeer` is implemented inline by the `ws` socket wrapper and by
test fakes).

### Inheritance Chains

None.

### Cross-Package Port Consumers

None — this app imports no `@robota-sdk` package. The counterpart WebRTC transport
(`@robota-sdk/agent-transport-webrtc`) consumes this relay only over the wire (SDP/ICE frames), not by import.
