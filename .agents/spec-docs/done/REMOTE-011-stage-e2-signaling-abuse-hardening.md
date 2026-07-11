---
status: done
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
  connection caps at `wss.on('connection')`; add a per-IP-key **address resolver** seam (default
  `request.socket.remoteAddress`, `trustProxy` variant reads a trusted `X-Forwarded-For`) that also gives
  the server-level test a way to present distinct source addresses; thread new options.
- `apps/remote-signaling/src/relay.ts` — add a per-connection **message-rate** limiter to the `signal`
  relay path (distinct from the existing per-source **join** bucket); evict a peer's bucket in `remove()`;
  surface a new reject reason.
- `apps/remote-signaling/src/rate-limiter.ts` — reuse `TokenBucketLimiter` for the message-rate bucket
  **and add an `evict(key: string): void` method** (the class currently exposes only `tryConsume`, so a
  per-connection bucket would otherwise grow by every peer id EVER admitted — an unbounded leak); add typed
  defaults (`DEFAULT_MESSAGE_RATE`, `DEFAULT_MAX_CONNECTIONS`, `DEFAULT_MAX_CONNECTIONS_PER_IP`,
  `DEFAULT_MAX_FRAME_BYTES`).
- `apps/remote-signaling/src/index.ts` — export any new option/const/method on the public surface.
- `apps/remote-signaling/docs/SPEC.md` — extend Boundaries / Error Taxonomy / Public API with the new
  bounds, the relay reject reason, and the transport close codes.
- Tests: `__tests__/relay-hardening.test.ts` (message-rate + bucket eviction), a server-level test for
  caps + `maxPayload` + per-IP via the address-resolver seam.

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
   may complement in production but cannot be the default posture. **Interaction hazard (must be resolved,
   not ignored):** the per-IP cap keys on the TCP peer address — if a proxy IS fronting the server, every
   connection presents the proxy's IP, so a naive per-IP cap collapses and rejects _legitimate_ clients.
   The Decision therefore makes the per-IP cap assume **direct exposure by default** and adds an explicit
   `trustProxy` opt-in (read a trusted `X-Forwarded-For`) plus the ability to disable the per-IP cap — so
   the proxy deployment is correct rather than self-defeating.
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

Two correctness requirements ride with the decision (not optional): (a) the per-connection message-rate
bucket is only truly "bounded by live connections" if `TokenBucketLimiter` can **evict** a key — so an
`evict(key)` method is added and called from `relay.remove()`; without it the map grows by every peer id
ever admitted, re-introducing the exact unbounded-growth class this stage closes. (The pre-existing B2
`join` bucket keyed by `remoteAddress` has the same latent growth; that is out of scope here but noted so
a future item can bound it.) (b) the per-IP cap assumes **direct exposure**; behind a trusted proxy it is
enabled via `trustProxy` (`X-Forwarded-For`) or disabled — never left to silently reject all clients.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: single app (`apps/remote-signaling`); no sibling signaling server exists (verified `apps/` listing — only this relay). The two enforcement layers (`server.ts` transport, `relay.ts` application) are both covered in scope.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **Frame size (`server.ts`):** construct `new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES })`
  with a small default (e.g. 64 KiB — comfortably above any SDP/ICE frame, far below 100 MiB). `ws` reads
  the frame's declared length from the header and closes with code **1009 (message too big)** BEFORE
  buffering the body, so the oversized frame never reaches our `message` handler.
- **Connection caps (`server.ts`):** track live socket count total and per resolved source key; in
  `wss.on('connection')`, if either the total (`MAX_CONNECTIONS`) or the per-IP
  (`MAX_CONNECTIONS_PER_IP`) ceiling is already met, `socket.close(1013, 'over-capacity')` immediately and
  do not register the peer. Decrement on `close`/`error`. Bound the per-IP tracking map so it cannot itself
  grow unboundedly (delete a source key when its count returns to 0).
