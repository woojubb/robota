---
status: done
type: INFRA
tags: [remote-control, webrtc, signaling, security]
parent: REMOTE-001
---

# REMOTE-004: Stage B2 — production ws signaling client + relay abuse-hardening + CVE-2024-29415 discharge

Parent design: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages
done: [REMOTE-002](../done/REMOTE-002-stage-a-transport-protocol-webrtc-skeleton.md) (Stage A),
[REMOTE-003](../done/REMOTE-003-stage-b1-command-verb-gating.md) (Stage B1). Stage B is **hardening-first**; this is
**B2** — make the P2P path real over an actual signaling server, harden that server against abuse, and discharge
the werift-transitive `CVE-2024-29415` that was ignored in Stage A. **Still NO user-facing enable path** (that is
B4); B2 ships production plumbing exercised only by tests.

## Problem

1. **No production signaling client.** Stage A shipped only `createInMemorySignalingPair()` (loopback/mock). The
   `WebRtcTransport` takes an injected `ISignalingClient` (`packages/agent-transport-webrtc/src/signaling.ts:15-22`,
   `send`/`onSignal`/`close`), but nothing connects it to the real relay (`apps/remote-signaling`). The full P2P
   path (two NAT'd peers → real relay → direct `RTCDataChannel`) has never been exercised end-to-end.
2. **The relay has no abuse protection.** `SignalingRelay` exposes a synchronous `onJoinAttempt(rendezvous,
peerId)` seam (`apps/remote-signaling/src/relay.ts:39-41`) that is a documented no-op, and the ws binding
   (`server.ts`) does not even capture the client address. An open relay is trivially floodable — rendezvous
   exhaustion, join spam — before any pairing exists.
3. **`CVE-2024-29415` is carried, not resolved.** Stage A added it to `pnpm.auditConfig.ignoreCves` because
   werift was unwired; B2 makes real ICE gathering reachable, so REMOTE-002's Evidence Log mandates discharging it
   here (mitigate / override / reviewed re-accept) before the enable path ships.

## Solution (sub-sequenced, each commit green)

1. **Production `WsSignalingClient`** (new, in `agent-transport-webrtc`; add `ws` as a dependency — a third-party
   npm dep that stays external under INFRA-028, already used by `agent-transport-ws` + `remote-signaling`).
   Implements `ISignalingClient` over a `ws` socket: connect to `{ url, rendezvous }`; on open send
   `{ type: 'join', rendezvous }`; map inbound relay `{ type: 'signal', kind, data }` → `onSignal({ kind, data })`;
   `send(ISignalMessage)` → `{ type: 'signal', kind, data }`; `close()` tears down the socket. Connection/relay
   errors (`error` frames, socket errors, close-before-join) surface via an explicit error callback / thrown
   rejection — **never a silent degrade** (no-fallback, mirroring `loadReplayProvider`). Buffer outbound signals
   produced before the socket opens and flush on open (so an offer created before `open` is not dropped).
2. **Relay abuse-hardening — enforced inside the relay, safe-by-default (Decision D2).** The rate limiter lives
   **in `SignalingRelay`** (not stranded in the ws binding): it is an injected, **default-on**, content-blind
   component (clock + params injected → deterministically testable by the existing fake-peer unit suite; never
   inspects `data`). The ws binding's only new job is to capture the client remote address at connection
   (`req.socket.remoteAddress`) and deliver it to the relay via the **widened join context** (see D1) or on
   `ISignalingPeer`. Mechanisms:
   - per-source (IP) **token-bucket** on join attempts (N per window) — a rejected join gets `join-rejected` and
     the relay never forwards a signal for it;
   - **single-use rendezvous — exact predicate (D3):** the relay tracks the **lifetime count of distinct peers
     admitted** to a rendezvous id. A join is refused (`rendezvous-full`) when admitting it would make that
     lifetime count exceed 2 — i.e. a _new distinct_ peer beyond the two that ever held it, **even after one
     leaves** (no id reuse; a ws reconnect is a new `peer.id` → refused, which is the intended security behavior).
     An **idempotent re-join by an already-admitted peer/connection** (`room.has(peer)`, `relay.ts:101,105-109`)
     stays allowed — single-use must NOT break in-session re-joins.
   - **short rendezvous TTL** — a rendezvous holding only one peer expires after ~60s (matches the design's
     single-use + short-TTL pairing-secret model); the TTL timer runs only while exactly one peer is present and
     is cleared when the second peer joins.
   - **cap total concurrent rendezvous** (a hard ceiling).
   - **Trusted-proxy caveat (forward note for B4/E):** `req.socket.remoteAddress` is the proxy/LB IP behind any
     real deployment (collapsing all per-IP buckets), and `X-Forwarded-For` is spoofable. This is acceptable in B2
     (loopback, no enable path), but **B4/E must add a configured trusted-proxy setting before the per-IP key is
     meaningful** — otherwise the online-guess bound the parent design's pairing security leans on is undermined at
     deploy time. Recorded as a B4/E prerequisite, not solved here.
3. **Discharge `CVE-2024-29415` (evidence-based re-accept).** Reachability analysis (grep-verified): werift /
   werift-ice **never call the vulnerable `ip.isPublic` / `ip.isPrivate`** (the CVE's SSRF functions). The only
   `ip.*` usages are STUN codec helpers (`isV4Format` / `toBuffer` / `toString`) and `ip.isLoopback`, and
   `isLoopback` is applied to **the host's own `os.networkInterfaces()` output** (trusted local NIC list, not
   attacker-controlled remote data) when gathering host candidates. The SSRF vector (attacker-controlled input to
   `isPublic`/`isPrivate`) is therefore **not reachable**. Decision: **keep the `ignoreCves` entry with this
   documented reachability rationale** (a reviewed re-accept — permanent, not a deferral), and expose werift's
   `forceTurn` / ICE-server config on `IWebRtcTransportOptions` as opt-in **defense-in-depth** (relay-only ICE
   restricts host-candidate gathering entirely).
   - **Explicit override of the parent design (D4).** REMOTE-001 Stage B (design lines 188–193) assumed the
     `ip.isPublic`/`isPrivate` miscategorization "becomes security-relevant" once ICE is reachable and directed
     that the `ignoreCves` entry be **removed** after an ICE-candidate-policy mitigation. Code verification shows
     that underlying premise is **false for werift** — those functions are never called — so B2 **deliberately
     overrides that remove-expectation** and instead re-accepts with the reachability evidence. This is a reviewed
     correction of a wrong parent premise, not a silent contradiction: land paired updates to the REMOTE-002
     Evidence Log **and** the REMOTE-001 design Stage B note recording the analysis + the override.
4. **NO enable path.** Do not register the transport, `WsSignalingClient`, or the rate-limited relay into any
   runnable/publish/deploy path; the relay still binds loopback/ephemeral in tests. B2 is exercised only by tests.

## Affected Files

- `packages/agent-transport-webrtc/src/ws-signaling-client.ts` (new: `WsSignalingClient implements ISignalingClient`) + `index.ts` export + `package.json` (`ws` dep) + `docs/SPEC.md`
- `packages/agent-transport-webrtc/src/webrtc-transport.ts` (`IWebRtcTransportOptions` gains opt-in `forceTurn`/ICE config for defense-in-depth)
- `apps/remote-signaling/src/relay.ts` (widened join-seam context incl. `remoteAddress`; **injected default-on rate limiter + single-use lifetime-peer-count + TTL enforced in the relay**), new `src/rate-limiter.ts` (token-bucket, injected clock), `src/server.ts` (capture `req.socket.remoteAddress` → relay only) + `docs/SPEC.md`
- `packages/agent-transport-webrtc/src/__tests__/*` (ws-client ↔ real-relay integration round-trip), `apps/remote-signaling/src/__tests__/*` (rate-limit / TTL / single-use)
- `package.json` root `pnpm.auditConfig.ignoreCves` (retain `CVE-2024-29415` with an inline-adjacent doc/comment reference to the resolved analysis)
- REMOTE-002 done-spec Evidence + REMOTE-001 design Stage B note (record CVE resolved); changeset

## Completion Criteria

- [x] TC-01: `WsSignalingClient` implements `ISignalingClient`; a loopback integration test starts the real
      `startSignalingServer()`, connects two `WsSignalingClient`s to one rendezvous, drives `WebRtcTransport`
      (offerer) + an answerer, and round-trips a `TClientMessage`→session→`TServerMessage` over the resulting
      **real `RTCDataChannel`** (no in-memory pair) — end-to-end through the actual relay.
- [x] TC-02: signals produced before the socket opens are buffered + flushed (an offer created pre-open is
      delivered), and relay/socket errors surface explicitly (no silent degrade) — asserted.
- [x] TC-03: rate limiting — enforced **inside the relay** (fake-peer unit suite, no network): join attempts
      beyond the per-source token-bucket are rejected (`join-rejected`); the relay never forwards a signal for a
      rejected join.
- [x] TC-04: single-use + TTL — a **new distinct** peer joining after the rendezvous's lifetime distinct-peer
      count reached 2 is refused (`rendezvous-full`), including after one peer left; an **idempotent re-join by an
      already-admitted peer** is still allowed; a half-open (1-peer) rendezvous expires after its TTL (injected
      clock), and the TTL timer is cleared when the second peer joins.
- [x] TC-05: `CVE-2024-29415` reachability analysis recorded; `ip.isPublic`/`isPrivate` are grep-verified as
      never called by werift/werift-ice; the `ignoreCves` entry is retained with the documented rationale;
      `pnpm audit --audit-level high` exits 0. Optional `forceTurn` defense-in-depth is exposed + unit-checked.
- [x] TC-06: **NO enable path** — no `WsSignalingClient` / rate-limited relay wired into `cli.ts` / any
      runnable/publish/deploy path (grep-asserted); relay binds loopback/ephemeral in tests.
- [x] TC-07: `pnpm harness:scan` (+ deps/spec-public-surface for the new exports) + affected suites
      (agent-transport-webrtc, remote-signaling) + full-repo `pnpm typecheck` 0; changeset present.

## Test Plan

RED→GREEN. The ws client is proven by a Node↔Node **real-relay** integration test (start the ws relay on
`127.0.0.1:0`, two ws signaling clients, a full data-channel round-trip through the reused handler — a strict
superset of Stage A's in-memory TC-03). The rate limiter + TTL + single-use are unit-tested with an injected clock
against fake peers. The CVE analysis is captured as a repeatable grep assertion (isPublic/isPrivate absent) plus
`pnpm audit --audit-level high` exit 0. harness `deps`/`spec-public-surface`/`entry-point-only` green; changeset.

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — Join-seam widened + built-in limiter.** Extend the join seam to a context object
  `{ rendezvous, peerId, remoteAddress? }` (so limiting can key on IP) AND add a **built-in, default-on** limiter —
  the relay must be safe by default, not only when a host wires a hook. The hook remains for custom auth on top.
- **D2 — Limiter enforced INSIDE the relay** (injected, default-on, injected clock), NOT in the ws binding — so it
  is safe-by-default at the relay layer and covered by the network-free fake-peer unit suite. `server.ts` only
  captures `remoteAddress` and passes it through.
- **D3 — Single-use exact predicate:** track the **lifetime count of distinct peers admitted** per rendezvous;
  refuse a join that would push it past 2 (a new distinct peer, even after one leaves; a ws reconnect = new
  `peer.id` → refused). Idempotent re-join by an already-admitted `peer` (`room.has(peer)`) stays allowed.
- **D4 — CVE-2024-29415 evidence-based re-accept, overriding the parent's remove-expectation.** Keep the
  `ignoreCves` entry with the verified non-reachability rationale (no upstream fix exists → a fork override is a
  worse supply-chain posture than a documented re-accept); expose `forceTurn` as opt-in defense-in-depth; land the
  paired REMOTE-002 Evidence + REMOTE-001 Stage B updates recording the override.
- **D5 — `ws` as an external dep of `agent-transport-webrtc`** (INFRA-028-safe; already used by sibling packages)
  over a transport-injected socket factory. This `WsSignalingClient` is the Node host-side client only; the Stage D
  browser client implements `ISignalingClient` on native `WebSocket`.
- **D6 — Trusted-proxy is a B4/E prerequisite** (not solved here): behind a proxy, `req.socket.remoteAddress`
  collapses per-IP buckets and `X-Forwarded-For` is spoofable — acceptable in B2 (loopback, no enable path), but a
  configured trusted-proxy setting must land before the per-IP key is meaningful in deployment.

## Open Questions (for GATE-APPROVAL)

None — resolved at round 2. **Pinned defaults (all injected params, tunable):** token-bucket = burst 5 joins,
refill 1 token / 12s (~5/min steady) per source; rendezvous TTL = 60s (half-open); max concurrent rendezvous = 1024. A **max-concurrent-rendezvous-cap** assertion is added to the TC-04 unit suite (round-2 note).

## Tasks

- [x] Step 1 — `WsSignalingClient` (ws-backed `ISignalingClient`; pre-open buffering; explicit error surfacing) + export + `ws` dep.
- [x] Step 2 — relay abuse-hardening IN THE RELAY: injected default-on token-bucket (fed `remoteAddress` via the widened join context), single-use lifetime-distinct-peer predicate (D3), TTL (injected clock), max-rendezvous cap; `server.ts` captures the address only.
- [x] Step 3 — CVE-2024-29415 reachability analysis + retain `ignoreCves` with rationale; expose `forceTurn` defense-in-depth.
- [x] Step 4 — real-relay integration round-trip test + rate-limit/TTL unit tests; SPEC updates + changeset.
- [x] Step 5 — verify: no enable path (TC-06); harness:scan + audit exit 0 + typecheck + changeset.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from the REMOTE-001 Stage B decomposition (B2). Grounding verified against
  code: only `createInMemorySignalingPair` exists (no production client); the relay `onJoinAttempt` seam is a
  no-op and `server.ts` does not capture the client address; **`CVE-2024-29415` reachability**: grep of
  `werift@0.23.0` + `werift-ice@0.2.2` finds **no `ip.isPublic`/`ip.isPrivate` call sites** — the only `ip.*`
  usages are `isV4Format`/`toBuffer`/`toString` (STUN codec) + `ip.isLoopback` on `os.networkInterfaces()` output
  (trusted local NICs), so the CVE's SSRF vector is not reachable. Pending proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction + all six core decisions endorsed;
  the CVE non-reachability crux **independently verified sound** — zero `isPublic`/`isPrivate` call sites in
  werift/werift-ice; only STUN codec helpers + `ip.isLoopback` on trusted local NICs; no upstream fix → re-accept
  beats a fork). Four corrections folded in: (1) **D3** — stated the exact single-use predicate (lifetime distinct
  peers > 2 refused; idempotent re-join by an already-admitted peer preserved, reconciled with `relay.ts:101-109`).
  (2) **D2** — moved the rate limiter INTO the relay (injected, default-on, fake-peer-unit-testable), not stranded
  in `server.ts`. (3) **D6** — added the `remoteAddress`/trusted-proxy caveat as a B4/E prerequisite. (4) **D4** —
  explicitly recorded that B2 overrides the parent design's "remove `ignoreCves` after mitigation" expectation on
  the strength of the verified non-reachability, with paired REMOTE-002/REMOTE-001 updates. Re-review → round 2.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All four round-1 corrections verified folded
  in + code-accurate + internally consistent (D3 predicate reconciled with `relay.ts:101-109`; D2 limiter in the
  relay with matching Affected Files/TC/Tasks; D6 caveat present; D4 override framed with paired updates). CVE
  non-reachability re-confirmed incl. the indirect path (`ip.address()` → `isPrivate/isPublic` is never reached —
  werift uses its own `nodeIpAddress` over `os.networkInterfaces()`). Two non-blocking impl notes adopted:
  (i) add a **max-concurrent-rendezvous-cap** assertion to the TC-04 unit suite; (ii) pinned rate-limit defaults
  (burst 5, refill 1/12s, TTL 60s, max 1024 rendezvous — all injected/tunable). Design APPROVED → implement.
  Spec → active.
- 2026-07-11 GATE-IMPLEMENT — B2 built per D1–D6. `WsSignalingClient` (ws-backed `ISignalingClient`; pre-open
  buffering + flush; explicit `onError`; `onReady` on join) + `ws` dep + `forceTurn` on `IWebRtcTransportOptions`.
  Relay hardened IN-LAYER: `TokenBucketLimiter` (injected clock), single-use lifetime-distinct-peer predicate,
  half-open TTL + post-empty lifetime GC (injected scheduler), max-rendezvous cap; `server.ts` captures
  `req.socket.remoteAddress` and force-terminates live sockets on close. CVE-2024-29415 kept as a reviewed
  re-accept with a regression guard (`cve-2024-29415-reachability.test.ts`); paired REMOTE-002 Evidence + REMOTE-001
  Stage B note updated to "RESOLVED (option c)".
  - **Verification:** new/updated suites green — agent-transport-webrtc **11** (ws-client 5, CVE 1, +existing),
    remote-signaling **17** (rate-limiter 3, hardening 7, real-relay E2E round-trip 1, +existing 6). The E2E
    (TC-01) revealed and fixed a real bug: `server.close()` hung on lingering ws sockets → now force-terminates
    clients. Full-repo `typecheck` 0; `harness:scan` **49/49** (spec-public-surface updated for `WsSignalingClient`
    - the rate-limiter exports). `pnpm audit --audit-level high` exit 0. TC-06 grep: no enable path
      (`WsSignalingClient`/`remote-signaling`/`WebRtcTransport` absent from `agent-cli`). Lint 0 errors (boundary
      `unknown` warnings only, tolerated). Changeset added. → GATE-VERIFY.
- 2026-07-11 GATE-COMPLETE — PR #1087 CI fully green → merged to **develop** (`8eb555c87`), then promoted
  **develop→main** via PR #1088 (`718e164f4`). Both hops independently confirmed by the merge-verifier (PASS/PASS):
  all B2 paths present on `origin/main`, `CVE-2024-29415` ignore retained, no unrelated drift (23 files), CI green
  incl. `security audit`. B2 shipped. Spec `active → done` (`status: done`). Next: REMOTE-001 Stage B3 (SPAKE2
  pairing + QR + DTLS-fingerprint binding — PAKE realization researched + recommended in the B3 spec), then B4
  (`/remote-control` + registry wiring; must also close the logged model-invocation submit side-channel from B1).
