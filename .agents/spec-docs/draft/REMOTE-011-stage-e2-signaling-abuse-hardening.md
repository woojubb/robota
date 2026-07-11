---
status: draft
type: SECURITY
tags: [websocket, auth, async]
---

# REMOTE-011: Stage E2 — signaling-server abuse hardening (transport-layer DoS bounds)

## Problem

`apps/remote-signaling` is the one owner-hosted, publicly reachable component of `/remote-control`. Its
**relay layer** was already abuse-hardened in REMOTE-004 (Stage B2): a per-source token bucket bounds
`join` floods (`relay.ts:140`), rendezvous ids are single-use (`relay.ts:159`), half-open rendezvous
expire on a TTL (`relay.ts:252`), concurrent rendezvous are capped (`relay.ts:166`), and only
`offer`/`answer`/`ice` frames are ever forwarded — everything else is rejected fail-closed
(`relay.ts:135`). Those relay-layer vectors are **already covered** and are NOT in scope here.

What remains unhardened is the **WebSocket transport layer** in `server.ts`, which is where an
unauthenticated attacker can still mount denial-of-service against the public endpoint:

1. **Unbounded frame size.** `new WebSocketServer({ server })` (`server.ts:58`) sets no `maxPayload`, so
   `ws` accepts up to its 100 MiB default per frame. Signaling frames are tiny (an SDP offer is a few KB;
   ICE candidates are smaller). A single peer can send a 100 MiB frame — `data.toString()`
   (`server.ts:62`) buffers the whole thing before the relay ever sees it — repeatedly, to exhaust host
   memory. Reproduction: connect and send one frame just under 100 MiB; server memory spikes with no bound.
2. **No connection cap.** Nothing bounds the number of concurrent WebSocket connections, total or per
   source IP. The B2 token bucket limits `join` _attempts_ per source, but a socket that connects and
   never joins is never rate-limited (`join` is the only bucketed path). Reproduction: open thousands of
   sockets without sending `join`; each consumes an FD + buffers with no ceiling.
3. **No per-connection message rate.** B2 buckets only `join`. An already-joined peer can flood `signal`
   frames (`relay()` at `relay.ts:194` has no rate limit), forcing unbounded relay work + fan-out to its
   counterpart. Reproduction: join, then emit `signal` frames in a tight loop.

All three are transport-layer resource-exhaustion vectors on a public endpoint. The relay stays
content-blind and holds no session content; this stage only bounds resource consumption at the socket.

## Architecture Review

### Affected Scope

- `apps/remote-signaling/src/server.ts` — set `WebSocketServer` `maxPayload`; enforce total + per-IP
  connection caps at `wss.on('connection')`; thread new options.
- `apps/remote-signaling/src/relay.ts` — add a per-connection **message-rate** limiter to the `signal`
  relay path (distinct from the existing per-source **join** bucket); surface a new reject reason.
- `apps/remote-signaling/src/rate-limiter.ts` — reuse `TokenBucketLimiter` for the message-rate bucket;
  add typed defaults (`DEFAULT_MESSAGE_RATE`, `DEFAULT_MAX_CONNECTIONS`, `DEFAULT_MAX_CONNECTIONS_PER_IP`,
  `DEFAULT_MAX_FRAME_BYTES`).
- `apps/remote-signaling/src/index.ts` — export any new option/const on the public surface.
- `apps/remote-signaling/docs/SPEC.md` — extend Boundaries / Error Taxonomy / Public API with the new
  bounds and reject reasons.
- Tests: `__tests__/relay-hardening.test.ts` (message-rate), a server-level test for caps + `maxPayload`.

### Alternatives Considered

1. **Bound only at the relay (application) layer — parse then measure size, count connections in the
   relay.** Pro: single layer, fully covered by the network-free fake-peer suite. Con: the frame is
   already fully buffered by `ws` before the relay sees it, so an application-layer size check does NOT
   prevent the 100 MiB buffering — the DoS already happened. Connection counting in the relay also can't
   refuse a socket that never sends a frame. Rejected: cannot close vectors #1/#2 at that layer.
2. **Rely on an external reverse proxy (nginx/Cloudflare) for size + connection limits.** Pro: zero app
   code; production-grade. Con: the server ships as a self-hostable minimal app (REMOTE-001 constraint —
   "the one piece the owner hosts"); it must be safe **by default** without assuming a fronting proxy,
   exactly as B2 made the relay safe by default rather than hook-dependent. Rejected as the sole control;
   may complement in production but cannot be the default posture.
3. **(Chosen) Bound at the transport layer in `server.ts` (maxPayload + connection caps) and add a
   per-connection message-rate bucket at the relay.** Pro: `maxPayload` makes `ws` reject an oversized
   frame before buffering it; connection caps refuse sockets at accept time regardless of join; message
   rate reuses the proven `TokenBucketLimiter` with an injected clock so it stays in the deterministic
   suite. Con: caps + maxPayload need a thin server-level test (a real `ws` connection) since they live
   above the fake-peer relay seam. Accepted: each control sits at the only layer that can enforce it.

### Decision

