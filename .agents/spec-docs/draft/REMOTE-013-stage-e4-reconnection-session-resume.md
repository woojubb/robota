---
status: draft
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

- `packages/agent-transport-protocol/` — add envelope **sequence + resume/ack** to the shared bridge: a
  monotonic `seq` stamped on every outbound `TServerMessage` at the single `send` choke point in
  `createWsHandler`, and new `TClientMessage` variants `resume` / `ack`; a reusable **`ResumeBuffer`** (bounded
  ring of un-acked messages: append+seq, drop-on-ack, replay-tail-on-resume). This is transport-neutral —
  both WS and WebRTC use `createWsHandler`.
- `packages/agent-remote-pairing/` — a **rotating rendezvous** derivation `deriveReconnectRendezvous(hostId, epoch)`
  (HKDF over `hostIdentityId` + epoch), so host and client independently compute the same fresh room per epoch.
- `packages/agent-transport-webrtc/` — `WebRtcTransport`: a channel/connection-state watcher; on a paired
  peer drop, wrap the `send` with the `ResumeBuffer` and (host side) re-arm signaling at the current rotating
  rendezvous to accept a returning peer, re-running the E3 host reconnect + replaying the buffer tail on
  `resume`.
- `packages/agent-cli/src/remote-control/` — host: register at BOTH the first-pair rendezvous (QR) and the
  rotating reconnect rendezvous (derived from its own `hostIdentityId`), keeping a reconnect presence.
- `packages/agent-web-ui/src/client/` — `rtc-session-client.ts`: an **auto-reconnect loop** (bounded backoff)
  that, on drop, looks up the E3 credential (`deviceCredentials.get(relayOrigin, hostIdentityId)`), computes
  the rotating rendezvous, reconnects via the E3 device reconnect path, and sends `resume{lastSeq}`; tracks
  `lastSeq` + sends `ack`.

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
3. **(Chosen) Rotating identity-derived rendezvous.** Both peers deterministically compute a **fresh** room
   per time epoch: `rendezvous(epoch) = base64url(HKDF(hostIdentityId, "robota-reconnect-rv/v1" ‖ epoch))`,
   `epoch = floor(now / WINDOW)`. On a drop the host re-registers at the current epoch's room and the returning
   client computes the same room from its pinned `hostIdentityId` and joins — a **fresh, single-use room each
   epoch** (single-use satisfied: two new peer ids per room) with the host present within the half-open TTL
   (`WINDOW < TTL`, e.g. 20s window vs 60s TTL, and the host re-registers each epoch). Pro: no relay change —
   respects content-blind single-use + half-open exactly; the rendezvous is unguessable without
   `hostIdentityId` (which only a paired device holds); mutual E3 auth still gates admission so the room being
   public-derivable is not a trust risk. Con: needs loose host/client clock agreement (mitigated by the client
   trying the current ± adjacent epoch) and a host that re-registers as epochs roll. Accepted: the only option
   that keeps the relay dumb and E2 intact.

### Decision

Take alternative 3 (rotating identity-derived rendezvous) for rediscovery, plus a transport-neutral
**sequence + resume/ack** contract and a bounded host **ResumeBuffer** for exactly-once replay. Reconnect
authentication REUSES the E3 mutual handshake unchanged (the returning peer is a trusted device; a
non-trusted peer fails the handshake and never resumes). The host session already survives a peer drop, so
E4 adds only: keep/re-arm the host's reconnect presence, buffer un-acked output, and let the client find its
way back and ask for the tail. This is a **contract-boundary change** (new envelope seq + two client message
variants + a new rendezvous derivation): validated for reachability by both peers (WS host ignores the new
fields harmlessly; WebRTC host + browser both speak the seq/ack), capability preservation (a client that
never drops behaves exactly as today — seq is stamped but only consulted on resume), and an adversarial pass
(a wrong-epoch or wrong-identity room yields no host / fails E3 auth; a forged `resume`/`ack` from a
non-trusted peer cannot arrive because resume runs only post-E3-accept; buffer bounded so a never-acking peer
cannot exhaust host memory — oldest frames drop with a gap marker).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the resume/ack + seq live in the SHARED `createWsHandler` (`ws-handler.ts`), so BOTH transports (WS sidecar + WebRTC) get the contract; the WS client is checked to ignore unknown fields (no break). The rotating rendezvous is host-side (`remote-control-controller.ts`) + client-side (`rtc-session-client.ts`) computed from the same primitive.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **Sequence + resume/ack (`agent-transport-protocol`):**
  - Add `seq: number` to the outbound envelope by wrapping the `send` in `createWsHandler` with a stamper
    (monotonic per session bridge). The 14 event→message mappings are untouched — only the choke point stamps.
  - New `TClientMessage` variants: `{ type:'resume'; lastSeq: number }` and `{ type:'ack'; seq: number }`.
    `handleClientMessage` routes them: `resume` → replay the buffer tail after `lastSeq`; `ack` → drop
    buffered frames ≤ `seq`.
  - `ResumeBuffer` (new module): a bounded ring (default N frames / M bytes) of un-acked `{seq, message}`;
    `append` returns the seq; `ackThrough(seq)`; `tailAfter(lastSeq)` returns the replay slice or a
    `buffer-overrun` signal when `lastSeq` is older than the oldest retained frame (client then does a full
    `get-messages` refresh — never a silent gap).
