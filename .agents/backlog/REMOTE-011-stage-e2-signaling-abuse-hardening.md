---
title: 'REMOTE-011: Stage E2 — signaling-server abuse hardening'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: apps/remote-signaling
depends_on: []
---

# REMOTE-011: Stage E2 — signaling-server abuse hardening

Parent: [REMOTE-001](REMOTE-001-webrtc-p2p-remote-control.md). Stage E (final hardening) decomposition
(grounding 2026-07-11): E1 = TURN fallback (REMOTE-010, DONE); **E2 = signaling-server abuse hardening
(this)**; E3 = TOFU trusted-device reconnect (REMOTE-012); E4 = reconnection/session-resume (REMOTE-013,
on E3); E5 = co-drive concurrency + attribution (REMOTE-014). E2 is **self-contained and protocol-free**
— it hardens only `apps/remote-signaling` and needs no change to the pairing protocol or the session
contract, so it can proceed independently of E3–E5.

## Problem / Goal

The signaling server (`apps/remote-signaling`) is the one owner-hosted, publicly reachable component. It
relays SDP offers/answers + ICE candidates by rendezvous id and holds no session content.

**Already hardened by REMOTE-004 (Stage B2), NOT in scope:** the _relay layer_ is safe-by-default —
per-source token bucket on `join` floods, single-use rendezvous ids, half-open TTL expiry, concurrent-
rendezvous cap, and a strict `offer`/`answer`/`ice` frame allowlist (everything else rejected
fail-closed). Rendezvous-slot hijack, id enumeration/reuse, and malformed/unknown frames are covered
there.

**Residual gaps — the _WebSocket transport layer_ in `server.ts`** (this item):

- **Unbounded frame size:** `WebSocketServer` sets no `maxPayload`, so `ws` buffers up to its 100 MiB
  default per frame before the relay sees it — a memory-exhaustion vector (signaling frames are only a
  few KB).
- **No connection cap:** nothing bounds concurrent sockets, total or per-IP. The B2 bucket limits `join`
  _attempts_, but a socket that connects and never joins is never bounded (FD/memory exhaustion).
- **No per-connection message rate:** B2 buckets only `join`; an already-joined peer can flood `signal`
  frames with no ceiling.

Goal: bound these transport-layer resource-exhaustion vectors so the public endpoint is DoS-resistant
by default, while keeping the server strictly minimal and content-free.

## Scope / Approach (to be confirmed in the spec)

- **Frame size:** set `WebSocketServer` `maxPayload` to a small default (SDP/ICE are tiny) so oversized
  frames are rejected before buffering.
- **Connection caps:** total + per-IP concurrent-connection ceilings enforced at accept time
  (refuse/close before the peer is registered).
- **Per-connection message rate:** a token bucket on the `signal` relay path (distinct from the existing
  per-source `join` bucket), reusing the B2 `TokenBucketLimiter` + injected clock.
- Every bound defaults on with a production-safe value and is override-injectable (matches the B2
  safe-by-default, dependency-injected, deterministically-tested pattern). No relayed-frame protocol
  change; the server stays a minimal SSOT with no session content.

See the spec: [`.agents/spec-docs/draft/REMOTE-011-stage-e2-signaling-abuse-hardening.md`](../spec-docs/draft/REMOTE-011-stage-e2-signaling-abuse-hardening.md).

## Test Plan

- Unit (fake-peer): a `signal` flood from a joined peer is throttled (per-connection message-rate bucket)
  with no fan-out to the counterpart; the per-source join bucket is unaffected.
- Integration (server): total + per-IP connection caps refuse the over-cap socket at accept time;
  `maxPayload` closes an oversized frame before it reaches the relay; a normal small frame relays.
- Regression: a legitimate two-peer pairing (join → offer/answer/ice at normal size + rate) still
  round-trips end-to-end (B2 behavior unchanged).
- Harness: `pnpm harness:scan` + typecheck + build green.

## User Execution Test Scenario

1. **Transport-layer DoS bounds hold; well-behaved pairing is unaffected.**
   - Prerequisites: `apps/remote-signaling` running with the default bounds; a host `/remote-control on`
     with a legitimate client paired.
   - Steps: from attacker connection(s), attempt to (a) open more sockets than the connection cap (total
     and from one IP), (b) send a frame larger than `maxFrameBytes`, (c) after joining, flood `signal`
     frames past the message-rate burst.
   - Expected: (a) the over-cap sockets are closed at accept; (b) the oversized frame closes that socket
     without reaching the relay; (c) the flood is throttled (`message-rate-limited`) with no counterpart
     fan-out — and throughout, the legitimate host↔client P2P session stays connected and responsive.
   - Evidence: _(fill after implementation)_

## Notes

Keep the signaling server content-free; all security- and content-sensitive logic stays on the P2P
channel. This item is the orthogonal sibling of E1 (TURN) — both are hardening-first and protocol-free.
