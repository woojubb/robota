---
title: 'CORE-011: allow tool-only turn completion — the forced summary call cannot be disabled (decision-agent tax)'
status: todo
created: 2026-07-03
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# Tool-only completion / skip the forced summary call

External adoption feedback (speech project, `.design/feedback-speech-adoption-2026-07-03.md` §3.1,
claims source-verified 2026-07-03): when an execution ends with tool calls and no text response,
`execution-pipeline.ts` unconditionally runs `forceSummaryCall` — one extra provider call with no
opt-out, and this path does not check `signal?.aborted` before entering.

**Measured impact**: a coordinator agent whose entire job is "record a decision via one tool call"
pays ~2.5s + tokens per decision for a summary it discards; their user-turn TTFT regressed **+49%**
until they built an early-resolve workaround (+14% after). Every "agent as decision-maker" pattern
(router, orchestrator, classifier) pays this tax today.

## What

Any one of these satisfies the need (reporter's proposals, in preference order):

1. Run option `skipForcedSummary: true` (or `allowToolOnlyCompletion`) — a tool-only ending is a
   valid completion; the result carries the tool outcome.
2. A "terminal tool" concept — a tool marked terminal ends the run when called, its call being the
   final answer (also the cleanest fit for the decision-agent pattern; see DOCS-014).
3. At minimum: check `signal?.aborted` before entering `forceSummaryCall`, so a caller that already
   extracted the decision can abort away the wasted call.

Design per spec pipeline (GATE-WRITE) — decide which surface(s) to build; the option must compose
with `maxExecutionRounds` semantics and streaming.

## Test Plan

- Unit (agent-core): a run ending in tool calls with the option set completes without an extra
  provider call (provider call count asserted); default behavior unchanged; abort before summary is
  honored.
- Functional: scripted provider — decision-tool turn completes in exactly N calls.

## User Execution Test Scenarios

- Prereq: a consumer script assembling `Robota` with one decision tool, scripted or real provider.
- Steps: run a prompt that triggers exactly one tool call with the new option enabled; measure
  provider call count and latency vs default.
- Expected: one provider call (no summary call), the tool result retrievable, latency drop
  observable.
- Evidence: _to fill at implementation._
