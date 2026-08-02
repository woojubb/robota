---
title: 'RUNTIME-004: cancellation is declared at four layers and honoured at none'
status: in-progress
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-core, packages/agent-session, packages/dag-core, packages/dag-framework, packages/dag-runtime, packages/dag-worker, packages/dag-orchestration-client
depends_on: []
---

# RUNTIME-004: the signal is accepted at every layer and acted on by none

## Problem

Cancelling does not cancel. In one instance it is silent **and destructive**: aborting a turn during
auto-compaction still clears and rewrites the conversation history. In the DAG stack, a cancelled run
reports cancelled and its queued tasks run to completion anyway.

Cancellation is modelled as an optional parameter on the outermost contract rather than as a value
threaded to the leaf that does the work, so each layer can accept the signal and none can act on it.

## Evidence

Observed independently by **L0 (untyped abort)**, **L1 (compaction)** and **L5 (the whole DAG
stack)**.

- L0 F1 — the abort has no type: `createAbortError()`
  (`execution-round-provider.ts:202-206`) is an unexported bare `Error` with a mutated `name`, so no
  consumer can `instanceof` it and three sites plus the framework copy
  (`interactive-session-execution.ts:46-52`) substring-match instead.
- L1 #7 — `packages/agent-session/src/compaction-orchestrator.ts:91-137`: `compact()` takes no
  `AbortSignal` and the provider call at `:118-129` passes only `{ model }`. After it returns,
  `session-history-ops.ts:49-75` does `clearHistory()` → `injectMessage(system)` →
  `injectMessage(assistant, '[Context Summary]…')`. `session-run.ts:113-130` invokes auto-compaction at
  the head of a turn with the turn's `abortSignal` in scope at `:106` and not passed. The rest of the
  package gets cancellation right (`session-run.ts:195-232`), which makes this an asymmetry rather
  than an omission.
- L5 F4 — declared at four levels, delivered at none:
  `dag-core/src/types/runtime-provider.ts:63` (`signal?: AbortSignal`) and `:132` (`cancelRun`);
  `dag-orchestration-client/src/orchestration-http-contracts.ts:213-265` — `IDagOrchestrationPort`
  has **no cancel method at all**, so the capability is dropped at that boundary;
  `dag-framework/src/http-dag-runtime-provider.ts:215-223` rejects honestly;
  `local-dag-runtime-provider.ts:110-114,281-283` sets a boolean and still runs `processOnce()` in the
  same iteration; `dag-runtime/src/services/run-cancel-service.ts:32-61` writes `dagRun.status` and
  nothing else; `dag-worker/src/services/worker-loop-service.ts:101-155` **never reads
  `dagRun.status`**, so a cancelled run's queued tasks run to completion;
  `dag-core/src/types/node-lifecycle.ts:13-23` — `INodeExecutionContext` carries no signal, so
  `INodeLifecycle.execute` is uncancellable by construction, which
  `dag-worker/src/services/task-timeout-executor.ts:32-34` states plainly as its own limitation.

The cause in one sentence, from the synthesis: _cancellation is modelled as an optional parameter on
the outermost contract rather than as a value threaded to the leaf that does the work, so each layer
can accept the signal and none can act on it._

Cross-reference: L0 F1 is shared with CORE-027 (the failure contract) — the untyped abort is both the
reason cancellation cannot be identified and the reason a provider error containing "abort" is
misclassified as a successful interrupted run. The two Tasks touch the same code at
`execution-round-provider.ts:202-206`.

## Why this is foundational (or not)

**FOUNDATIONAL in all three reports** — L0, L1 and L5 each reached that verdict independently, with
no disagreement recorded.

The synthesis emphasises L1's framing: the rest of `agent-session` gets cancellation right
(`session-run.ts:195-232`), which makes the compaction path _an asymmetry rather than an omission_ —
the signal is in scope at `session-run.ts:106` and simply not passed.

Severity HIGH; the destructive instance (history cleared and rewritten after an abort) is what lifts
it above the other declared-but-unreachable findings.

## Direction

The invariant, from the synthesis's own one-sentence cause: the signal must be **threaded to the leaf
that does the work**, not accepted as an optional parameter at the outermost contract.

Named concrete gaps, in the order the layers fail:

- `INodeExecutionContext` (`dag-core/src/types/node-lifecycle.ts:13-23`) **carries no signal**, so
  `INodeLifecycle.execute` is uncancellable _by construction_ — this is the leaf, and nothing above it
  can be fixed while it stands. `task-timeout-executor.ts:32-34` already states this as its own
  limitation. (This is the same context object ARCH-010 must extend for the execution root.)
- `IDagOrchestrationPort` (`orchestration-http-contracts.ts:213-265`) has **no cancel method at all**,
  so the capability is dropped at that boundary regardless of what either side supports.
- `worker-loop-service.ts:101-155` never reads `dagRun.status`, so
  `run-cancel-service.ts:32-61`'s write has no reader.
- `compaction-orchestrator.ts:91-137` takes no `AbortSignal`; the signal exists at
  `session-run.ts:106` and is not passed to `:118-129`.
- The abort needs a **type** (`execution-round-provider.ts:202-206`), shared with CORE-027.

The synthesis names `http-dag-runtime-provider.ts:215-223` as the one implementation that **rejects
honestly** — that is the behaviour to preserve, not to "fix".

Risk named by the synthesis: `local-dag-runtime-provider.ts:110-114,281-283` sets a boolean and still
runs `processOnce()` in the same iteration, so a fix that only checks the flag at loop entry still
executes one more node after cancellation.

## Test Plan