- **Rotating rendezvous (`agent-remote-pairing`):** `deriveReconnectRendezvous(hostIdentityId, epoch): Promise<string>`
  = base64url HKDF; `currentEpoch(nowMs, windowMs): number`. Pure, isomorphic (same primitive host + browser).
- **Host (`agent-transport-webrtc` + `agent-cli`):** on a paired channel drop (a new `channel`/`peer`
  connection-state watcher), the transport keeps the session, attaches the `ResumeBuffer` to `send`, and the
  controller re-arms a `WsSignalingClient` at `deriveReconnectRendezvous(hostIdentityId, currentEpoch())`,
  re-registering as epochs roll (a small timer), so a returning device can meet it. A new data channel runs
  the E3 host reconnect; on accept it replays `tailAfter(lastSeq)`.
- **Client (`agent-web-ui`):** on drop, if `deviceCredentials.get(relayOrigin, hostIdentityId)` has a
  credential, enter an auto-reconnect loop with bounded exponential backoff: compute the rotating rendezvous,
  connect, run the E3 device reconnect (verify host), then `send({type:'resume', lastSeq})`; apply replayed
  frames idempotently by `seq` and periodically `ack`. On `buffer-overrun`, fall back to `get-messages`.
- **Bounds/fail-safe:** the ResumeBuffer is bounded (drop-oldest with an overrun signal — never unbounded);
  the reconnect loop has a max-attempts/backoff ceiling then surfaces `failed`; the epoch window `< TTL`.

## Affected Files

- `packages/agent-transport-protocol/src/ws-protocol.ts`
- `packages/agent-transport-protocol/src/ws-handler.ts`
- `packages/agent-transport-protocol/src/resume-buffer.ts` (new)
- `packages/agent-transport-protocol/src/index.ts`
- `packages/agent-transport-protocol/docs/SPEC.md`
- `packages/agent-remote-pairing/src/reconnect-rendezvous.ts` (new)
- `packages/agent-remote-pairing/src/index.ts`
- `packages/agent-transport-webrtc/src/webrtc-transport.ts`
- `packages/agent-cli/src/remote-control/remote-control-controller.ts`
- `packages/agent-web-ui/src/client/rtc-session-client.ts`
- `packages/agent-web-ui/src/hooks/useWsSession.ts`
- Tests in each package.

## Completion Criteria

- [ ] TC-01: `ResumeBuffer` — `append` returns a monotonic seq; `ackThrough(seq)` drops ≤ seq; `tailAfter(lastSeq)`
      returns the frames after `lastSeq` in order; when `lastSeq` predates the oldest retained frame it returns a
      `buffer-overrun` marker (never a silent gap); the buffer never exceeds its frame/byte bound (drop-oldest).
- [ ] TC-02: `createWsHandler` stamps a monotonic `seq` on every outbound `TServerMessage`; a `resume{lastSeq}`
      client message replays exactly the tail after `lastSeq` (no dup, no loss); an `ack{seq}` frees buffer ≤ seq.
      A client that never sends resume/ack behaves exactly as today (regression).
- [ ] TC-03: `deriveReconnectRendezvous(hostIdentityId, epoch)` is deterministic + isomorphic (host == browser
      for the same inputs), differs per epoch and per hostIdentityId, and is base64url; `currentEpoch` bins by window.
- [ ] TC-04: Host transport — on a paired channel drop the session is NOT torn down; the `send` is buffered; a
      NEW data channel that passes the E3 host reconnect resumes and receives the replayed tail after its `lastSeq`.
- [ ] TC-05: Client — on drop with a stored E3 credential, the auto-reconnect loop computes the rotating
      rendezvous, reconnects via the E3 device reconnect (host verified), sends `resume{lastSeq}`, and applies the
      replayed frames idempotently (dedup by seq); backoff is bounded and surfaces `failed` after the ceiling.
- [ ] TC-06: Exactly-once across a gap — output produced while the channel is down is delivered exactly once
      after resume (no dup, no loss); a `buffer-overrun` triggers a `get-messages` refresh instead of a silent gap.
- [ ] TC-07: `pnpm harness:scan` + `pnpm typecheck` + affected package tests green; the WS client ignores the new
      `seq` field (no break to the localhost path).

## Test Plan

| TC-ID | Test Type               | Tool / Approach                                                                                                 | Notes                                   |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| TC-01 | Unit                    | vitest — ResumeBuffer append/ack/tail/overrun + bound enforcement                                               | Pure data structure                     |
| TC-02 | Unit (handler)          | vitest — extend ws-handler.test.ts: seq stamping + resume replay + ack drop + no-resume regression              | Shared bridge (WS + WebRTC)             |
| TC-03 | Unit (crypto)           | vitest — rendezvous determinism/isomorphism + per-epoch/per-id variance                                         | Isomorphic WebCrypto HKDF               |
| TC-04 | Integration (transport) | vitest — fake channel drop + new channel + E3 host reconnect → replay tail                                      | Extends webrtc-transport / pairing-gate |
| TC-05 | Integration (client)    | vitest — injected drop; assert reconnect loop computes rendezvous + resume + idempotent apply + backoff ceiling | Extends rtc-session-client.test.ts      |
| TC-06 | Integration             | vitest — end-to-end seq/resume across a simulated gap: exactly-once + overrun→get-messages fallback             | Cross-package (protocol + client)       |
| TC-07 | CI smoke                | `pnpm harness:scan` exit 0 + `pnpm typecheck` + affected suites; WS-client-ignores-seq assertion                | Regression + scans                      |

## Tasks

- [ ] `.agents/tasks/REMOTE-013.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
