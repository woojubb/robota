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
- **Bounds resource consumption at the transport layer, safe-by-default (REMOTE-011 E2):** a `maxPayload` frame
  cap (`ws` closes an oversized frame with `1009` before buffering it), total + per-IP concurrent-connection
  caps enforced at accept (`close(1013,'over-capacity')`, never registered), and a per-connection message-rate
  bucket on the `signal` path (distinct from the per-source `join` bucket; evicted on disconnect). The per-IP
  cap assumes **direct exposure** by default; behind a reverse proxy set `trustProxy` (reads the trusted,
  right-most `X-Forwarded-For` hop) or disable it (`maxConnectionsPerIp: 0`) — otherwise every connection would
  present the proxy IP and legitimate clients would be refused. None of these controls inspects `data`; the
  relay stays content-blind.

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

| Type                                                                     | Location        | Purpose                                      |
| ------------------------------------------------------------------------ | --------------- | -------------------------------------------- |
| `ISignalingPeer`, `ISignalingRelayHooks`, `TInboundFrame`, `TSignalKind` | `src/relay.ts`  | Relay contracts.                             |
| `ISignalingServerOptions`, `ISignalingServerHandle`, `TAddressResolver`  | `src/server.ts` | Server start options + handle + IP-key seam. |

## Public API Surface

| Export                           | Kind     | Description                                                                                               |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `SignalingRelay`                 | class    | Content-blind rendezvous + SDP/ICE relay with built-in abuse controls.                                    |
| `startSignalingServer`           | function | Bind the relay over WebSocket; returns a stop handle.                                                     |
| `MAX_PEERS_PER_RENDEZVOUS`       | const    | Peer cap per rendezvous (2).                                                                              |
| `TokenBucketLimiter`             | class    | Per-key token-bucket (REMOTE-004; injected clock); `evict(key)` drops a bucket (REMOTE-011 memory bound). |
| `systemClock`                    | const    | Default `Date.now`-based `IClock`.                                                                        |
| `systemScheduler`                | const    | Default `setTimeout`-based `IScheduler`.                                                                  |
| `DEFAULT_TOKEN_BUCKET`           | const    | Default join bucket (burst 5, refill 1/12s).                                                              |
| `DEFAULT_MESSAGE_RATE`           | const    | Default per-connection `signal` message-rate bucket (burst 60, ~10/s).                                    |
| `DEFAULT_RENDEZVOUS_TTL_MS`      | const    | Default half-open rendezvous TTL (60s).                                                                   |
| `DEFAULT_MAX_RENDEZVOUS`         | const    | Default concurrent-rendezvous cap (1024).                                                                 |
| `DEFAULT_MAX_CONNECTIONS`        | const    | Default total concurrent-connection cap (2048).                                                           |
| `DEFAULT_MAX_CONNECTIONS_PER_IP` | const    | Default per-source-key connection cap (64; `0` disables).                                                 |
| `DEFAULT_MAX_FRAME_BYTES`        | const    | Default `maxPayload` per WebSocket frame (64 KiB).                                                        |
| `OVER_CAPACITY_CLOSE_CODE`       | const    | WebSocket close code for a cap refusal (`1013`).                                                          |
| `TAddressResolver`               | type     | Per-IP-key resolver seam (default TCP addr; `trustProxy` reads XFF).                                      |

## Extension Points

`ISignalingRelayHooks.onJoinAttempt` is the Stage-B seam for rate-limiting / pairing-based admission; returning
`false` rejects the join. No relay logic change is needed to add it.

## Error Taxonomy

Two distinct failure surfaces:

**Relay error frames** — a `{ type:'error', reason }` frame to the offending peer only, no partial relay:
`invalid-json`, `malformed-frame`, `empty-rendezvous`, `join-rejected`, `rendezvous-full`, `unsupported-frame`,
`not-joined`, `rate-limited` (join flood), `message-rate-limited` (per-connection `signal` flood — the frame is
dropped, the connection stays open).

**Transport close codes** — a WebSocket close (the connection ends), not an application error frame:
`1009` (message too big — a frame over `maxFrameBytes`, closed by `ws` before our handler runs) and `1013`
(`over-capacity` — a connection refused at accept by the total or per-IP cap; the peer is never registered).

## Test Strategy

`src/__tests__/relay.test.ts`: unit tests over in-memory fake peers assert SDP/ICE relay to the counterpart
only, that a non-signaling payload (and an unknown signal kind) is never forwarded (TC-04), no cross-rendezvous
forwarding, the ≤2-peer cap, no-state-after-leave, and pre-join rejection; plus a loopback/ephemeral integration
test that starts the real `ws` server on `127.0.0.1:0` and relays an offer between two live sockets (TC-06
loopback binding).

`src/__tests__/relay-hardening.test.ts` + `rate-limiter.test.ts` (REMOTE-004 B2 + REMOTE-011 E2): fake-peer +
injected-clock coverage of the join bucket, single-use rendezvous, half-open TTL, concurrency cap, plus the
per-connection message-rate throttle (per-connection isolation + no fan-out of the rejected frame) and
`TokenBucketLimiter.evict` / `messageBucketCount` memory bound. `src/__tests__/server-caps.test.ts` (REMOTE-011
E2): REAL `ws` connections assert the total + per-IP connection caps (via the injected `addressResolver` seam,
and that `maxConnectionsPerIp: 0` disables it), `maxPayload` closing an oversized frame with `1009`, and the
connection counter returning to 0 after disconnect.

## Class Contract Registry

### Interface Implementations

None (the relay is a concrete class; `ISignalingPeer` is implemented inline by the `ws` socket wrapper and by
test fakes).

### Inheritance Chains

None.

### Cross-Package Port Consumers

None — this app imports no `@robota-sdk` package. The counterpart WebRTC transport
(`@robota-sdk/agent-transport-webrtc`) consumes this relay only over the wire (SDP/ICE frames), not by import.
