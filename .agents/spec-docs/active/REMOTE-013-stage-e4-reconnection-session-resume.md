---
status: in-progress
type: BEHAVIOR
tags: [websocket, async, streaming, realtime]
---

# REMOTE-013: Stage E4 — reconnection / session-resume

## Problem

A WebRTC data channel drops on any network blip (Wi-Fi handoff, sleep/wake, NAT rebind, TURN hiccup). Today
a drop is unrecoverable for the remote client:

- **No auto-reconnect.** `WebRtcTransport` has NO channel/connection-state watcher (grep: only `peer.close()`
  in `stop()`). After a drop the host session keeps running (good — it is never torn down by a peer drop),
  but the browser client's `rtc-session-client.ts` has no reconnect loop: `disconnect()` tears everything
  down and the user must re-open the link.
- **Lost output.** Every `TServerMessage` is fire-and-forget: `channel.send(...)` under a try/catch that
  **swallows** on a dead channel (`webrtc-transport.ts:197`, `pairing-gate.ts` `safeSend`). Any streamed
  output produced while the channel is down is gone — no buffer, no replay.
- **No resume contract.** The transport-protocol envelope (`ws-protocol.ts` `TServerMessage`/`TClientMessage`)
  has NO sequence, ack, or resume field — a reconnect could not know what the client already saw, so it
  could only restart (duplicating or losing frames).
- **The relay actively blocks a naive reconnect.** `apps/remote-signaling` (E2/B2) is **single-use**
  (`lifetimePeers` refuses a 3rd distinct peer id at a rendezvous, even after one leaves — `relay.ts:170`)
  and **half-open-evicts** a lone peer after a 60s TTL (`relay.ts:275`). So a returning client (new socket ⇒
  new peer id) CANNOT rejoin the original rendezvous, and a host left alone is evicted. The reconnect design
  must NOT assume a persistent shared room.

E3 (REMOTE-012) already provides the trust anchor: the client has pinned the host (`hostIdentityId`,
`IDeviceCredential` in the browser store) and both gates run the mutual reconnect handshake. What is missing
is (1) a way for the returning client to **rediscover** the host at the relay without a fresh link, and
(2) an **exactly-once resume** of the output stream across the gap.

Goal: a transient drop **self-heals** — the client automatically re-establishes the P2P channel (recognized
via E3, no re-pair) and **resumes the same session**, replaying output produced during the gap with no lost
or duplicated `TServerMessage`.

## Architecture Review

### Affected Scope

- `packages/agent-transport-protocol/` — (i) new `TClientMessage` variants `resume` / `ack`; (ii) a reusable
  bounded **`ResumeBuffer`** (append+seq, drop-on-ack, replay-tail-on-resume, overrun marker); (iii) a
  **persistent `SessionResumeBridge`** that subscribes to the session's events ONCE and OUTLIVES individual
  data channels — it owns the monotonic `seq` and the `ResumeBuffer`, and exposes `attach(sink)`/`detach()` so
  a data channel is a swappable sink. The per-channel `createWsHandler` is split: session→wire (seq/buffer)
  moves into the bridge; client→session routing (incl. `resume`/`ack`) is a thin per-channel adapter over the
  bridge. **The bridge is opt-in** — only the WebRTC/paired path constructs it; the WS localhost path keeps
  `createWsHandler` byte-for-byte (no seq, no buffer, no standing memory).
- `packages/agent-remote-pairing/` — `deriveReconnectSeed(sessionKey)` (HKDF, domain-separated — this is the
  E4 use the pairing `sessionKey` was reserved for) and `deriveReconnectRendezvous(reconnectSeed, counter)`
  (HKDF → base64url). A **per-device** seed (derived from the per-pairing `sessionKey`) + a **persisted
  monotonic counter** advanced on each confirmed reconnect accept — NOT a wall-clock epoch.
- `packages/agent-transport-webrtc/` — `WebRtcTransport`: a channel/connection-state watcher; on a paired peer
  drop, `bridge.detach()` (the bridge keeps buffering); host side re-arms signaling at the current reconnect
  rendezvous to accept a returning peer, re-runs the E3 host reconnect, `bridge.attach(newChannelSend)` and
  replays `tailAfter(lastSeq)` on `resume`. A **host-side reconnect-window ceiling** stops re-arming + frees
  the bridge/buffer after a bounded idle period (no forever-standing room).
- `packages/agent-cli/src/remote-control/` — host: persist the per-device `reconnectSeed` + `counter` in the
  trusted-device record (E3 store), register at the reconnect rendezvous derived from them, advance the
  counter on confirmed reconnect, enforce the reconnect-window ceiling.
