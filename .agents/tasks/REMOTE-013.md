# REMOTE-013 — Stage E4: reconnection / session-resume

Spec: `.agents/spec-docs/active/REMOTE-013-stage-e4-reconnection-session-resume.md`

Parent: REMOTE-001 (Stage E). GATE-APPROVAL: proposal-reviewer ENDORSE (2 rounds — persistent bridge +
seed/counter rendezvous + host ceiling added in round 2). Binding note: counter advance = **resync-on-success**
(used-room-counter + 1), host registers `{counter, counter+1}`, client probes counter/counter+1.

## Tasks

- [x] T1 (TC-01): `agent-transport-protocol/src/resume-buffer.ts` — bounded ring `{seq,message}`; `append`→seq, `ackThrough(seq)`, `tailAfter(lastSeq)` → ordered slice or `buffer-overrun` marker; drop-oldest over bound. Unit test.
- [x] T2 (TC-03): `agent-remote-pairing/src/reconnect-rendezvous.ts` — `deriveReconnectSeed(sessionKey)` + `deriveReconnectRendezvous(seed, counter)` (isomorphic HKDF→base64url). Index + SPEC. Unit test (determinism/isomorphism, disjoint room space per seed).
- [x] T3 (TC-02): `agent-transport-protocol` — split `createWsHandler` (extract `subscribeSessionEvents` + client-message router); new `session-resume-bridge.ts` (`SessionResumeBridge`: subscribe once, monotonic seq continuous across detach/attach, ResumeBuffer, `attach(sink)`/`detach()`/`onClientMessage`/`dispose`); `resume`/`ack` `TClientMessage` variants + optional envelope `seq`. WS path stays on plain `createWsHandler`. Index + SPEC. Unit test: seq continuity across detach/attach + gap capture + WS-unchanged regression.
- [x] T4 (TC-04): `agent-transport-webrtc/webrtc-transport.ts` (+ `pairing-gate.ts` attach/detach seam) — channel/connection-state watcher; on paired drop `bridge.detach()`; new channel + E3 host reconnect → `bridge.attach` + serve resume; reconnect-window ceiling → `bridge.dispose()` + teardown. Tests.
- [x] T5 (TC-04/05): `agent-cli/remote-control` — persist `reconnectSeed`+`counter` in `trusted-device-store` record (from `IPairingResult.sessionKey` at first-pair accept); register at reconnect rendezvous `{counter, counter+1}`; advance counter resync-on-success on confirmed reconnect. Tests.
- [x] T6 (TC-05): `agent-web-ui` — persist `reconnectSeed`+`counter` in `IDeviceCredential`; `rtc-session-client.ts` auto-reconnect loop (bounded backoff): compute rendezvous(counter/counter+1), E3 device reconnect, `resume{lastSeq}`, idempotent apply by seq, `ack`, advance counter; `useWsSession` wiring. Tests.
- [x] T7 (TC-06): cross-package exactly-once-across-a-gap test (protocol bridge + simulated drop) incl. overrun→get-messages fallback.
- [x] T8 (TC-07): `pnpm typecheck` + affected package tests + `pnpm harness:scan` green; WS localhost path unchanged (no bridge/seq).
- [ ] T9 (GATE-COMPLETE): after feature→develop merge (merge-verifier) + batched Stage-E develop→main promotion, move spec active→done and archive this task.

## Test Plan / 검증

TDD, foundation-first: ResumeBuffer + rendezvous derivation (pure) → SessionResumeBridge (the Issue-A seq/gap
core) → transport reconnect watcher + host ceiling → client auto-reconnect loop + store fields. Authoritative =
per-package vitest (buffer append/ack/tail/overrun; seed/rendezvous determinism+disjoint; bridge seq-continuity
across detach/attach + gap capture + WS-unchanged; host drop→buffer→reconnect→replay + counter-resync + ceiling;
client reconnect loop + idempotent apply + backoff ceiling; exactly-once cross-package) + typecheck + harness:scan.
