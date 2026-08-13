---
title: "CORE-033: the engine's abnormal-path provider calls and history mutations are off-contract — the forced-summary call drops signal/effort/timeout and emits no replay events, and capacity/failure/streaming appends emit none of the required event families"
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-033: required replay events and per-call options are dropped on abnormal paths

## Problem

The SPEC declares `provider_request`, `assistant_message_committed`, and `history_mutation` REQUIRED
event families, and says every provider call carries `signal` and an explicit `effort`. Several engine
mutation/provider-call sites emit none of the families, and the forced-summary provider call drops the
per-call options — so a replay consumer's reconstruction diverges from the store at exactly the
abnormal paths (forced summary, capacity block, provider failure) and across the entire streaming path.

## Evidence (round-2 engine audit, 2026-08-13)

- `packages/agent-core/docs/SPEC.md:850-861` — the three REQUIRED event families;
  `:461-463`/`:495-496` — every provider call carries a signal and explicit effort.
- `execution-pipeline.ts:136-192` — `forceSummaryCall` appends a synthetic user message, calls
  `provider.chat()` directly with only `{ model, onTextDelta }` (`:161-168` — no `signal`, no
  `effort`, no idle timeout), appends the summary assistant message, and rebuilds history via
  `clear()` + re-add — emitting ZERO events (and the strip is an unannounced non-append mutation).
- `execution-round-context.ts:85-100` — the hard-capacity diagnostic assistant message is appended
  with no events; `execution-round-streaming.ts:138-141` — the `Request failed:` assistant message
  likewise.
- `execution-stream.ts` — accepts `context.onExecutionEvent` (`robota-execution.ts:39`) and never
  invokes it once; no event families on the streaming path at all.

## Direction

Emit the three families at the forced-summary, capacity-block, and provider-failure append sites, and
wire `onExecutionEvent` through `executeStream`. Pass `signal`, `effort`, and the idle timeout into the
forced-summary `provider.chat()` call (it is a provider call like any other; dropping the signal there
is a cancellation gap adjacent to but distinct from RUNTIME-004). The forced-summary history strip
needs either a `history_mutation` removal vocabulary or a non-destructive strip so replay stays
append-consistent.

## Test Plan

- Red-first: a run that hits the round cap (forcing the summary call) emits `provider_request` +
  `assistant_message_committed` for that call and passes the run's `signal`/`effort`; a capacity-block
  and a provider-failure append each emit `history_mutation`; a `runStream` run emits the families.
  All fail today.
- Red-first: aborting during the forced-summary call is honored (signal now threaded).
- `pnpm harness:verify -- --scope packages/agent-core` green.

## User Execution Test Scenarios

**Applies** — via the session-log replay surface (`robota --session-log`), where missing events cause
replay divergence.

- Prerequisites: built CLI + provider key; a session engineered to hit the round cap (a tool loop) so
  the forced-summary path fires.
- Steps: run the session with logging, then replay it and compare the reconstructed history to the
  live session.
- Expected (after fix): the replayed history matches the live session across the forced-summary/
  capacity/failure paths.
- Expected (before fix, contrast): the replay is missing the forced-summary/diagnostic appends (and
  the hidden strip is invisible).
- Cleanup: delete the log.
- Evidence (fill in after implementation): the live-vs-replay history diff.
