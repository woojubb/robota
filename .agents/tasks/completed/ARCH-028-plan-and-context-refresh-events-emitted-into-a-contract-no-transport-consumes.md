---
title: 'ARCH-028: plan_event and context_file_refreshed are emitted by the framework into an event contract whose charter says transports consume it, but every transport in every cluster ignores them — two shipped features (SELFHOST-002 plan lifecycle, context-file staleness) are invisible on every surface'
status: done
completed: 2026-08-16
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-transport-tui, packages/agent-transport-protocol, packages/agent-transport
depends_on: [ARCH-016]
---

# ARCH-028: emitted session events no transport consumes

## Problem

The mirror of ARCH-020 (which is about a declared event with no emitter): here two events ARE emitted
by the framework, but no transport subscribes to them, even though the event contract's charter says
"consumed by transports". So SELFHOST-002 plan-mode lifecycle transitions and context-file refresh
notifications fire and reach no surface — TUI, WS bridge, or headless.

## Evidence (round-2 cross-cluster critic, 2026-08-13)

- `packages/agent-interface-session/src/event-contracts.ts:4-8` — "SSOT for the event/record payload
  shapes … consumed by transports through IInteractiveSessionEvents";
  `session-contracts.ts:316-317` — `plan_event` "Emitted on every plan-mode lifecycle transition …
  SELFHOST-002"; `:310-311` — `context_file_refreshed` "Emitted when a context file (AGENTS.md or
  CLAUDE.md) is refreshed".
- Emit sites exist: `agent-framework/src/interactive/interactive-session.ts:878,900,910` (`plan_event`);
  `interactive-session-context-refresh.ts:40` (`context_file_refreshed`).
- Zero production subscribers: the TUI binding list (`TuiInteractionChannel.ts:475-510`) omits both;
  the WS bridge fan-out (`ws-session-events.ts:97-113`) omits both; the headless runner subscribes only
  `goal_event` (`headless-runner.ts:87`). `plan_event`'s only subscribers are its own tests;
  `context_file_refreshed` has zero subscribers anywhere.
- This also undermines ARCH-020's stated fix: ARCH-020 directs implementers to "mirror how
  plan_event/goal_event are emitted so a GUI/monitor surface can render branch changes" — but the WS
  bridge forwards neither plan_event nor branch_event, so the mirror reaches no surface either.

## Direction

Execute with ARCH-020 as one named event-delivery work unit. Own shared event keys and payloads in
`agent-interface-transport`, but keep executable subscription and fan-out policy out of that interface
package. Add separate mechanically-total `Record<event, classification>` mappings in the TUI and protocol
implementation packages so branch, plan, and context-refresh events are either deterministically rendered,
forwarded/accepted by clients, or explicitly classified as non-surface events. Each map must drive listener
registration or be mechanically compared with the actual subscribed keys. TUI/protocol delivery handlers
catch their own failures and call an explicit owner callback; the protocol carrier connects
`onDeliveryError(error, event)` to its client error/disconnect lifecycle, and WebRTC may not swallow it.
Arbitrary SDK listener exception semantics remain unchanged.

## Recommendation Gate

- 2026-08-15 — `DEPTH: LOCAL` as the combined ARCH-020+ARCH-028 work unit; shared keys alone cannot
  repair the absent transport delivery paths.
- 2026-08-15 — independent round-2 review endorsed mechanically coupled per-transport maps and
  explicit owner delivery-error callbacks without moving executable policy into the interface package.

REVIEW VERDICT: ENDORSE

## Scenario Plan Gate

- 2026-08-15 — the combined work unit's protocol and real TUI-channel scenarios were reviewed as
  executable and cover successful delivery plus both owner error callbacks.

DONE-GATE-STAGE-1: PASS

## Test Plan

- Red-first exhaustive-map fixtures fail when a shared event key has no TUI/protocol classification.
- Drive plan transitions and context refreshes and assert deterministic TUI rendering plus protocol
  fan-out/client observation; include owned delivery-failure assertions and a mechanical comparison of
  classifications with actual subscribed keys.
- `pnpm harness:verify -- --scope packages/agent-transport-tui` (and the WS bridge scope) green.

## User Execution Test Scenarios

### Scenario: plan and context-refresh events reach protocol and TUI surfaces

- **Agent executability:** `agent-executable`. The ARCH-020+ARCH-028 event-delivery work unit authors a
  non-interactive public-SDK example backed by the deterministic scripted provider and an in-memory
  protocol client; it requires no live key, network listener, browser, or TTY.
- **Prerequisites:** Node.js 22.14.0 and the workspace dependencies installed. The work unit authors
  `packages/agent-transport/examples/verify-session-event-delivery.ts`; the example creates a
  temporary project with an `AGENTS.md`, connects `createWsHandler` to a real
  `InteractiveSession`, and captures outbound protocol frames as structured data. It also authors
  `packages/agent-transport-tui/examples/verify-session-event-rendering.ts`, which drives a real
  `TuiInteractionChannel` and reads the channel's public render state without mounting a TTY.
