---
status: done
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
3. **Pure cross-driver FIFO (every submit appends).** Bounded FIFO, drained in order. Con: it changes
   SINGLE-driver behavior — today two rapid submits during one turn COALESCE (last-wins: the executing-branch
   overwrites the one pending slot, so an operator editing their queued input replaces it). A pure FIFO would
   run BOTH, a real behavior change + a single-flooder amplifier. Rejected in favor of the hybrid below that
   preserves today's single-driver semantics.
4. **(Chosen) Bounded, ordered, attributed queue with same-driver coalescing.** Replace the single pending
   slot with a bounded FIFO of `{input, displayInput, rawInput, options, driverId, wakeTaskId?}`. On submit
   while executing: if the **tail entry is from the SAME driver**, REPLACE it (coalesce — preserves today's
   editable-pending, last-wins-per-driver semantics + caps a single flooder to one queued entry); otherwise
   **append** (a different driver's input never clobbers another's). Drained head-first in submission order
   after each turn. Bounded by `maxQueueDepth` (drop-**newest** + an **attributed** system notice when full —
   drop-newest gives the submitter immediate feedback and never silently kills already-acknowledged queued
   input). Pro: single-driver behavior is byte-for-byte today (a 1-deep coalescing slot), cross-driver input
   is serialized fairly in submission order with NO silent clobber, turns stay atomic (one prompt each — no
   within-turn interleave), attribution rides each entry, and the bound stops a runaway. Con: coalesce-vs-
   append branch + a full-queue policy + queue-aware read semantics. Accepted: the only option that preserves
   single-driver parity AND serializes co-drivers without clobber AND stays bounded.

### Decision

Take alternative 4 — a **bounded ordered attributed queue with same-driver coalescing** at the one choke
point every driver funnels through (`InteractiveSession.submit`), so arbitration covers local TUI, remote
WS/WebRTC, wakeups, and the goal loop with no transport-layer arbitration. The driver-id type
(`TDriverId`) and the event/prompt attribution fields are defined in **`agent-interface-transport` (the
contract SSOT)** — NOT in `agent-framework`'s `ITurnOptions` — because the transport contract
`IInteractiveSession.submit` cannot depend upward on `agent-framework`; `agent-framework` consumes them.

