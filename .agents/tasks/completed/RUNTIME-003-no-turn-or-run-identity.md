---
title: 'RUNTIME-003: no turn or run identity — concurrency has no owner, so every consumer invents its own busy flag and two of them race'
status: done
created: 2026-08-02
completed: 2026-08-13
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

**Applies and is agent-executable.** The durable scenario is
[runtime-003-dag-advancement-agent-run.md](../evals/scenarios/runtime-003-dag-advancement-agent-run.md).
It contains two complete, credential-free command blocks written before P3 implementation:

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-13

**Status upgrade:** scenario drafted → scenario written

The independent guardian confirmed before P3 implementation that both scenarios are explicitly
agent-executable and contain complete prerequisites, exact Bash, bounded waits, public product
surfaces, precise exit/output observables, cleanup, and separate `Observed evidence: EMPTY` fields.
The final prerequisite correction named GNU coreutils `timeout`; the guardian then returned PASS.
This entry restores the durable audit trace for that prior read-only verdict.

1. The public `createDagFramework` SDK surface accepts twelve concurrent prompts over one queue. A
   deliberately slow custom node records `maximumConcurrentExecutions`; the required observable is
   exactly `1`, with 12 accepted/completed prompts, zero active execution after stop, zero unhandled
   rejection, bounded submission/history/stop waits, and deterministic cleanup.
2. The built `robota-dag` CLI runs `input | text-output` and emits exactly `RUNTIME003_OK` with exit 0.

The artifact records exact Bash, prerequisites, assertions, exit behavior, and cleanup. Both exact
blocks passed on 2026-08-13 19:43 KST: the SDK flow reported 12 accepted/completed prompts,
`maximumConcurrentExecutions: 1`, zero active execution after stop and zero unhandled rejections;
the built CLI emitted exactly `RUNTIME003_OK`, with both blocks exiting 0.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-13

**Status upgrade:** scenario written → scenario executed

Scenario 1 — concurrent public-SDK prompts share one advancement actor: PASS — the independent
guardian freshly executed the exact Bash block in the durable scenario against commit
`2ad61d188a96603d4c2dab077278bd646b356149`. It exited 0 and emitted 12 accepted and completed
prompts, maximum concurrency 1, zero active execution after stop, and zero unhandled rejections.

Scenario 2 — shipped CLI execution remains observable: PASS — the guardian freshly executed the
exact Bash block against `packages/dag-cli/dist/node/bin.js`. It exited 0 and stdout was exactly
`RUNTIME003_OK` followed by one newline.

Cleanup and evidence integrity: PASS — scratch files were removed, the working tree was clean, and
no build, test, lint, harness, CI output, or capability-absence exception was used as product
execution evidence.

## Progress

### P1 — the library layer refuses a concurrent turn (100% of P1; 1 of 3 phases, ~33% of the task)

`packages/agent-session/src/turn-claim.ts` (new) — the unit of work now has an **owner**. The bare
`AbortController | null` field was doing three jobs at once (cancellation channel, busy flag, turn
identity) and could only do them for one turn. `TurnClaim` takes the claim synchronously, refuses a
second, and releases only for the caller that holds it. `session.ts` `run()` calls `claim()` before
its first `await` and `release(controller)` in `finally`; `session-base.ts` `abort()`/`isRunning()`
delegate to the same object, so all three answer about the same turn.

Extracting it was not optional: the inline version pushed `session.ts` past its frozen size
baseline, and the file-size ratchet says to split rather than extend. Re-freezing the baseline would
have been disabling the gate to fit the change. The split is also what the Direction above asks for —
turn identity owned by the layer that runs it.

That is the defect itself rather than a symptom: the guard previously existed only one layer up in
`agent-framework`
(`interactive-session-execution-controller.ts:268-274`), so every consumer of the **published**
`agent-session` library got none. `abort()` and `isRunning()` (`session-base.ts:131-140`) read the
same field, so both now answer about the one turn that owns it.

Refusing, rather than cancelling the first turn: a session is a single conversation, and silently
aborting the running turn would discard work the caller never asked to abandon. The error names the
three ways out (await it, `abort()` first, or use a separate session).

`packages/agent-session/src/__tests__/session-turn-reentrancy.test.ts` — 8 cases, red-proved by
restoring the unguarded claim/release: the two defect cases fail on **named assertions**
(`expected 'pending' to be 'rejected'`, `expected false to be true`) in 262ms and 13ms, not on a
timeout. The third is labelled in the file as a regression guard that passes against the defect too,
so it is not miscounted as proof. 163 `agent-session` tests pass; `agent-framework` (1311) and
`agent-subagent-runner` (14) pass. Of the four production `session.run()` call sites, three create a
fresh session; `child-process-subagent-worker.ts:163` (`runFollowUp`) reuses one but is serialised
through its `running` promise chain, and `interactive-session-prompt.ts:92-95` is gated by
`execCtrl.executing` on the prompt path (a blocking foreground COMMAND clears that flag
independently — see RUNTIME-005) — so none of them relied on the overwrite.

