# Remote Signaling Server Specification

## Purpose

Minimal, content-blind WebRTC signaling relay. Two NAT'd peers — a host running `agent-cli` with
remote-control enabled and an external remote client — exchange SDP offers/answers and ICE candidates
through this relay to establish a direct P2P data channel. Owns rendezvous pairing, the SDP/ICE relay
logic, and the WebSocket server entrypoint.

## Contract

- Does not own the WebRTC transport (that is `@robota-sdk/agent-transport-webrtc`); this app only
  rendezvous-pairs peers and relays their opaque signaling blobs.
- Carries no session content: it relays only `offer`/`answer`/`ice` frames verbatim, holding no state
  beyond transient per-rendezvous membership that is dropped on disconnect. Frame payloads are never
  inspected.
- A peer never receives its own frame echoed back, and frames never cross between rendezvous ids. Any
  non-signaling frame, or an unknown signal kind, is rejected and never relayed.
- Imports no `@robota-sdk` runtime package — it is a dumb relay with a single dependency (`ws`).
- Carries no authentication or trust: pairing/auth is deferred to a later stage. It exposes a no-op
  rate-limit/auth seam for that future use, binds to loopback on an ephemeral port by default, and is
  not wired into any default runnable, publish, or deploy path.
- Bounds resource consumption at the transport layer, safe by default: an oversized WebSocket frame is
  closed before buffering; total and per-IP concurrent-connection caps are enforced at accept and
  refused connections are never registered; and a per-connection message-rate limit throttles the
  signaling path independently of the join-rate limit. None of these controls inspects frame payloads.
- The per-IP cap assumes direct exposure by default. Behind a reverse proxy, the trusted right-most
  `X-Forwarded-For` hop must be configured (or the per-IP cap disabled) — otherwise every connection
  would present the proxy's IP and legitimate clients would be refused.

## Non-goals

- No authentication or pairing-based admission in this stage.
- No inspection or transformation of relayed signaling data.