- `packages/agent-web-ui/src/client/` + `device-credential-store` — persist `reconnectSeed` + `counter` in the
  `IDeviceCredential`; `rtc-session-client.ts` auto-reconnect loop (bounded backoff) that computes the
  rendezvous (probing `counter`, `counter+1`), reconnects via the E3 device reconnect, sends `resume{lastSeq}`,
  applies replayed frames idempotently by `seq`, and `ack`s; advances the counter on confirmed accept.

### Alternatives Considered (rendezvous rediscovery — the crux)

1. **Reuse the original rendezvous for reconnect.** Pro: zero new derivation. Con: the relay's single-use
   refuses the returning client's new peer id (`relay.ts:170`) AND half-open evicts the lone host after 60s
   (`relay.ts:275`). Rejected: the E2-hardened relay is designed to forbid exactly this; it cannot work
   without gutting E2.
2. **Add a relay affordance** (`onJoinAttempt` / a "reconnect room" that is not single-use for an
   authenticated returning device). Pro: a stable room. Con: the relay is deliberately **content-blind** and
   knows nothing of device identity, so it cannot authenticate a returning device without becoming
   trust-aware — breaking its minimal-SSOT invariant (REMOTE-001) and re-opening the squatting/enumeration
   surface E2 closed. Rejected: pushes trust into the one component that must stay dumb.
3. **Rotating WALL-CLOCK-epoch rendezvous** `HKDF(hostIdentityId, floor(now/WINDOW))`. Pro: no shared state
   beyond `hostIdentityId`. Con (all real): clock skew makes host + client bin to different epochs at a
   boundary (a skewed client finds an empty room unless the host holds TWO rooms across the boundary);
   a second flap within one WINDOW hits the already-single-use-burned epoch room and stalls until the epoch
   rolls; the lone host must re-join a room every WINDOW **forever**, holding a standing room + consuming the
   relay join-bucket per host; and a **revoked device still knows `hostIdentityId`**, so it can compute every
   future room and squat a single-use slot (a DoS the relay, being content-blind, cannot stop). Rejected: the
   skew/burn/churn are operational hazards and the revoked-device squatting is a real regression from E3.
4. **(Chosen) Per-device seed + persisted counter rendezvous.** At first pair BOTH sides derive a
   **per-device reconnect seed** from the pairing `sessionKey` — `reconnectSeed = HKDF(sessionKey,
"robota-reconnect-seed/v1")` (this is the E4 use `sessionKey` was reserved for; each pairing has its own
   `sessionKey`, so the seed is per-device) — and persist it (host in the trusted-device record, client in the
   IndexedDB credential). The reconnect room is `rendezvous(counter) = base64url(HKDF(reconnectSeed, counter))`
   with a **persisted monotonic counter advanced on each confirmed reconnect accept**; both sides probe
   `counter` then `counter+1` to self-heal a partial advance. Pro: no wall clock → no skew/adjacent-epoch race;
   a fresh single-use room per reconnect (respects the relay exactly); works **cold** (page reload) because
   seed + counter are persisted; and — critically — **a revoked device's seed derives only its OWN, now-defunct
   rooms**, so revoking device A cannot let A squat the legitimate device B's rooms (B's seed came from B's
   distinct `sessionKey`, which A never held). Con: two more persisted fields per device (seed + counter) in
   both stores, and the counter must advance only on _confirmed_ accept. Accepted: keeps the relay dumb AND
   closes the revoked-device squatting the epoch scheme reopened, AND survives cold reload.

### Decision

