# REMOTE-011 — Stage E2: signaling-server abuse hardening (transport-layer DoS bounds)

Spec: `.agents/spec-docs/active/REMOTE-011-stage-e2-signaling-abuse-hardening.md`

Parent: REMOTE-001 (Stage E). GATE-APPROVAL: proposal-reviewer ENDORSE (2 rounds). Two non-blocking
implementer notes: XFF picks the trusted-appended hop (not raw left-most); keep option layering clean
(transport caps on `ISignalingServerOptions`, `messageRate` on `ISignalingRelayOptions`).

## Tasks

- [x] T1 (TC-06): `rate-limiter.ts` — add `TokenBucketLimiter.evict(key: string): void` (`this.buckets.delete(key)`); add typed defaults `DEFAULT_MESSAGE_RATE`, `DEFAULT_MAX_CONNECTIONS`, `DEFAULT_MAX_CONNECTIONS_PER_IP`, `DEFAULT_MAX_FRAME_BYTES`. Unit test: `evict` removes a key's bucket (absent-key no-op).
- [x] T2 (TC-01/TC-06): `relay.ts` — add a per-connection message-rate `TokenBucketLimiter` keyed by peer id, consumed on each `signal` frame in `relay()`; on exhaustion `reject(peer, 'message-rate-limited')` and do NOT fan out; call `evict(peerId)` in `remove()`. Thread `messageRate` via `ISignalingRelayOptions`. Fake-peer tests: flood throttles + no fan-out; other sources unaffected; map shrinks after `remove()`.
- [x] T3 (TC-02/03/07): `server.ts` — total + per-IP connection caps at `wss.on('connection')` (`close(1013,'over-capacity')`, never register); decrement on close/error; per-IP map deletes zero-count keys. Injectable `addressResolver` (default `request.socket.remoteAddress` → `'unknown'` sentinel; `trustProxy` reads trusted-appended `X-Forwarded-For` hop); `maxConnectionsPerIp: 0`/undefined disables per-IP. Thread `maxConnections`, `maxConnectionsPerIp`, `trustProxy`, `addressResolver` via `ISignalingServerOptions`.
- [x] T4 (TC-04): `server.ts` — `new WebSocketServer({ server, maxPayload: maxFrameBytes })` (default `DEFAULT_MAX_FRAME_BYTES` ~64 KiB). Thread `maxFrameBytes` via `ISignalingServerOptions`.
- [x] T5 (TC-02/03/04/06): new `__tests__/server-caps.test.ts` — real `ws` connections: total cap closes (N+1)-th; per-IP cap via injected resolver + `0` disables; oversized frame → close 1009, small frame relays; flood-then-disconnect shrinks counters.
- [x] T6 (TC-05): extend `__tests__/integration-webrtc-relay.test.ts` — legitimate two-peer pairing still round-trips (regression).
- [x] T7 (TC-01/06): extend `__tests__/relay-hardening.test.ts` — message-rate throttle + bucket eviction.
- [x] T8: `index.ts` — export new options/consts/`evict` on the public surface (spec-public-surface scan).
- [x] T9: `docs/SPEC.md` — Boundaries (four bounds), Error Taxonomy split (relay `message-rate-limited` frame vs transport close codes 1009/1013), Public API Surface.
- [x] T10 (TC-07): `pnpm --filter @robota-sdk/remote-signaling test` + `pnpm typecheck` + `pnpm harness:scan` green.

## Test Plan / 검증

TDD: write each control's failing test first, then implement. Authoritative = the remote-signaling vitest
suite (fake-peer message-rate + eviction; real-`ws` server caps + maxPayload 1009 + per-IP via resolver
seam; webrtc-relay regression) + full typecheck + `harness:scan` (incl. spec-public-surface) green.