- **Required red-first regression:** trigger auto-compaction at the head of a turn
  (`session-run.ts:113-130`), abort the turn while `compact()` is in flight, and assert the
  conversation history is **unchanged**. Against current code this must FAIL — `compact()` takes no
  signal and `session-history-ops.ts:49-75` then does `clearHistory()` → two `injectMessage` calls
  regardless.
- Red-first: cancel a DAG run with queued tasks and assert none of them executes
  (`run-cancel-service.ts:32-61` writes; `worker-loop-service.ts:101-155` must read).
- Red-first: cancel during a node's execution and assert the node observes the signal
  (`INodeExecutionContext`, `node-lifecycle.ts:13-23`).
- Red-first: assert `local-dag-runtime-provider.ts:281-283` does **not** run one further
  `processOnce()` after cancellation.
- Assert `IDagOrchestrationPort` exposes cancel, and that
  `http-dag-runtime-provider.ts:215-223`'s honest rejection is preserved where the capability is
  genuinely absent.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Cancelling a turn and cancelling a run are user actions with user-visible consequences,
one of them destructive.

- **Prerequisites:** built `robota` CLI; a provider key. The compaction scenario needs a conversation
  long enough to trigger auto-compaction — achievable by lowering the context threshold in config or
  by a scripted long conversation; the config surface already exists, so no new fixture is needed. The
  DAG scenario needs a multi-node workflow, authored as part of this work.
- **Steps:**
  1. Drive a session until auto-compaction triggers at the head of a turn; press the cancel key
     (Esc/Ctrl-C) while the compaction request is in flight.
  2. Inspect the conversation history in the session (scroll back / `/context`), and reopen the
     persisted session.
  3. Start a multi-node workflow run, cancel it while an early node is executing, then query the run.
- **Expected observable result (after the fix):** in step 2 the prior conversation is intact — it has
  not been cleared and replaced with a `[Context Summary]` message. In step 3 no further node starts
  after the cancel, and the run's terminal status matches what actually ran.
- **Expected observable result (before the fix, for contrast):** in step 2 the history has been
  cleared and rewritten despite the abort; in step 3 the run reports cancelled while its queued tasks
  run to completion.
- **Cleanup:** delete the scratch session and workflow run state.
- **Evidence (fill in after implementation):** before/after history listings for steps 1–2, and the
  run's node-execution record for step 3.

## Implementation — stage 1 of 2

### One premise of this item is already false

**L0 F1 is fixed.** `createAbortError` is still an untyped bare `Error`, but the substring matching
the audit describes is gone: CORE-027 landed `packages/agent-core/src/utils/abort-classification.ts`,
which decides on the caller's own `AbortSignal` and on `error.name === 'AbortError'` (including one
level of `cause`), never on prose. All four sites the audit names now call it — the two in
`agent-core`, and `agent-framework`'s `isAbortError`, which is a one-line delegation with a comment
saying why. There is one owner and no copies. Nothing to do.

That leaves two real halves: the destructive compaction path (L1 #7) — this stage — and the DAG stack
(L5 F4) — stage 2.

### The destructive instance, closed

Verified before changing anything: `compact()` took no signal, called
`provider.chat(…, { model })`, and `session-run.ts` invoked it with the turn's `abortSignal` in scope
and unpassed. So a user who cancelled during auto-compaction got the provider call anyway, and then
`session-history-ops` unconditionally ran `clearHistory()` → re-inject system → inject
`[Context Summary]`. Cancelling did not cancel, and did not leave things alone: it replaced the whole
conversation with a summary the user had asked not to produce.

The signal is now threaded to the leaf — `executeRun` → `ctx.compact` → `Session.compact` →
`compact()` → `provider.chat({ model, signal })` — and checked twice:

- **before** the provider call, so a turn cancelled before it began costs nothing, and
- **after** it returns, where an abort THROWS rather than returning a summary.

Throwing is the load-bearing choice. CORE-019 already established that a compaction which produces an
invalid summary must leave history untouched, and the caller implements that by simply not reaching
the replacement. Throwing on abort puts a cancel on that same existing path instead of adding a second
one.

Self-review caught one thing before pushing: the doc on `compact()` said an abort makes it "return
without touching the history", when it in fact THROWS and propagates. A comment describing behaviour
the code does not have is this repository's most-repeated defect, and it was written while fixing an
instance of the same family. Corrected, and a case now checks the thrown error against `isAbortFailure`
— the one owner of that decision — rather than asserting the classification in prose.

Red-proved six ways, including the chain itself: removing the single `abortSignal` argument at
`session-run.ts` makes the handoff case fail while every leaf case still passes — which is what wiring
only the leaf would have looked like.

### Ratchets

`session.ts` grew because the widened signature reformatted. Rather than trimming comments, the
duplication underneath it was removed: `ICompactContext` and `IRunContext` shared eight fields written
out twice, and the assembly moved to `session-history-ops.ts`, the module that consumes it. The file
fell BELOW its baseline and was re-frozen.

### Remaining — stage 2 (the DAG stack, L5 F4)

Untouched and still true as the audit describes it:

- `IDagOrchestrationPort` has no cancel method, so the capability is dropped at that boundary.
- `local-dag-runtime-provider` sets a boolean and still runs `processOnce()` in the same iteration.
- `run-cancel-service` writes `dagRun.status` and nothing else, and
  `worker-loop-service` never reads it — so a cancelled run's queued tasks run to completion.
- `INodeExecutionContext` carries no signal, so `INodeLifecycle.execute` is uncancellable by
  construction; `task-timeout-executor` says so about itself.

That is a contract change across four packages and is not folded into a change whose subject is one
destructive path in another.