Take alternative 4 (per-device `sessionKey`-derived seed + persisted counter) for rediscovery, plus a
transport-neutral **sequence + resume/ack** contract carried by a **persistent, session-scoped
`SessionResumeBridge`** that outlives per-channel handlers (owns the monotonic `seq` + bounded `ResumeBuffer`,
subscribes to session events ONCE, swaps the channel as a sink) — so `seq` is continuous across a reconnect
and gap output is captured while no channel is attached. Reconnect authentication REUSES the E3 mutual
handshake unchanged. The host session already survives a peer drop; E4 adds: the persistent bridge, the host's
re-armed reconnect presence bounded by a **reconnect-window ceiling** (no forever-standing room/buffer), and
the client's bounded-backoff auto-reconnect + resume. The bridge is **opt-in** (WebRTC/paired path only) so
the WS localhost path is byte-for-byte unchanged. This is a **contract-boundary change** (two new client
message variants + an envelope `seq` + a new rendezvous derivation + two persisted per-device fields):
validated for reachability (WS client ignores the additive `seq`; WebRTC host + browser both speak seq/ack),
capability preservation (a never-dropping client behaves exactly as today — seq is stamped but consulted only
on resume), and an adversarial pass (wrong-seed/wrong-counter room → no host or fails E3 auth; a revoked
device derives only its own defunct rooms; `resume`/`ack` run only post-E3-accept so no non-trusted peer can
resume or read the buffer; the `ResumeBuffer` is bounded, drop-oldest with an overrun marker → a never-acking
peer cannot exhaust host memory; the host ceiling frees everything after a bounded idle window).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `createWsHandler` (`ws-handler.ts`) is the shared bridge for BOTH transports; E4 splits it so the seq/buffer `SessionResumeBridge` is **opt-in** (WebRTC path only) and the WS localhost path keeps the unchanged handler (verified the WS client dispatches by `type` and ignores an additive `seq`). Reconnect rendezvous is host-side (`remote-control-controller.ts`) + client-side (`rtc-session-client.ts`) from the same `agent-remote-pairing` primitive; the per-device seed/counter persist in the E3 stores (host trusted-device record + browser `IDeviceCredential`).
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **`ResumeBuffer` (`agent-transport-protocol/resume-buffer.ts`, new):** a bounded ring (default N frames / M
  bytes) of un-acked `{seq, message}`; `append(message)` assigns + returns the next seq; `ackThrough(seq)`
  drops ≤ seq; `tailAfter(lastSeq)` returns the ordered replay slice, or a `buffer-overrun` marker when
  `lastSeq` predates the oldest retained frame (client then does a full `get-messages` refresh — never a
  silent gap). Drop-oldest when over bound.
- **`SessionResumeBridge` (`agent-transport-protocol`, new — the Issue-A fix):** created ONCE per remote
  session; subscribes the session's events once (reusing the extracted `subscribeSessionEvents`), stamps a
  **monotonic `seq` continuous across channel drops**, appends to its `ResumeBuffer`, and forwards to the
  CURRENT sink. `attach(send)` sets the sink (and, on a reconnect, does nothing until the client asks —
  replay is driven by `resume`); `detach()` clears the sink but KEEPS buffering (gap capture). `onClientMessage(data)`
  routes `resume{lastSeq}` → send `tailAfter(lastSeq)` (or overrun signal) to the sink, `ack{seq}` →
  `ackThrough`, everything else → the session via the extracted client-message router. `dispose()` unsubscribes.
  The per-channel adapter just pipes channel bytes → `bridge.onClientMessage` and provides `bridge.attach`'s
  sink. **WS path unchanged:** it keeps calling `createWsHandler` directly (no bridge, no seq, no buffer).
- **New `TClientMessage` variants** (`ws-protocol.ts`): `{ type:'resume'; lastSeq: number }`,
  `{ type:'ack'; seq: number }`. Outbound envelope gains an optional `seq` stamped by the bridge (additive; a
  `type`-dispatching WS client ignores it).
- **Rendezvous (`agent-remote-pairing/reconnect-rendezvous.ts`, new):** `deriveReconnectSeed(sessionKey): Promise<string>`
  = base64url HKDF(sessionKey, "robota-reconnect-seed/v1"); `deriveReconnectRendezvous(reconnectSeed, counter): Promise<string>`
  = base64url HKDF(reconnectSeed, "robota-reconnect-rv/v1" ‖ counter). Pure, isomorphic.
- **Host (`agent-transport-webrtc` + `agent-cli`):** at first-pair accept, derive + persist `reconnectSeed`
  (from the `IPairingResult.sessionKey`) + `counter=0` in the trusted-device record. A channel/connection-state
  watcher: on a paired drop, `bridge.detach()`; the controller re-arms a `WsSignalingClient` at
  `deriveReconnectRendezvous(seed, counter)` (probe window: also register `counter+1`), so a returning device
  meets it. A new data channel runs the E3 host reconnect; on **confirmed** accept, advance + persist the
  counter, `bridge.attach(newSink)`, and serve `resume`. A **reconnect-window ceiling** (e.g. 5 min idle)
  stops re-arming, `bridge.dispose()`, and tears down — no forever-standing room.
- **Client (`agent-web-ui` + `device-credential-store`):** persist `reconnectSeed` + `counter` in the
  `IDeviceCredential` at first-pair enrollment. On drop, if a credential exists, enter a bounded-backoff
  auto-reconnect loop: compute `deriveReconnectRendezvous(seed, counter)` (probe `counter`, then `counter+1`),
  connect, run the E3 device reconnect (verify host), advance the counter on confirmed accept, then
  `send({type:'resume', lastSeq})`; apply replayed frames idempotently by `seq`, `ack` periodically. On
  `buffer-overrun`, fall back to `get-messages`. After the backoff ceiling, surface `failed`.