- **Per-IP source resolution + proxy stance (`server.ts`):** the per-IP key comes from an injectable
  **address resolver** `(request) => string`. Default resolver returns `request.socket.remoteAddress`,
  falling back to a fixed sentinel (e.g. `'unknown'`) when it is `undefined` (so a missing address does not
  crash or bypass the cap). A `trustProxy: true` option swaps in a resolver that reads the left-most
  trusted `X-Forwarded-For` hop. The per-IP cap is **disable-able** (`maxConnectionsPerIp: 0`/undefined →
  off) for proxy deployments that cannot supply a real client IP. The resolver seam doubles as the
  server-level test's way to present distinct source addresses over loopback (TC-03).
- **Message-rate (`relay.ts`):** add a second `TokenBucketLimiter` keyed by **peer id** (per connection),
  consumed on each `signal` frame in `relay()`. On exhaustion, `reject(peer, 'message-rate-limited')` and
  do not forward. The existing per-source **join** bucket is unchanged. In `remove()`, call the new
  `limiter.evict(peerId)` on the message bucket so the map is bounded by LIVE connections, not lifetime.
- **`TokenBucketLimiter.evict` (`rate-limiter.ts`):** add `evict(key: string): void { this.buckets.delete(key); }`
  — the class currently exposes only `tryConsume`, so without eviction the "bounded by live connections"
  guarantee is false. (Noted, out of scope: the B2 `join` bucket keyed by `remoteAddress` has the same
  latent unbounded growth; a follow-up can evict it on a schedule.)
- **Options:** thread `maxFrameBytes`, `maxConnections`, `maxConnectionsPerIp`, `trustProxy`,
  `addressResolver`, `messageRate` through `ISignalingServerOptions` / `ISignalingRelayOptions`, each
  defaulting to the new safe constants.
- **SPEC.md:** document the bounds under Boundaries; split the failure surface into (i) **relay error
  frames** — add `message-rate-limited` alongside the existing `{ type:'error', reason }` reasons — and
  (ii) a new **transport close codes** subsection — `1009` (oversize, from `ws` `maxPayload`) and `1013`
  (`over-capacity`, connection-cap refusal); list new exports under Public API Surface.

## Affected Files

- `apps/remote-signaling/src/server.ts`
- `apps/remote-signaling/src/relay.ts`
- `apps/remote-signaling/src/rate-limiter.ts`
- `apps/remote-signaling/src/index.ts`
- `apps/remote-signaling/docs/SPEC.md`
- `apps/remote-signaling/src/__tests__/relay-hardening.test.ts`
- `apps/remote-signaling/src/__tests__/server-caps.test.ts` (new)

## Completion Criteria

- [x] TC-01: A `signal` frame flood from one joined fake peer is throttled — after the burst, `relay()`
      calls `reject(peer, 'message-rate-limited')` and does NOT forward to the counterpart; the join
      bucket for other sources is unaffected.
- [x] TC-02: With `maxConnections: N`, the (N+1)-th concurrent WebSocket connection is closed at accept
      time (never registered as a peer); after one closes, a new connection is admitted again.
- [x] TC-03: With `maxConnectionsPerIp: K` and an injected address resolver mapping connections to two
      distinct source keys, the (K+1)-th connection sharing a source key is closed at accept
      (`close(1013,'over-capacity')`) while a connection with a different source key is still admitted;
      with `maxConnectionsPerIp: 0` the per-IP cap is off (no refusal on source-key collision).
- [x] TC-04: A frame larger than `maxFrameBytes` does not reach the relay handler (the `ws` connection is
      closed with code `1009`); a normal small frame relays successfully (regression).
- [x] TC-05: A legitimate two-peer pairing (join → offer/answer/ice at normal size + rate) completes
      end-to-end unchanged — no new bound trips for well-behaved peers (regression against B2 behavior).
- [x] TC-06: `TokenBucketLimiter.evict(key)` removes a key's bucket; after a joined peer floods `signal`
      and then `remove()` runs, the message-bucket map no longer contains that peer id (memory bound), and
      the total/per-IP connection counters return to their pre-connection values after disconnect.
