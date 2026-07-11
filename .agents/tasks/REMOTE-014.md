# REMOTE-014 — Stage E5: co-drive concurrency + attribution

Spec: `.agents/spec-docs/active/REMOTE-014-stage-e5-co-drive-concurrency-attribution.md`

Parent: REMOTE-001 (Stage E — final sub-stage). GATE-APPROVAL: proposal-reviewer ENDORSE (2 rounds — hybrid
coalesce/FIFO + queue-aware read + wakeTaskId release + cancel attribution + AGENT_DRIVER_ID + selective
stamping added in round 2). Non-blocking note: gate turn-`error` stamping on a turn-scoped flag (background
`error` shares the event name) or accept the mid-turn edge with a comment.

## Tasks

- [ ] T1 (TC-02): `agent-interface-transport/src/session-contracts.ts` — `TDriverId` + `OWNER_DRIVER_ID='owner'` + `AGENT_DRIVER_ID='agent'`; optional `driverId` on the submit turn-options; `requesterDriverId` on `IPermissionRequestEvent`/`IAskRequestEvent`; `answererDriverId` on `IPromptResolvedEvent`; attribution field on turn-authored events; `getActiveDriverId()` + `getPendingQueue()`/pending-count on the contract.
- [ ] T2 (TC-01/06): `agent-framework` — `SessionExecutionController`: scalar pending slot → bounded `pendingQueue` with same-driver COALESCE (tail-replace) vs cross-driver APPEND; `drainPendingQueue` head-first; `maxQueueDepth` drop-newest + attributed notice; `clearPendingQueue` releases EVERY entry's `wakeTaskId`. `InteractiveSession`: thread `driverId` on submit; `getActiveDriverId()` (default OWNER for human, AGENT for `agent-wakeup`); whole-queue `abort`/`cancelQueue` + attributed `cancelled by <id>` notice. Unit tests.
- [ ] T3 (TC-04): `agent-framework/session-prompt-registry.ts` — `requestPermission`/`requestAsk` stamp `requesterDriverId = getActiveDriverId()`; `resolvePermission`/`resolveAsk` record `answererDriverId` (server-assigned) → `prompt_resolved`. Unit tests.
- [ ] T4 (TC-03/05): `agent-transport-protocol` — `ws-protocol.ts` attribution fields; `ws-handler.ts` `IWsHandlerOptions.driverId` (server id); `handleSessionControlMessage` injects it into submit/command/prompt-response (ignore client-sent); SELECTIVE event stamping (turn-authored only, via `getActiveDriverId()`); `SessionResumeBridge` threads driverId. Tests.
- [ ] T5 (TC-05): `agent-transport-webrtc` — bind E3 `deviceId` at `pairing-gate.ts` accept into the handler/bridge driverId. Tests.
- [ ] T6: `agent-transport-tui` — pass `OWNER_DRIVER_ID` at the TUI submit/executeCommand/resolvePermission/resolveAsk call sites; render pending queued count.
- [ ] T7: `agent-web-ui` — render message author + permission requester/answerer labels + pending queued count.
- [ ] T8: authorization invariant comment at policy sites (driverId never authorizes; OWNER PRINCIPLE); SPECs for changed packages + public-surface.
- [ ] T9 (TC-07): `pnpm typecheck` + affected package tests + `pnpm harness:scan` green; single-driver + WS-client regression.
- [ ] T10 (GATE-COMPLETE): after feature→develop merge (merge-verifier) + batched Stage-E develop→main promotion, move spec active→done and archive this task.

## Test Plan / 검증

TDD, contract-first: interface-transport types → framework session queue + attribution + prompt registry →
protocol server-injection + selective stamping → webrtc/tui/web-ui wiring. Authoritative = per-package vitest
(coalesce vs append + drop-newest; getActiveDriverId defaults; requester/answerer; server-injected id + client
ignored; selective stamping; wakeTaskId release + cancel notice; single-driver regression) + typecheck + harness:scan.