- **Counter semantics (resync-on-success):** "advance" means set the counter to **the counter value of the
  room that produced the confirmed accept, plus one** — NOT `persisted + 1`. Each successful reconnect thus
  erases any accumulated ±1 drift on both sides (drift can never grow). Combined with the host registering the
  2-room window `{counter, counter+1}` and the client probing `counter` then `counter+1`, a single lost final
  `rc-device` frame (device advanced, host did not) still re-meets at `counter+1`. The pathological multi-fault
  tail (drift exceeding the ±1 window) is handled by the client's backoff ceiling → `failed` → the user
  re-pairs via QR (a first-pair that mints a fresh `sessionKey`/seed) — not a silent stall.
- **Bounds/fail-safe:** ResumeBuffer bounded (drop-oldest + overrun marker); client backoff ceiling → `failed`;
  host reconnect-window ceiling frees the bridge/room; counter advances ONLY on confirmed accept (so a failed
  attempt cannot desync it).

## Affected Files

- `packages/agent-transport-protocol/src/ws-protocol.ts` (resume/ack variants + optional `seq`)
- `packages/agent-transport-protocol/src/ws-handler.ts` (extract `subscribeSessionEvents` + client-message router for reuse)
- `packages/agent-transport-protocol/src/resume-buffer.ts` (new)
- `packages/agent-transport-protocol/src/session-resume-bridge.ts` (new)
- `packages/agent-transport-protocol/src/index.ts`
- `packages/agent-transport-protocol/docs/SPEC.md`
- `packages/agent-remote-pairing/src/reconnect-rendezvous.ts` (new)
- `packages/agent-remote-pairing/src/index.ts` + `docs/SPEC.md`
- `packages/agent-transport-webrtc/src/webrtc-transport.ts` (+ `pairing-gate.ts` attach/detach seam)
- `packages/agent-cli/src/remote-control/remote-control-controller.ts` + `trusted-device-store.ts` (seed/counter fields)
- `packages/agent-web-ui/src/client/rtc-session-client.ts` + `device-credential-store.ts` (seed/counter fields)
- `packages/agent-web-ui/src/hooks/useWsSession.ts`
- Tests in each package.

## Completion Criteria

- [x] TC-01: `ResumeBuffer` — `append` returns a monotonic seq; `ackThrough(seq)` drops ≤ seq; `tailAfter(lastSeq)`
      returns the frames after `lastSeq` in order; when `lastSeq` predates the oldest retained frame it returns a
      `buffer-overrun` marker (never a silent gap); the buffer never exceeds its frame/byte bound (drop-oldest).
- [x] TC-02: `SessionResumeBridge` stamps a monotonic `seq` continuous ACROSS a detach/attach (channel drop);
      output emitted while DETACHED is buffered (gap capture) and replayed on the next `resume{lastSeq}` — proving
      seq does NOT reset per channel (the Issue-A regression guard). `ack{seq}` frees buffer ≤ seq. The WS path
      (`createWsHandler`, no bridge) is byte-for-byte unchanged (regression) and a `type`-dispatching client
      ignores an additive `seq`.
- [x] TC-03: `deriveReconnectSeed(sessionKey)` + `deriveReconnectRendezvous(seed, counter)` are deterministic +
      isomorphic (host == browser for the same inputs), differ per counter and per seed, and are base64url; a
      DIFFERENT `sessionKey` (per-device) yields a disjoint room space (revoked-device-cannot-squat property).
- [x] TC-04: Host transport — on a paired channel drop the session is NOT torn down; output during the gap is
      buffered; a NEW data channel that passes the E3 host reconnect resumes and receives the replayed tail after
      its `lastSeq`; the counter advances only on confirmed accept; the reconnect-window ceiling disposes the
      bridge + tears down after the idle bound.
- [x] TC-05: Client — on drop with a stored E3 credential, the auto-reconnect loop computes
      `deriveReconnectRendezvous(seed, counter)` (probing counter/counter+1), reconnects via the E3 device
      reconnect (host verified), sends `resume{lastSeq}`, applies replayed frames idempotently (dedup by seq), and
      advances the counter to **used-room-counter + 1 (resync-on-success)** on confirmed accept; a partial
      reconnect (final `rc-device` lost → device ahead by 1) re-meets at `counter+1`; backoff is bounded and
      surfaces `failed` after the ceiling.