- [x] TC-07: New bounds are override-injectable and default to the documented safe constants
      (`DEFAULT_MAX_FRAME_BYTES`, `DEFAULT_MAX_CONNECTIONS`, `DEFAULT_MAX_CONNECTIONS_PER_IP`,
      `DEFAULT_MESSAGE_RATE`); a resolved source address of `undefined` maps to the sentinel key (no crash,
      cap still applies); `pnpm harness:scan` + typecheck + build green.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                                     | Notes                                                 |
| ----- | -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| TC-01 | Unit (fake-peer)     | vitest — fake peers + injected `IClock`; flood `signal`, assert `message-rate-limited` + no fan-out | Deterministic, network-free (reuses B2 harness)       |
| TC-02 | Integration (server) | vitest — real `ws` client connections to `startSignalingServer({ relay:{ maxConnections } })`       | Server-layer cap; assert (N+1)-th socket closed       |
| TC-03 | Integration (server) | vitest — injected `addressResolver` maps sockets to 2 source keys; assert per-IP cap + `0` disables | Resolver seam makes distinct source keys testable     |
| TC-04 | Integration (server) | vitest — send a frame > `maxFrameBytes`; assert handler not invoked / socket closed 1009; small OK  | Exercises `ws` `maxPayload` → close 1009              |
| TC-05 | Integration (webrtc) | vitest — extend `integration-webrtc-relay.test.ts`: full pair still round-trips                     | Regression: well-behaved peers unaffected             |
| TC-06 | Unit + Integration   | vitest — `evict` unit test; flood-then-`remove()` asserts message-bucket map + conn counters shrink | Proves the memory bound (G1)                          |
| TC-07 | CI smoke             | `pnpm --filter @robota-sdk/remote-signaling test` + `pnpm harness:scan` exit 0 + `pnpm typecheck`   | Defaults + injectability + undefined-address sentinel |

## Tasks

- [x] `.agents/tasks/REMOTE-011.md` — created at GATE-APPROVAL.

## Evidence Log

- **GATE-APPROVAL:** proposal-reviewer ENDORSE (2 rounds). Round 1 REVISE (G1 evict / G2 proxy stance /
  G3 taxonomy split + tests); round 2 ENDORSE with all four resolved. Two non-blocking implementer notes
  applied: XFF picks the trusted right-most hop (`forwardedForResolver`); option layering kept clean
  (transport caps on `ISignalingServerOptions`, `messageRate` on `ISignalingRelayOptions`).
- **Implementation:** `rate-limiter.ts` — `evict(key)` + `size` getter + `DEFAULT_MESSAGE_RATE`/
  `DEFAULT_MAX_CONNECTIONS`/`DEFAULT_MAX_CONNECTIONS_PER_IP`/`DEFAULT_MAX_FRAME_BYTES`. `relay.ts` —
  per-connection message-rate bucket keyed by peer id, `message-rate-limited` reject + no fan-out, evict
  on `remove()`, `messageBucketCount` diagnostics. `server.ts` — `maxPayload`, total + per-IP caps at
  accept (`close(1013,'over-capacity')`), injectable `addressResolver` (+ `trustProxy` XFF + `undefined`
  sentinel), idempotent release decrement, `connectionCount` diagnostics. `index.ts` public exports;
  `docs/SPEC.md` Boundaries + Error-Taxonomy split + Public API.
- **Verification (2026-07-11):** `pnpm --filter @robota-sdk/remote-signaling test` → 26 passed (TC-01
  message-rate throttle + per-connection isolation + no fan-out; TC-02 total cap; TC-03 per-IP cap via
  resolver seam + `0` disables; TC-04 oversize→1009 + small relays; TC-05 webrtc-relay regression; TC-06
  evict + counter/map shrink; TC-07 defaults + undefined sentinel). Full `pnpm typecheck` clean.
  `pnpm harness:scan` → all 49 passed (incl. `spec-public-surface`).