An earlier draft of this test file was four cases of which **three used a second session** and so
proved nothing about a shared claim, and the fourth failed by a 10s timeout. Both are the
accidental-green/accidental-red shapes HARNESS-052 exists for; they were caught and rewritten before
this landed, and the file records why at its own head.

#### `abort()` no longer frees the session — a review finding, not a design choice

The first draft released the claim inside `abort()`. That looked harmless and was not: `isRunning()`
answered `false` the instant `abort()` returned, while the aborted turn was still unwinding and still
able to write history — so a new `run()` could claim the session and interleave with it. That is the
RUNTIME-003 defect itself, moved behind the abort boundary, and the class doc asserting "only that
caller can release it" contradicted it. The local review caught it before push.

`abort()` now signals only; the owning turn's `finally` releases. A turn is over when it has stopped,
not when it was asked to. Cancel-and-restart is `abort()` → await the turn → `run()`, which is what
every caller in this repo already does. The refusal is a typed, exported `SessionBusyError` rather
than a bare `Error`, because a consumer that has to regex-match a message still needs the busy flag
this change exists to remove.

Five of the eight cases red-prove against the original defect, all on named assertions; the three
that do not (release path, failed-turn path, idle abort) say so at their own definitions.

### P2 — a submission has an identity, and its answer belongs to it (100% of P2; 2 of 3 phases, ~67% of the task)

`submit` returns an `ITurnHandle` (`{ turnId, completed }`). The id is minted when the submission is
ACCEPTED and survives the queue — the drain carries it back as `resumeTurnId` — so one submission is
one identity end to end, rather than an identity that exists only while a turn happens to be running.

The MCP defect is closed and was red-proved at the seam, over the SDK's in-memory transport pair
rather than through the server's private handler map: two concurrent `submit` calls returned the same
text (`expected 'answer to AAAA' to be 'answer to BBBB'`, 321ms, a named assertion). `waitForCompletion`
no longer listens to session-global events at all — it awaits the handle — so the subscribe/cleanup
block is gone from `mcp-server.ts` rather than corrected.

`completed` ALWAYS settles, which took more work than the correlation did. A queued submission is not
promised a turn: the co-drive queue coalesces a same-driver input into the one behind it, drops at
capacity, and discards everything on clear. A handle settling only for submissions that RAN would
hang the rest — worse than the ambiguity it replaces — so each rejects with a typed `TurnNotRunError`
naming which happened. Four cases in `turn-handle-always-settles.test.ts`, each red-proved by
removing its own settle point. They race a 250ms deadline instead of letting the suite time out,
because a hang reported as "timed out" names the harness rather than the defect.

The HTTP half moved to its own change: measuring the TOCTOU the route documented showed it does not
exist, so what came of it is a corrected comment and a labelled regression guard — a documentation
correction rather than a fix, and pairing it with this one made the red-proof floor read a
comment-only edit as an unproven regression test.

`abort()` was left alone deliberately: the queue-clear path rejects waiting handles as `cancelled`
and the RUNNING turn settles through its own `finally` — the same rule P1 landed for `agent-session`,
that a turn is over when it has stopped and not when it was asked to stop.

### P3 — one queue-scoped actor owns DAG advancement (100% of P3; 3 of 3 phases)

`dag-worker` now owns `RunAdvancementCoordinator`: persistent background demand and any number of
run-terminal observers share one actor promise, so only one `WorkerLoopService.processOnce()` can be
in flight for a queue. Observer abort/deadline settles only that observer, query errors retain their
typed result, queue-wide worker errors and throws are handled at the actor boundary, and terminal
stop rejects restart while draining only the current step.

`dag-framework` now owns `IDagExecutionComposition` and exposes `runAdvancement` rather than the raw
worker loop. The legacy `WorkerLoopDriver` and the two manual local/provider loops are removed;
`DagPromptBackend`, `LocalDagRuntimeProvider`, and `dag-cli`'s `LocalDagRunner` all use the same
coordinator contract. Prompt admission and observation promises are tracked at creation, drained in
framework shutdown order, and never float.

The required RED used twelve concurrent public prompt submissions and observed
`maximumConcurrentExecutions: 12` before the fix; it is GREEN at exactly `1`. Coordinator tests cover
continuous plus waiter demand, observer abort and deadline, query result/throw, worker result/throw,
terminal state, and bounded idempotent stop/restart refusal. The AST-based
`scan-run-advancement-owner.mjs` examined 1,891 production TypeScript files and permits exactly the
worker declaration and coordinator call, preventing any of the four former direct drivers from
returning.

Package verification is green: dag-worker 94 tests, dag-framework 132 tests, and dag-cli 1,039 tests,
plus affected typechecks/builds and all three SPEC public-surface scans. Both durable user execution
test scenarios
passed with exit 0 on 2026-08-13 19:43 KST and their exact output is recorded in the linked artifact.