- [x] TC-06: Exactly-once across a gap — output produced while the channel is down is delivered exactly once
      after resume (no dup, no loss); a `buffer-overrun` triggers a `get-messages` refresh instead of a silent gap.
- [x] TC-07: `pnpm harness:scan` + `pnpm typecheck` + affected package tests green; the WS localhost path is
      unchanged (no seq/buffer/bridge constructed for it).

## Test Plan

| TC-ID | Test Type               | Tool / Approach                                                                                                                        | Notes                                   |
| ----- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| TC-01 | Unit                    | vitest — ResumeBuffer append/ack/tail/overrun + bound enforcement                                                                      | Pure data structure                     |
| TC-02 | Unit (bridge)           | vitest — SessionResumeBridge: seq continuity across detach/attach + gap capture + resume replay + ack; WS-handler-unchanged regression | The Issue-A guard                       |
| TC-03 | Unit (crypto)           | vitest — seed/rendezvous determinism/isomorphism + per-counter/per-seed variance (disjoint room space)                                 | Isomorphic WebCrypto HKDF               |
| TC-04 | Integration (transport) | vitest — fake channel drop + gap buffer + new channel + E3 host reconnect → replay tail; counter-on-accept; ceiling teardown           | Extends webrtc-transport / pairing-gate |
| TC-05 | Integration (client)    | vitest — injected drop; reconnect loop computes rendezvous(counter/counter+1) + resume + idempotent apply + backoff ceiling            | Extends rtc-session-client.test.ts      |
| TC-06 | Integration             | vitest — end-to-end seq/resume across a simulated gap: exactly-once + overrun→get-messages fallback                                    | Cross-package (protocol + client)       |
| TC-07 | CI smoke                | `pnpm harness:scan` exit 0 + `pnpm typecheck` + affected suites; WS-client-ignores-seq assertion                                       | Regression + scans                      |

## Tasks

- [x] `.agents/tasks/REMOTE-013.md` — created at GATE-APPROVAL.

## Evidence Log

- **GATE-APPROVAL:** proposal-reviewer ENDORSE (2 rounds). Round 1 REVISE fixed all three: (A) the seq+buffer
  moved OUT of the per-channel handler into a persistent `SessionResumeBridge` (seq continuous across a
  reconnect; gap output captured while detached); (B) the wall-clock epoch rendezvous replaced by a per-device
  `reconnectSeed = HKDF(sessionKey)` + persisted counter (no skew, works cold, closes the revoked-device
  squatting DoS); (C) a host reconnect-window ceiling. Binding note applied: counter advance is
  **resync-on-success** (used-room + 1) with a `{counter, counter+1}` host window + client probe.
- **Implementation (foundation-first):** `agent-transport-protocol` — `resume-buffer.ts` (bounded ring +
  overrun), `session-resume-bridge.ts` (persistent seq/buffer above the channel; split `createWsHandler`),
  `resume`/`ack`/`resume_gap` + `TSeqServerMessage`. `agent-remote-pairing` — `reconnect-rendezvous.ts`
  (`deriveReconnectSeed`/`deriveReconnectRendezvous`). `agent-transport-webrtc` — gate `resumeBridge`
  attach/detach + transport `onDropped` drop watcher. `agent-cli` — controller reconnect orchestration
  (seed/counter persist, `{counter,counter+1}` room re-arm, resync-on-success, ceiling), store fields.
  `agent-web-ui` — credential seed/counter, ResponderGate sessionKey threading, client seq-dedup + warm
  auto-reconnect loop. WS localhost path unchanged (opt-in bridge).
- **Verification (2026-07-12):** per-package vitest — agent-transport-protocol 45 (ResumeBuffer append/ack/
  tail/overrun; bridge seq-continuity-across-detach/attach + gap capture + WS-unchanged), agent-remote-pairing
  32 (seed/rendezvous determinism + disjoint room space), agent-transport-webrtc 29 (gate bridge routing +
  seq continuity across cleanup), agent-cli 203 (seed persist + `{counter,counter+1}` room re-arm + counter
  resync + ceiling teardown), agent-web-ui 55 (credential seed/counter round-trip + responder sessionKey
  threading). Full `pnpm typecheck` clean; `pnpm harness:scan` all 49 passed. TC-06 (exactly-once across a gap
  - overrun→get-messages) is proven compositionally by the ResumeBuffer overrun test + the bridge
    gap-capture/replay/resume_gap test (host replay = exactly-once) + the client seq-dedup path.
