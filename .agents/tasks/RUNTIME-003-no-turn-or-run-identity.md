---
title: 'RUNTIME-003: no turn or run identity — concurrency has no owner, so every consumer invents its own busy flag and two of them race'
status: todo
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-session, packages/agent-framework, packages/agent-transport-mcp, packages/agent-transport-http, packages/dag-worker, packages/dag-framework
depends_on: []
---

# RUNTIME-003: the layer that owns the AbortController does not own the unit of work

## Problem

An orphaned turn keeps streaming, keeps writing history and keeps executing tools **while
`isRunning()` reports `false` and `abort()` is a no-op for it**. Nothing is loud about this.

"Is something running?" has no authoritative answer, so every consumer maintains a parallel, drifting
one — and two of those implementations race. The same shape recurs in the DAG stack, where run
_advancement_ has no owner either and three consumers implement the loop differently, two of them
over one shared queue.

This blocks the concurrency and multi-surface work above it.

## Evidence

Observed independently by **L1 (runtime)**, **L3 (transport)** and **L5 (DAG)**.

- L1 #1 — `packages/agent-session/src/session.ts:180-194`: `run()` assigns
  `this.abortController = new AbortController()` with no re-entrancy guard, and clears it in
  `finally`; `session-base.ts:131-140` keys `abort()`/`isRunning()` off that single field. A second
  `run()` overwrites it; the first `finally` to fire nulls it. **The guard exists one layer up** —
  `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts:268-274`:
  _"RUNTIME-12: claim the turn SYNCHRONOUSLY at entry"_ — which is the textbook shape of a workaround
  for a defect below. Every other consumer of this published library gets no guard.
- L3 L7 — `agent-transport-mcp/src/mcp-server.ts:130-162` `waitForCompletion` subscribes to
  **session-global** `complete`/`interrupted`/`error` with no request correlation and no busy guard;
  two concurrent `submit` calls each resolve on whichever `complete` fires first.
- L3 L10 — `agent-transport-http/src/routes.ts:46-54` implements the busy check HTTP needed and
  documents its own TOCTOU: _"the synchronous `streamSSE` subscribe below runs before `await
session.submit`, so two requests passing this check in the same tick could still both proceed."_
- L5 F3 — run advancement has no owner in the DAG stack either: `WorkerLoopService.processOnce()`
  (`worker-loop-service.ts:73`) is a single _step_, so three consumers implement the loop differently —
  `dag-framework/src/runtime/worker-loop-driver.ts`, `adapters/prompt-backend.ts:228-268`
  (`MAX_PROCESS_ITERATIONS = 5000`), `local-dag-runtime-provider.ts:280-306`
  (`MAX_WORKER_ITERATIONS = 10_000`) — and two of them share one queue
  (`create-dag-framework.ts:126-129,132,171,185`), with `prompt-backend.ts:89`'s
  `void this.processRunUntilTerminal(...)` a floating promise on top.

The cause in one sentence, from the synthesis: _the layer that owns the `AbortController` (and the
DAG layer that owns the step) does not own the unit of work, so "is something running?" has no
authoritative answer and each consumer maintains a parallel, drifting one._

## Why this is foundational (or not)

**FOUNDATIONAL** per L1 and L5. L3's two instances (MCP `waitForCompletion`, the HTTP TOCTOU) are
**LOCAL symptoms of it** — the synthesis carries that distinction rather than collapsing it.

The tell the synthesis emphasises: the correct guard already exists one layer up
(`interactive-session-execution-controller.ts:268-274`, _"claim the turn SYNCHRONOUSLY at entry"_),
which is _the textbook shape of a workaround for a defect below_ — and every other consumer of the
published `agent-session` library gets no guard at all.

Severity **BLOCKER**: three layers, silent, and blocking.

## Direction

The invariant the synthesis states for this class (theme T5): _state whose correct value depends on a
call, a session or an instance must not live on a module, a static field, or a shared long-lived
object_ — here, the single `abortController` field standing in for turn identity.

What the synthesis establishes must exist: a **turn/run identity owned by the layer that runs it**,
so that `abort()` and `isRunning()` answer about a specific unit of work, and so that a subscriber
can correlate an event to the request that caused it. The two consequences it names as currently
impossible:

- MCP's `waitForCompletion` cannot correlate a `complete` event to a request
  (`mcp-server.ts:130-162`).
- HTTP's busy check cannot close its own documented TOCTOU window (`routes.ts:46-54`).

On the DAG side the same shape: `processOnce()` is a _step_, not a run, so the loop belongs to
whoever owns run advancement rather than to three separate consumers.

Risk named by the synthesis: the guard that exists today lives **above** the library, so any fix that
only hardens `agent-framework` leaves published `agent-session` consumers unguarded — which is the
defect, not the symptom. And the DAG side carries a floating promise
(`prompt-backend.ts:89`, `void this.processRunUntilTerminal(...)`) that will keep an orphaned loop
alive independently of whatever guard is added.

## Test Plan

- **Required red-first regression:** start a `run()` on `agent-session`, start a second `run()`
  before the first completes, then call `abort()`. Assert the **first** turn stops — it must not keep
  streaming, writing history or executing tools. Against current code this must FAIL:
  `session.ts:180-194` overwrites `this.abortController`, so `abort()` reaches only the second turn
  and `isRunning()` (`session-base.ts:131-140`) reports on one field for two turns. Prove the test
  fails against the unfixed code before landing the fix.
- Red-first: two concurrent `submit` calls through the MCP transport must each resolve on **their
  own** completion, not on whichever `complete` fires first (`mcp-server.ts:130-162`).
- Red-first: two HTTP `POST /submit` requests issued in the same tick must not both proceed
  (`routes.ts:46-54`, the documented TOCTOU).
- DAG: assert one owner advances a run, and that the two consumers sharing a queue
  (`create-dag-framework.ts:126-129,132,171,185`) cannot both drive it; assert
  `prompt-backend.ts:89`'s floating promise is awaited or owned.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Concurrent submissions over a shipped transport are a user-reachable path, and the
observable failure (interleaved or cross-resolved responses) is user-visible.

- **Prerequisites:** built `robota` CLI; a provider key. A locally served transport is needed and
  already exists (the CLI serves the HTTP transport); no new fixture required.
- **Steps:**
  1. Start the CLI serving the HTTP transport on loopback.
  2. Issue two `POST /submit` requests essentially simultaneously with two clearly distinguishable
     prompts (e.g. "reply with exactly AAAA" and "reply with exactly BBBB").
  3. Separately, in an interactive session, start a long turn and issue a second submission before it
     finishes, then cancel.
- **Expected observable result (after the fix):** in step 2 the second request is refused as busy (or
  is queued and answered with its own response) — the two responses are never crossed. In step 3, the
  cancel stops the turn that is actually running, and the session reports the correct running state
  throughout.
- **Expected observable result (before the fix, for contrast):** the two responses can cross, and a
  cancel after a second submission leaves the first turn streaming while the session reports it is
  not running.
- **Cleanup:** stop the served transport.
- **Evidence (fill in after implementation):** the two request/response pairs showing correct
  correlation, plus a transcript excerpt for the cancel case.