Take alternative 3: enforce **frame size** and **connection caps** in `server.ts` (the transport layer,
the only place that can refuse before buffering / before a frame is sent), and add a **per-connection
message-rate** bucket to the relay's `signal` path (reusing `TokenBucketLimiter` + injected `IClock`).
Every bound defaults on with a production-safe value and is override-injectable for tests — matching the
B2 pattern (safe-by-default, dependency-injected, deterministically tested). This is a
contract-boundary-safe change: it only adds refusal paths on an untrusted public surface (a legitimate
host↔client pairing sends small, low-rate frames and is unaffected); it does not alter the relayed frame
protocol, so both existing peers (werift host + browser client) remain fully reachable — validated
against the relay's frame contract (`offer`/`answer`/`ice` unchanged) and the fake-peer regression suite.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: single app (`apps/remote-signaling`); no sibling signaling server exists (verified `apps/` listing — only this relay). The two enforcement layers (`server.ts` transport, `relay.ts` application) are both covered in scope.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **Frame size (`server.ts`):** construct `new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES })`
  with a small default (e.g. 64 KiB — comfortably above any SDP/ICE frame, far below 100 MiB). `ws`
  rejects and closes a connection that exceeds it before delivering the frame to our handler.
- **Connection caps (`server.ts`):** track live socket count total and per remote IP; in
  `wss.on('connection')`, if either the total (`MAX_CONNECTIONS`) or the per-IP
  (`MAX_CONNECTIONS_PER_IP`) ceiling is already met, `socket.close()` immediately (with a bounded close
  code/reason) and do not register the peer. Decrement on `close`/`error`. Bound the per-IP tracking map
  so it cannot itself grow unboundedly (evict zero-count entries).
- **Message-rate (`relay.ts`):** add a second `TokenBucketLimiter` keyed by **peer id** (per connection),
  consumed on each `signal` frame in `relay()`. On exhaustion, `reject(peer, 'message-rate-limited')` and
  do not forward. The existing per-source **join** bucket is unchanged. Clean up a peer's message bucket
  on `remove()` so the bucket map is bounded by live connections.
- **Options:** thread `maxFrameBytes`, `maxConnections`, `maxConnectionsPerIp`, `messageRate` through
  `ISignalingServerOptions` / `ISignalingRelayOptions`, each defaulting to the new safe constants.
- **SPEC.md:** document the four bounds under Boundaries, add `message-rate-limited` (and any
  connection-refused close reason) to the Error Taxonomy, and list new exports under Public API Surface.

## Affected Files

- `apps/remote-signaling/src/server.ts`
- `apps/remote-signaling/src/relay.ts`
- `apps/remote-signaling/src/rate-limiter.ts`
- `apps/remote-signaling/src/index.ts`
- `apps/remote-signaling/docs/SPEC.md`
- `apps/remote-signaling/src/__tests__/relay-hardening.test.ts`
- `apps/remote-signaling/src/__tests__/server-caps.test.ts` (new)

## Completion Criteria

- [ ] TC-01: A `signal` frame flood from one joined fake peer is throttled — after the burst, `relay()`
      calls `reject(peer, 'message-rate-limited')` and does NOT forward to the counterpart; the join
      bucket for other sources is unaffected.
- [ ] TC-02: With `maxConnections: N`, the (N+1)-th concurrent WebSocket connection is closed at accept
      time (never registered as a peer); after one closes, a new connection is admitted again.
- [ ] TC-03: With `maxConnectionsPerIp: K`, the (K+1)-th connection from the SAME remote IP is closed at
      accept time while a connection from a different IP is still admitted.
- [ ] TC-04: A frame larger than `maxFrameBytes` does not reach the relay handler (the `ws` connection is
      closed by `maxPayload`); a normal small frame relays successfully (regression).
- [ ] TC-05: A legitimate two-peer pairing (join → offer/answer/ice at normal size + rate) completes
      end-to-end unchanged — no new bound trips for well-behaved peers (regression against B2 behavior).
- [ ] TC-06: New bounds are override-injectable and default to the documented safe constants
      (`DEFAULT_MAX_FRAME_BYTES`, `DEFAULT_MAX_CONNECTIONS`, `DEFAULT_MAX_CONNECTIONS_PER_IP`,
      `DEFAULT_MESSAGE_RATE`); `pnpm harness:scan` + typecheck + build green.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                                     | Notes                                                    |
| ----- | -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | Unit (fake-peer)     | vitest — fake peers + injected `IClock`; flood `signal`, assert `message-rate-limited` + no fan-out | Deterministic, network-free (reuses B2 harness)          |
| TC-02 | Integration (server) | vitest — real `ws` client connections to `startSignalingServer({ relay:{ maxConnections } })`       | Server-layer cap; assert (N+1)-th socket closed          |
| TC-03 | Integration (server) | vitest — two source addresses (loopback + stub `remoteAddress`) assert per-IP cap                   | Per-IP cap at accept                                     |
| TC-04 | Integration (server) | vitest — send a frame > `maxFrameBytes`; assert handler not invoked / socket closed; small frame OK | Exercises `ws` `maxPayload`                              |
| TC-05 | Integration (webrtc) | vitest — extend `integration-webrtc-relay.test.ts`: full pair still round-trips                     | Regression: well-behaved peers unaffected                |
| TC-06 | CI smoke             | `pnpm --filter @robota-sdk/remote-signaling test` + `pnpm harness:scan` exit 0 + `pnpm typecheck`   | Defaults + injectability; scan/spec-public-surface green |

## Tasks

- [ ] `.agents/tasks/REMOTE-011.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
