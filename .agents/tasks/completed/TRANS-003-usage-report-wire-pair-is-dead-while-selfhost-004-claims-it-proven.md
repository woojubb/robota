---
title: "TRANS-003: the get-usage-report/usage_report wire pair is unroutable at every consumer while SELFHOST-004's done record marks TC-08 (GUI renders it over the WS stream) as proven"
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2164#issuecomment-5459592489
created: 2026-08-13
priority: high
urgency: now
area: packages/agent-transport-protocol, packages/agent-transport-gui, apps/agent-app, .agents/spec-docs/done
depends_on: []
---

# TRANS-003: a closed task's checked criterion is contradicted by shipped code

## Problem

The transport-neutral wire protocol declares a `get-usage-report` request and a `usage_report` server
event (SELFHOST-004, the trace/cost read-model over the sidecar boundary). Neither is routed by the
reference dispatcher — a `get-usage-report` message is answered `protocol_error: Unknown message
type` — and nothing produces `usage_report`, no GUI requests it, and `IInteractiveSession` has no
accessor to serve it from. Yet the completed SELFHOST-004 record marks TC-08 ("the GUI renders it
renderer-side … proving the timeline actually reaches apps/agent-app over the WS stream") as done.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-transport-protocol/src/ws-protocol.ts:38,84` — declares
  `{ type: 'get-usage-report' }` and the `usage_report` server event.
- `packages/agent-transport-protocol/src/ws-handler.ts:97-125` — `handleClientMessage` routes only
  control/query/background/prompt-response; `get-usage-report` falls to `protocol_error: Unknown
message type` (`:123-124`). `session-resume-bridge.ts:110` delegates to the same router.
- No producer of `usage_report`, no GUI request, no `IInteractiveSession` usage/trace accessor
  (`session-contracts.ts:337-440`). The only non-declaration references are a type-only
  `usage-report-carrier.test.ts` (round-trips a hand-built object, exercises no handler), the pure
  analytics reducer/formatter, and agent-cli's offline `session analyze` stdout path.
- `.agents/spec-docs/done/SELFHOST-004-trace-cost-view.md:204` — TC-08 `[x]` "the GUI renders it
  renderer-side — proving the timeline actually reaches `apps/agent-app` over the WS stream", while
  the archived breakdown admits TC-08 closed as "well-typed + survives JSON WS round-trip" and the P6
  summary ends at `formatUsageReport` (headless CLI), never at the wire.

## Direction

Resolve the dead wire pair one way or the other — this is a closed task's criterion contradicted by
shipped code, so the current state must not persist:

- **Finish it:** add an `IInteractiveSession` usage-report accessor, a `get-usage-report` route in
  `ws-handler`/resume-bridge that serves it, and the GUI consumer that renders it — making TC-08 true.
- **Retract it:** remove the two dead wire variants and the type-only carrier test, and correct the
  SELFHOST-004 done record to state what was actually proven (typed + JSON round-trip, headless
  formatting), not an end-to-end wire delivery.

Owner decision on which; either way the done record and the code must agree.

## Test Plan

- If finished: red-first WS test — a `get-usage-report` request returns a `usage_report` frame
  carrying the assembled read-model (fails today with `protocol_error`).
- If retracted: `rg 'usage_report|get-usage-report'` returns only removed-history; the SELFHOST-004
  record's TC-08 wording matches the code.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies only if "finish it" is chosen** (the trace/cost view is a GUI product surface).

- Prerequisites: built desktop app (`apps/agent-app`) driving the `robota --serve` sidecar; a session
  with at least one turn.
- Steps: run a turn, open the trace/cost view in the GUI.
- Expected (after "finish it"): the usage/trace timeline renders from data delivered over the WS
  stream.
- Expected (before fix, contrast): the request errors with `protocol_error: Unknown message type`
  and the view has no data.
- If "retract it" is chosen: Not applicable — record the removal + done-record correction in the Test
  Plan instead.
- Evidence (fill in after implementation): screenshot of the rendered trace view, or the removal diff.
