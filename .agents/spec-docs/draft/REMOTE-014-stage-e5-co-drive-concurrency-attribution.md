---
status: draft
type: BEHAVIOR
tags: [websocket, async, realtime]
---

# REMOTE-014: Stage E5 — co-drive concurrency + attribution

## Problem

The local host TUI and a paired remote peer share the SAME live `IInteractiveSession` (mirror + co-drive —
both send input). Two concrete defects today:

1. **Silent input clobber (no real arbitration).** The session does NOT queue concurrent input — it has a
   SINGLE last-write-wins pending slot. `InteractiveSession.submit`
   (`packages/agent-framework/src/interactive/interactive-session.ts:376-406`): while a turn is executing it
   **overwrites** `pendingPrompt`/`pendingDisplayInput`/`pendingRawInput`/`pendingTurnOptions` and returns;
   `SessionExecutionController` (`interactive-session-execution-controller.ts:74-77`) holds one scalar slot,
   and `drainPendingQueue` (`:177-186`) resubmits that one prompt after the turn. So if driver A submits a
   prompt during driver B's turn and then driver B submits, **A's queued prompt is silently discarded**.
   (`executeCommand` is stricter — it rejects while executing.)
2. **No attribution.** There is no per-driver identity anywhere. The only turn-origin concept is
   `TTurnSource = 'user' | 'agent-wakeup'` (`session-contracts.ts:175`) — human-vs-wakeup, NOT which driver.
   Emitted events (`user_message`, `text_delta`, `tool_start`, `complete`, …) and permission/ask prompts
   (`IPermissionRequestEvent`/`IAskRequestEvent`) carry no "who did this", so on a shared session neither
   surface can show authorship, and a permission prompt cannot name the driver whose action triggered it —
   the approver is asked to authorize an action with no visible origin.

