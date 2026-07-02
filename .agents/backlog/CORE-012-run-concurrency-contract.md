---
title: 'CORE-012: Robota.run() concurrency contract — serialize concurrent runs or state the contract'
status: todo
created: 2026-07-03
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# `run()` concurrency guard / contract

External adoption feedback (speech project, `.design/feedback-speech-adoption-2026-07-03.md` §3.2,
source-verified 2026-07-03): nothing prevents or serializes concurrent `run()` calls on one
`Robota` instance — two executions interleave their messages into the shared conversation history,
and no documented contract says the instance is not concurrency-safe.

**Impact**: in event-driven hosts (ws server, UI callbacks) overlapping turns happen easily; the
reporter had to build a promise-chain mutex around every call.

## What

1. **Preferred (reporter concurs)**: an internal run queue — a `run()` issued while another is in
   flight awaits its turn (Robota is a stateful history-owning object, so serialization is the
   correct default). Consider an opt-out or a `queue: false → throw` mode for callers that want
   fail-fast.
2. At minimum: document the non-guarantee prominently (JSDoc on `run`/`runStream` + SPEC + guide)
   so consumers know to serialize. (DOCS-014 carries the doc part if 1 lands.)

Interaction to design: abort semantics for queued-but-not-started runs; `runStream` and
`InteractiveSession.submit` (which already queues at the framework layer — keep one owner, don't
double-queue).

## Test Plan

- Unit (agent-core): two concurrent `run()` calls — history contains the two exchanges strictly
  sequentially (no interleaving); queued run sees the first run's messages; abort of a queued run.
- Regression: framework `InteractiveSession` queueing still works (no double-queue deadlock).

## User Execution Test Scenarios

- Prereq: consumer script firing two `run()` calls without awaiting the first.
- Steps: run it; inspect the resulting history order.
- Expected: strictly sequential turn blocks (or a documented thrown error), never interleaved
  messages.
- Evidence: _to fill at implementation._