Attribution is a **server-assigned `driverId`** carried on the turn, stamped **selectively** — only onto
**turn-authored** events (`user_message`, `text_delta`, `tool_start/end`, `thinking`, `complete`,
`interrupted`, the turn's `error`) and the permission/ask prompts the turn triggers — read from the session's
active-turn driver at emit time (NOT a blanket spread like E4's `seq`; background/goal/memory/
execution-workspace events are NEVER stamped). The **default driver id depends on the turn source**: a
human turn without an explicit id defaults to the local **owner** id, but a `turnSource: 'agent-wakeup'`
(wakeup/goal/agent-initiated) turn defaults to a reserved **`'agent'`** id — so an autonomous tool's
permission prompt reads `requesterDriverId: 'agent'`, never mis-attributed to the owner. The remote driver
id is the E3 `deviceId` bound at pairing accept (server-known — a client cannot forge it, and any
client-sent id is ignored). Both the request's `requesterDriverId` and the resolve's `answererDriverId` are
server-assigned.

This is a **contract-boundary change** (session `submit` signature + queue-aware read + event/prompt
attribution fields + protocol framing): validated for reachability (every current `submit`/`executeCommand`
caller keeps working — `driverId` optional, defaulting per turn source; the WS client ignores additive
fields), capability preservation (single-driver behavior is byte-for-byte today — the coalescing 1-deep
slot), and an adversarial pass (client-supplied driver id ignored; the queue bound + drop-newest-notice stop
a flooder; `clearPendingQueue` releases EVERY queued entry's `wakeTaskId` — no gate leak, CORE-024; a
whole-queue `abort`/`cancelQueue` emits an attributed notice so the other driver sees why its queued input
was cleared; attribution is **display-only**, explicitly never an authorization input — the OWNER PRINCIPLE
keeps remote == local for policy).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — arbitration lives at the SINGLE `InteractiveSession.submit` choke point (every driver — local TUI, remote handler, wakeups, goal loop — funnels through it, verified by the surface map), so no per-transport arbitration is needed. Permission/ask attribution is added at the one `SessionPromptRegistry` that mints every prompt. The `TDriverId` type + attribution fields live in `agent-interface-transport` (contract SSOT); `ITurnOptions` (agent-framework) consumes it — the contract cannot depend upward.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **Types in the contract SSOT (`agent-interface-transport`):** `TDriverId` (a branded string; reserved
  constants `OWNER_DRIVER_ID = 'owner'`, `AGENT_DRIVER_ID = 'agent'`); an optional `driverId` on the turn
  options / `submit` signature; `requesterDriverId` on `IPermissionRequestEvent`/`IAskRequestEvent`;
  `answererDriverId` on `IPromptResolvedEvent`; the attribution field on turn-authored events. `agent-framework`
  imports these (no upward dependency).
- **Coalescing ordered queue (`agent-framework`):** in `SessionExecutionController`, replace the scalar
  `pendingPrompt`/`pendingDisplayInput`/`pendingRawInput`/`pendingTurnOptions` with a bounded
  `pendingQueue: IQueuedInput[]` (`{ input, displayInput?, rawInput?, options?, driverId, wakeTaskId? }`).
  `InteractiveSession.submit` executing-branch: if `pendingQueue` tail is the SAME `driverId` → **replace**
  (coalesce); else **append**. `drainPendingQueue` dequeues the head. `maxQueueDepth` (default e.g. 32) →
  drop-newest + a driver-attributed system notice. **`clearPendingQueue` iterates the whole queue and releases
  EVERY entry's `wakeTaskId`** (CORE-024/RUNTIME-19 — a dropped wake must free its gate). Single-driver =
  a 1-deep coalescing slot = today.
- **Queue-aware read (contract + TUI + protocol):** `getPendingPrompt()` returns the HEAD prompt (next to
  run — backward-compatible display); add a queue view (`getPendingQueue()` / a `pendingCount` on the
  `get-pending` reply) so a co-drive surface shows "N queued" (attributed) rather than hiding a co-driver's
  queued input. The TUI + web-ui render the head + queued count.
- **Driver id on the turn:** thread `driverId` on `submit`; the session captures the ACTIVE turn's `driverId`
  (like `turnSource` today) via `getActiveDriverId()` so events/prompts read it at emit time. **Default per
  turn source:** human turn → `OWNER_DRIVER_ID`; `turnSource: 'agent-wakeup'` (wakeup/goal/agent) →
  `AGENT_DRIVER_ID` (never owner).
- **Selective event attribution (`agent-transport-protocol`):** at the point each turn-authored event is
  emitted, read `session.getActiveDriverId()` and stamp it (this is NOT a blanket spread like E4's `seq` — a
  counter is stampable at the bridge, a driver id must be read from turn state). **Only** turn-authored events
  carry it (`user_message`/`text_delta`/`tool_start`/`tool_end`/`thinking`/`complete`/`interrupted`/turn
  `error`); `background_task_event`/`background_job_group_event`/`execution_workspace_event`/`goal_event`/
  `memory_event` and background-origin `error` are NEVER stamped (they are not authored by the active turn).
- **Permission/ask attribution (`agent-framework` + protocol):** `SessionPromptRegistry.requestPermission/requestAsk`
  stamp `requesterDriverId = active turn's driver` (agent turn → `'agent'`). The answering driver is
  **server-injected** on the inbound `permission-response`/`ask-response` (from the handler's bound id — NOT
  client-trusted), recorded in `settle` → surfaced as `answererDriverId` on `IPromptResolvedEvent`. A LOCAL
  answer via `resolvePermission`/`resolveAsk` tags the owner id. Both surfaces render "requested by X /
  answered by Y".
- **abort / cancelQueue co-drive semantics:** `abort()` and `cancelQueue()` clear the WHOLE shared queue
  (defensible under the OWNER PRINCIPLE — any driver can already abort the running turn), releasing every
  entry's `wakeTaskId`, and emit an **attributed** system notice (`cancelled by <driverId>`) so a driver whose
  queued input was cleared sees why. (Caller-scoped cancel is out of scope — E5 keeps the simple whole-queue
  clear + attribution.)
- **Driver-id source (`agent-transport-webrtc` + `agent-transport-tui`):** remote = the E3 `deviceId` bound at
  `pairing-gate.ts` accept, threaded into `createWsHandler` (`IWsHandlerOptions`) + `SessionResumeBridge`
  (server-known); `handleSessionControlMessage` injects it into `submit`/`executeCommand` and the
  prompt-response, ignoring any client-sent id. Local = `OWNER_DRIVER_ID` at the TUI's direct call sites.
- **Authorization invariant:** `driverId` is display/attribution ONLY. Add an explicit invariant comment at
  the policy sites (command-source/permission gate) forbidding any authorization decision keyed on `driverId`
  — the OWNER PRINCIPLE (REMOTE-006) governs authorization, remote == local.
- **Render (`agent-web-ui`):** message author label + permission requester/answerer driver labels + the
  pending queued-count.

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

- [ ] TC-01: Coalescing queue — two `submit`s during an executing turn from DIFFERENT drivers (A then B) both
      run in submission order (A before B), NEITHER clobbered; two consecutive submits from the SAME driver
      COALESCE (last-wins, 1-deep — byte-for-byte today's single-driver behavior). At `maxQueueDepth`, a
      further submit is dropped-newest with a driver-attributed system notice (not silent).
- [ ] TC-02: Driver id on the turn — `submit(..., { driverId })` tags the turn; `getActiveDriverId()` reads it
      while the turn runs; a human turn without an id defaults to `OWNER_DRIVER_ID`; a `turnSource:'agent-wakeup'`
      turn defaults to `AGENT_DRIVER_ID` (never owner).
- [ ] TC-03: Selective event attribution — turn-authored events (`user_message`/`text_delta`/`complete`/…)
      carry the turn's `driverId`; a background/goal/execution-workspace event carries NONE (never mis-attributed
      to the last driver). A message from driver A is attributed to A, from B to B.
- [ ] TC-04: Permission requester + answerer attribution — a prompt raised during driver A's turn carries
      `requesterDriverId = A` (an agent turn → `'agent'`); the answer records `answererDriverId` (server-assigned)
      on `prompt_resolved`; a local answer tags the owner id.
- [ ] TC-05: Server-assigned (not client-trusted) — `handleSessionControlMessage` injects the handler's bound
      remote `deviceId` as the submit/command AND prompt-response driver id; a client-supplied `driverId` is IGNORED.
- [ ] TC-06: OWNER PRINCIPLE + wakeTaskId release — a remote driver's input hits the SAME policy as local
      (attribution ≠ authorization); `clearPendingQueue` (via `abort`/`cancelQueue`) releases EVERY queued
      entry's `wakeTaskId` (no gate leak), clears the whole queue, and emits an attributed `cancelled by <id>` notice.
- [ ] TC-07: Queue-aware read + regression — `getPendingPrompt()` returns the head; the queued count is
      surfaced (co-driver input not hidden); `pnpm harness:scan` + `pnpm typecheck` + affected suites green; the
      WS client + single-driver TUI path unbroken (additive attribution ignored where unused).

## Test Plan

| TC-ID | Test Type       | Tool / Approach                                                                                                                 | Notes                                     |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| TC-01 | Unit (session)  | vitest — cross-driver append (A→B ordered) + same-driver coalesce (1-deep) + full-queue drop-newest+notice                      | Extends interactive-session-prompt-flow   |
| TC-02 | Unit (session)  | vitest — driverId on submit; `getActiveDriverId`; owner default (human) vs `'agent'` default (agent-wakeup)                     |                                           |
| TC-03 | Unit (handler)  | vitest — SELECTIVE stamping: turn-authored events carry driverId, background/goal events do not                                 | Extends ws-handler.test / bridge          |
| TC-04 | Unit (registry) | vitest — requesterDriverId (active turn, `'agent'` for agent) + answererDriverId recorded on resolve                            | Extends session-prompt-registry.test      |
| TC-05 | Unit (handler)  | vitest — server-injected remote id on submit/command/prompt-response; client-sent driverId ignored                              | Extends ws-handler.test (`'remote'` prec) |
| TC-06 | Unit (session)  | vitest — same policy local==remote; `clearPendingQueue` releases every entry's wakeTaskId + attributed notice                   | Extends prompt-flow + remote-gate         |
| TC-07 | CI smoke        | `pnpm harness:scan` exit 0 + `pnpm typecheck` + affected suites; getPendingPrompt head + queued count; single-driver regression | Scans + regression                        |

## Tasks

- [ ] `.agents/tasks/REMOTE-014.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