Goal: a defined co-drive concurrency model (concurrent input is **serialized deterministically, never
clobbered**) with **per-driver attribution** — every input, the events it produces, and the permission/ask
prompts it triggers carry a driver id that both surfaces render; permission prompts name the requesting
driver and record the answering driver. Per the OWNER PRINCIPLE (REMOTE-006, local == remote in privilege),
the driver id is for attribution/display — NOT authorization (a remote driver is already subject to the same
policy). The driver id is **server-assigned, never client-trusted** (a peer cannot forge another's identity).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/interactive/` — replace the single pending slot with a **bounded ordered
  attributed queue** (`SessionExecutionController` + `InteractiveSession.submit` executing-branch +
  `drainPendingQueue`); carry `driverId` on the turn via `ITurnOptions`; track the ACTIVE turn's driver so
  events + prompts can be tagged; `SessionPromptRegistry.requestPermission/requestAsk` stamp the active
  driver as `requesterDriverId`; `resolvePermission/resolveAsk` record the answering driver.
- `packages/agent-interface-transport/src/session-contracts.ts` — `submit`/`executeCommand` optional
  `driverId` (via an options arg / `ITurnOptions`); `IPermissionRequestEvent`/`IAskRequestEvent` gain
  `requesterDriverId`; `IPromptResolvedEvent` gains `answererDriverId`; event attribution field.
- `packages/agent-transport-protocol/` — `TServerMessage` attribution (a `driverId` on the events that carry
  it, or intersected at the `subscribeSessionEvents` bridge, mirroring E4's `TSeqServerMessage`); inbound
  `permission-response`/`ask-response` carry the answerer's driver id; `handleSessionControlMessage` injects
  the **server-known** remote driver id (from `IWsHandlerOptions`/`SessionResumeBridge`) into
  `submit`/`executeCommand` — it does NOT trust a client-sent id.
- `packages/agent-transport-webrtc/` — bind the E3 `deviceId` (known at `pairing-gate.ts` accept) as the
  remote driver id into the handler/bridge.
- `packages/agent-transport-tui/` — pass a fixed local/owner driver id at the TUI's direct `submit`/
  `executeCommand`/`resolvePermission`/`resolveAsk` call sites.
- `packages/agent-web-ui/` — render the requester/answerer driver on prompts + authorship on messages.
- Tests across the framework + protocol + web-ui.

### Alternatives Considered (the arbitration model)

1. **Single-writer token — reject/park the second driver.** While a turn (or a driver's parked prompt) is
   pending, a second driver's submit is rejected with a "another driver is active" notice. Pro: simplest;
   bounds to one queued prompt. Con: it DROPS the second driver's input (they must resubmit) — poor co-drive
   UX, and it privileges whoever submitted first (a race), which the OWNER PRINCIPLE (equal drivers) argues
   against. Rejected: turns a silent clobber into a loud drop, not into "both land".
2. **Unbounded FIFO queue.** Every submit is appended; drained in order. Pro: never drops input. Con: a
   flooding driver (or a runaway wakeup loop) grows the queue without bound — a memory/runaway hazard on
   a long-lived session. Rejected as-is (needs a bound).
3. **(Chosen) Bounded ordered attributed FIFO queue.** Replace the single pending slot with a FIFO of
   `{input, displayInput, rawInput, options, driverId}`, drained in submission order after each turn, bounded
   by a max depth (drop-newest with an attributed notice when full — never silently). Pro: deterministic
   serialization (no interleave — a turn is one prompt, atomic), no silent clobber, fair (submission order,
   driver-agnostic), attribution rides on each entry, and the bound prevents a runaway. Con: a small amount
   of new queue state + a full-queue policy. Accepted: the only option that serializes fairly AND preserves
   both drivers' input AND stays bounded.

### Decision

Take alternative 3 — a **bounded ordered attributed FIFO** at the one choke point every driver funnels
through (`InteractiveSession.submit`), so arbitration covers local TUI, remote WS/WebRTC, wakeups, and the
goal loop with no transport-layer arbitration. Attribution is a **server-assigned `driverId`** carried on the
turn (`ITurnOptions`), stamped onto the turn's emitted events and the permission/ask prompts it triggers
(requester), with the answering driver recorded on resolve. The remote driver id is the E3 `deviceId` bound
at pairing accept (server-known — a client cannot forge it); the local TUI is a fixed owner id. This is a
**contract-boundary change** (session `submit` signature + event/prompt attribution fields + protocol
framing): validated for reachability (every current `submit` caller keeps working — `driverId` is optional,
defaulting to the owner id; the WS client ignores an additive attribution field), capability preservation
(single-driver behavior is unchanged — one driver's inputs still serialize exactly as today, just through a
1-deep queue), and an adversarial pass (a client-supplied driver id is ignored in favor of the server-known
id; the queue bound stops a flooding driver; attribution is display-only so a spoof cannot escalate
privilege; the OWNER PRINCIPLE keeps remote == local for authorization).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — arbitration lives at the SINGLE `InteractiveSession.submit` choke point (every driver — local TUI, remote handler, wakeups, goal loop — funnels through it, verified by the surface map), so no per-transport arbitration is needed; attribution rides the same `ITurnOptions` the wakeup source already uses. Permission/ask attribution is added at the one `SessionPromptRegistry` that mints every prompt.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **Ordered attributed queue (`agent-framework`):** in `SessionExecutionController`, replace the scalar
  `pendingPrompt`/`pendingDisplayInput`/`pendingRawInput`/`pendingTurnOptions` with a bounded FIFO
  `pendingQueue: IQueuedInput[]` (`{ input, displayInput?, rawInput?, options?, driverId }`). `InteractiveSession.submit`
  executing-branch **enqueues** (append) instead of overwriting; `drainPendingQueue` **dequeues** the head and
  resubmits it (preserving order). A `maxQueueDepth` (default e.g. 32) drops-newest with a driver-attributed
  system notice when full (never silent). Single-driver behavior is a 1-deep queue = today's behavior.
- **Driver id on the turn:** add `driverId` to `ITurnOptions` (already the turn-metadata struct carrying
  `turnSource`/`wakeTaskId`). `submit(input, displayInput?, rawInput?, options?)` threads it; the session
  captures the ACTIVE turn's `driverId` (like `turnSource` today) so events/prompts can read it. Default =
  the owner/local id when unspecified.
- **Event attribution (`agent-transport-protocol`):** stamp the active turn's `driverId` onto the outbound
  events at the `subscribeSessionEvents` bridge (mirroring E4's `seq` stamping via `TSeqServerMessage`) — a
  `driverId` on the wire that both surfaces render as authorship. The local surface reads it from the session
  directly.
- **Permission/ask attribution (`agent-framework` + protocol):** `SessionPromptRegistry.requestPermission/requestAsk`
  stamp `requesterDriverId = active turn's driver` on `IPermissionRequestEvent`/`IAskRequestEvent`. The
  answering driver rides on the inbound `permission-response`/`ask-response` (server-injected id, not
  client-trusted) and is recorded in `settle` → surfaced as `answererDriverId` on `IPromptResolvedEvent`. Both
  surfaces render "requested by X / answered by Y".
- **Driver-id source (`agent-transport-webrtc` + `agent-transport-tui`):** remote = the E3 `deviceId` bound at
  `pairing-gate.ts` accept, threaded into `createWsHandler`/`SessionResumeBridge` (server-known); local = a
  fixed constant (e.g. `'owner'`) at the TUI's direct call sites. `handleSessionControlMessage` uses the
  handler's bound remote id, ignoring any client-sent id.
- **Render (`agent-web-ui`):** show the message author + the permission requester/answerer driver labels.

## Affected Files

- `packages/agent-interface-transport/src/session-contracts.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`
- `packages/agent-framework/src/interactive/session-prompt-registry.ts`
- `packages/agent-transport-protocol/src/ws-protocol.ts` + `ws-handler.ts` + `session-resume-bridge.ts`
- `packages/agent-transport-webrtc/src/pairing-gate.ts` + `webrtc-transport.ts`
- `packages/agent-transport-tui/src/TuiInteractionChannel.ts` (+ `hooks/useSlashRouting.ts`)
- `packages/agent-web-ui/src/` (prompt + message attribution render)
- SPECs for the changed packages; tests in each.

## Completion Criteria

- [ ] TC-01: Ordered queue — two `submit`s during an executing turn (driver A then driver B) both run, in
      submission order (A before B); NEITHER is clobbered. A single driver's repeated submits behave exactly
      as today (regression). When the queue is at `maxQueueDepth`, a further submit is dropped-newest with a
      driver-attributed system notice (not silent).
- [ ] TC-02: Driver id on the turn — `submit(..., { driverId })` tags the turn; the active turn's driver is
      readable while it runs; an omitted `driverId` defaults to the owner id (single-driver unchanged).
- [ ] TC-03: Event attribution — the events a turn emits carry the turn's `driverId` on the wire
      (`subscribeSessionEvents`); a message from driver A is attributed to A, from B to B.
- [ ] TC-04: Permission requester attribution — a permission/ask prompt raised during driver A's turn carries
      `requesterDriverId = A`; `resolvePermission`/`resolveAsk` records the answering driver as
      `answererDriverId` on `prompt_resolved`.
- [ ] TC-05: Server-assigned (not client-trusted) — `handleSessionControlMessage` injects the handler's bound
      remote `deviceId` as the submit/command driver id; a client-supplied `driverId` in the frame is IGNORED.
- [ ] TC-06: OWNER PRINCIPLE preserved — a remote driver's input is subject to the SAME command/permission
      policy as local (attribution does not change authorization); local == remote.
- [ ] TC-07: `pnpm harness:scan` + `pnpm typecheck` + affected package tests green; the WS client + single-driver
      TUI path are unbroken (additive attribution ignored where unused).

## Test Plan

| TC-ID | Test Type       | Tool / Approach                                                                                      | Notes                                     |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| TC-01 | Unit (session)  | vitest — concurrent submit during a turn → ordered drain (A then B); full-queue drop-newest + notice | Extends interactive-session-prompt-flow   |
| TC-02 | Unit (session)  | vitest — driverId on ITurnOptions; active-turn driver readable; default owner id                     |                                           |
| TC-03 | Unit (handler)  | vitest — event attribution stamped at subscribeSessionEvents; A vs B authorship                      | Extends ws-handler.test / bridge          |
| TC-04 | Unit (registry) | vitest — requester driver on permission/ask request; answerer recorded on resolve                    | Extends session-prompt-registry.test      |
| TC-05 | Unit (handler)  | vitest — server-injected remote id used; client-sent driverId ignored                                | Extends ws-handler.test (`'remote'` prec) |
| TC-06 | Unit (gate)     | vitest — remote input hits the same policy as local (OWNER PRINCIPLE); attribution ≠ authorization   | Extends remote-gate test                  |
| TC-07 | CI smoke        | `pnpm harness:scan` exit 0 + `pnpm typecheck` + affected suites; single-driver regression            | Scans + regression                        |

## Tasks

- [ ] `.agents/tasks/REMOTE-014.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
