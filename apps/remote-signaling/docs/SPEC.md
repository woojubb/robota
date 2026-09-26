# Remote Signaling Server Specification

## Purpose

Minimal, content-blind WebRTC signaling relay. Two NAT'd peers — a host running `agent-cli` with
remote-control enabled and an external remote client — exchange SDP offers/answers and ICE candidates
through this relay to establish a direct P2P data channel. Owns rendezvous pairing, the SDP/ICE relay
logic, and the WebSocket server entrypoint.

## Contract

- Does not own the WebRTC transport (that is `@robota-sdk/agent-transport-webrtc`); this app only
  rendezvous-pairs peers and relays their opaque signaling blobs.
- Carries no session content: within a rendezvous it relays only `offer`/`answer`/`ice` frames verbatim, and
  between device inboxes it delivers an opaque `message` to whichever connection declared `presence` at its
  topic, answering `absent` when none did. It holds no state beyond transient membership dropped on disconnect,
  and never inspects a payload. A topic is opaque — nothing in it names a device or user — though the relay can
  see the same topic recur.
- An inbox topic has one holder, the latest to declare it, so a device reconnecting before its old connection is
  noticed as gone is not locked out of its own inbox. Topics must look high-entropy, since knowing a topic is all
  addressing it takes; a connection must itself be present somewhere before it may send. Topics are capped per
  source as well as relay-wide, so a few sources cannot fill the board and lock every other device out.
- A peer never receives its own frame echoed back, and frames never cross between rendezvous ids. Any
  non-signaling frame, or an unknown signal kind, is rejected and never relayed.
- Imports no `@robota-sdk` runtime package — it is a dumb relay with a single dependency (`ws`).
- A rendezvous id admits at most two peers and is single-use: a third peer is refused even after one
  leaves, and a half-open rendezvous (one peer waiting) expires after a bounded time.
- Carries no authentication or trust of its own. Joins pass a built-in per-source rate limiter (on by
  default) and then an optional host-supplied `onJoinAttempt` admission hook for custom auth. It binds
  to loopback on an ephemeral port by default and is not wired into any default runnable, publish, or
  deploy path.
- Bounds resource consumption at the transport layer, safe by default: an oversized WebSocket frame is
  closed before buffering; total and per-IP concurrent-connection caps are enforced at accept and
  refused connections are never registered; and a per-connection message-rate limit throttles the
  signaling path independently of the join-rate limit. None of these controls inspects frame payloads.
- The per-IP cap assumes direct exposure by default. Behind a reverse proxy, the trusted right-most
  `X-Forwarded-For` hop must be configured (or the per-IP cap disabled) — otherwise every connection
  would present the proxy's IP and legitimate clients would be refused.

## Non-goals

- No built-in authentication or pairing-based admission; a host adds it through the admission hook.
- No inspection or transformation of relayed signaling data.