- **Commands:**

  ```bash
  volta run --node 22.14.0 pnpm exec tsx --conditions=source packages/agent-transport/examples/verify-session-event-delivery.ts
  volta run --node 22.14.0 pnpm exec tsx --conditions=source packages/agent-transport-tui/examples/verify-session-event-rendering.ts
  ```

- **Expected observable:** both commands exit `0` and each prints one JSON object. The protocol output
  contains `plan_event` frames for `plan_created` and `plan_approved`, followed after the example
  edits `AGENTS.md` and submits another turn by one `context_file_refreshed` frame naming that file;
  the transcript also reports the related branch delivery assertions and an explicit
  `deliveryFailure` record from a throwing protocol send through the carrier-owned callback, with the
  corresponding session operation still committed. The TUI output reports deterministic rendered
  notices for the same plan lifecycle and context refresh, plus a forced render-handler failure
  observed through the TUI-owned error callback. Both outputs report `cleanupRemoved: true`.
- **Cleanup:** both examples stop their channel/bridge, shut down the session, and recursively remove
  their temporary project in `finally`.
- **Evidence (2026-08-15):** both exact commands exited `0`. Protocol stdout:

  ```json
  {
    "scenario": "ARCH-020+ARCH-028-protocol",
    "planEvents": ["plan_created", "plan_approved"],
    "contextRefreshFiles": ["<cwd>/AGENTS.md"],
    "branchEvents": [
      { "kind": "checkpoint_created", "checkpointId": "turn-0001", "branchId": "main" },
      { "kind": "checkpoint_created", "checkpointId": "turn-0002", "branchId": "main" },
      { "kind": "branch_forked", "checkpointId": "turn-0001", "branchId": "branch-1" },
      { "kind": "branch_switched", "checkpointId": "turn-0002", "branchId": "branch-2" }
    ],
    "finalActiveBranch": { "branchId": "branch-2", "checkpointId": "turn-0002" },
    "deliveryFailure": {
      "message": "forced protocol send failure",
      "event": "branch_event",
      "operationCommitted": true
    },
    "cleanupRemoved": true
  }
  ```

  TUI stdout:

  ```json
  {
    "scenario": "ARCH-028-tui",
    "notices": [
      "Plan plan created",
      "Plan plan approved",
      "Context refreshed: <cwd>/AGENTS.md",
      "Branch checkpoint created: main @ turn-0001"
    ],
    "deliveryFailure": {
      "message": "forced TUI render projection failure",
      "event": "plan_event",
      "operationCommitted": true
    },
    "cleanupRemoved": true
  }
  ```

  The official owner `scenario:record` commands wrote matching normalized records under each
  package's `examples/scenarios/` directory.

## Conformance Evidence

- 2026-08-15 — bidirectional SPEC/code comparison: code→SPEC `68` items and SPEC→code `68`
  items checked (`6` operation-matrix rows, `5` branch kinds, both exhaustive `26`-event surface
  maps, and `5` carrier/error seams); discrepancies `0` after the required carrier callback and TUI
  visible fallback were made explicit.
- Regression: affected `10` packages built and typechecked; full suites passed, including framework
  `167/1349`, protocol `10/93`, WS `6/45`, WebRTC `10/40`, TUI `73/568`, transport `17/81`, GUI
  `4/21`, WebRTC-web `8/48`, interface-transport `10/44`, and CLI `39/291`.
- RED proof: the new post-accept WS/WebRTC carrier tests failed against the pre-fix tree because the
  failed channels were not closed/cleaned, then passed against the completed implementation.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** scenario-written → scenario-verified

- **Direct execution:** both exact public-SDK commands above ran twice against the completed
  implementation; all four invocations exited `0`, and each command's two normalized JSON outputs
  were identical.
- **Expected observable:** protocol output contained `plan_created`, `plan_approved`, and the
  `<cwd>/AGENTS.md` context refresh; TUI output exposed the four deterministic notices. Protocol and
  TUI forced-delivery records both reported their owner callback, event name, and
  `operationCommitted: true`.
- **Cleanup:** every run reported `cleanupRemoved: true` after stopping its bridge/channel, shutting
  down the session, and removing the temporary project.
- **Durable evidence:** owner scenario verification matched both outputs against
  `packages/agent-transport/examples/scenarios/session-event-delivery.record.json` and
  `packages/agent-transport-tui/examples/scenarios/session-event-rendering.record.json`.
- **Surface verification:** exact TUI scoped verification passed `73` test files / `568` tests,
  typecheck, and canonical scenario comparison; exact WS scoped verification passed `6` test files /
  `45` tests and typecheck. The React side-effect test derives its expected keys from the exhaustive
  classification map and compares actual subscribe/unsubscribe state, while TUI tests cover both the
  owner callback and the visible no-observer delivery-error fallback.
