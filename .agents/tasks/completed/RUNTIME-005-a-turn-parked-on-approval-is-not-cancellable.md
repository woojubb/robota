---
title: 'RUNTIME-005: a turn parked on a human-approval prompt cannot be cancelled, and the framework flag that hides it has no owner'
status: done
created: 2026-08-02
completed: 2026-08-13
priority: high
urgency: next
area: packages/agent-session, packages/agent-core, packages/agent-framework
depends_on: []
---

# RUNTIME-005: abort() reaches the provider but not the wait

- **Branch**: `fix/runtime-005-execution-claim-owner`
- **Spec**: `.agents/spec-docs/done/BEHAVIOR-008-interactive-execution-claim-ownership.md`

## Current scope correction

The original `/compact` reproduction below is historical. Current
`InteractiveSessionBase.executeCommand()` rejects a public command while `execCtrl.executing` is
true, and all shipped TUI/HTTP/MCP/WebSocket command paths use that method. Stage 2 completed the
preventative invariant hardening: prompt, fork-skill, foreground-command, and queue-resume paths now
share one controller-owned opaque claim while preserving current public busy/queue policy. Stage 1
also completed the requested full `Session.run()` abort integration proof and stale SPEC correction.

## Plan

- [x] TC-01: Preserve public command-during-prompt busy rejection and exact queued-turn settlement.
- [x] TC-02: Make foreign or stale execution-claim release unable to clear state or drain the queue.
- [x] TC-03: Route prompt, fork-skill, foreground-command, and queue-error cleanup through one claim owner.
- [x] TC-04: Add bounded full-session approval-abort settlement and `isRunning() === false` integration proof.
- [x] TC-05: Execute the durable public scenario and pass affected/full verification.

## Problem

`abort()` cancels a turn by signalling it. Two waits inside a turn do not observe that signal, so a
turn parked on either of them runs until the wait resolves on its own — which, for a human-approval
prompt, may be never.

Since RUNTIME-003 the session's claim is held until the turn unwinds (correctly — a turn is over when
it has stopped, not when it was asked to). The consequence is that an uncancellable wait now makes
the session permanently busy rather than silently interleaving, which is a better failure but still a
failure the caller cannot clear except by discarding the session.

## Evidence

Found by the independent review of RUNTIME-003 P1 (#1598), which probed the leak paths rather than
taking the suite's colour as an answer.

- `packages/agent-session/src/permission-enforcer.ts:253-275` awaits a consumer-supplied
  `permissionHandler` / `promptForApprovalFn` with **no abort signal and no timeout**.
- `packages/agent-core/src/.../tool-execution-batch.ts:140,215` checks `signal.aborted` only BEFORE
  starting each tool, so a tool already running is not cut.
- NOT affected, verified in the same pass: a provider that hangs and ignores the signal IS cut, by
  agent-core's `handleUpstreamAbort` → `failWith` (`execution-round-provider.ts:159-161`).

The compensating guard lives one layer up: `agent-framework` calls `promptRegistry.drain()` before
`session.abort()`. A direct `agent-session` consumer has no equivalent — the same
guard-above-the-library shape RUNTIME-003 was filed to remove.

A second, related instance in the same layer:
`packages/agent-framework/src/interactive/interactive-session-execution-controller.ts:419-441` —
`executeForegroundCommand` sets `executing = true` with no guard and clears it in its `finally`, then
drains the pending queue. A blocking foreground command (`/compact`) typed during a running turn is
routed straight through `TuiInteractionChannel.handleInput:400-405` with no `executing` check, so it
clears the flag while the prompt turn still holds the session claim; the drained queue head is then
`shift()`ed and its `submit` hits `SessionBusyError`. The queued input is consumed and dropped with an
`Error:` history entry (handled — `interactive-session-prompt.ts:140-159`). Strictly better than the
interleaved turn it replaces, but the flag has two writers and no owner.

## Why this is foundational (or not)

**FOUNDATIONAL** for the wait: cancellation is declared at the session boundary and not honoured by
the waits inside it, so no fix at the call site can be complete. Same class as
[RUNTIME-004](../RUNTIME-004-cancellation-declared-at-four-layers-honoured-at-none.md) — check whether
these should merge before starting.

The `executing` flag is **LOCAL** to `agent-framework` but has the ownership shape RUNTIME-003
addressed one layer down.

## Direction

Thread the turn's `AbortSignal` into every wait a turn can park on: the approval prompt (reject the
wait when the signal fires, so the turn unwinds and releases its claim) and the in-flight tool
(observe the signal during execution, not only before it). Give the `executing` flag a single writer.

Do NOT "fix" this by reverting the RUNTIME-003 semantic — releasing the claim inside `abort()` is what
lets a live turn interleave with its successor, which is the defect, not the remedy.

## Test Plan

- Red-first: a session whose `permissionHandler` never resolves, aborted; assert the turn rejects and
  `isRunning()` returns to `false` within a bounded time. Against current code this hangs — assert on
  a raced outcome, never on a suite timeout.
- Red-first: a tool already executing when `abort()` fires is cut, not merely not-started.
- Red-first: a blocking foreground command typed during a running turn does not consume the queued
  input.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

### Scenario 1 — abort a parked approval and run the next prompt

- **Agent executability:** `agent-executable`. This non-interactive flow drives the public framework
  testing SDK with the shipped deterministic provider; it requires no credential, network service,
  TTY, test runner, or owner action.
- **Durable artifact:**
  [`.agents/evals/scenarios/runtime-005-approval-abort-agent-run.md`](../../evals/scenarios/runtime-005-approval-abort-agent-run.md)
- **Prerequisites:** run from the repository root with workspace dependencies installed; Bash,
  Node.js, and pnpm available; writable `scratch/src/`. No provider key or external service is
  required.
- **Bounded waits:** the script races every permission, submission, command, turn-settlement,
  queue-settlement, next-prompt, and cleanup await against 5 seconds.
- **Exact Bash:** execute the complete command block under `## Exact Bash` in the durable artifact
  verbatim. It materializes `scratch/src/runtime-005-approval-abort-agent-run.ts`, runs
  `pnpm --dir scratch run run -- src/runtime-005-approval-abort-agent-run.ts`, and asserts every
  observable with exact `grep -F` checks.
- **Expected output and exit:** exit `0` and one JSON line containing
  `"phase":"runtime-005-approval-abort-recovery"`, `"permissionRequests":1`,
  `"busyRejected":true`, `"queuePreservedUntilAbort":true`,
  `"queuedOutcome":"cancelled"`, `"abortedTurnSettled":true`, `"idleAfterAbort":true`,
  `"pendingAfterAbort":0`, `"deniedToolRan":false`, and
  `"nextResponse":"NEXT_PROMPT_OK"`. This proves a public command preserves the existing busy
  refusal and queue, abort fail-closes and settles the parked approval turn, and the same session
  accepts and completes the next prompt.
- **Cleanup:** the fixture shuts down its session and deletes its isolated workspace; the Bash
  `EXIT` trap removes the scratch script and only its `/tmp/robota-runtime005.*` root.
- **Observed evidence:** PASS — 2026-08-13. The artifact's exact Bash exited `0`; its recovery JSON
  reported one permission request, busy refusal with queue preservation, cancelled queued turn,
  settled abort, idle/empty state, no denied-tool execution, and `NEXT_PROMPT_OK`. Cleanup passed.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-13

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — DONE-GATE-STAGE-1 is an entry gate with no predecessor; the scenario and linked
  durable artifact exist before BEHAVIOR-008 implementation source edits, while observed execution
  evidence remains `EMPTY` as required at PLAN time.
- Scenario `abort a parked approval and run the next prompt`: PASS — it records the explicit
  `agent-executable` decision, repository-root prerequisites, the exact Bash invocation through the
  linked durable artifact, 5-second bounds for every asynchronous permission/submission/command/turn/
  queue/next-prompt/cleanup await, exact JSON substrings plus exit `0`, constrained cleanup, and its
  separate `Observed evidence: EMPTY` field.
- Invocation plausibility: PASS — `scratch/package.json` provides the declared `pnpm --dir scratch run
run -- <script>` entrypoint, and `@robota-sdk/agent-framework/testing` publicly exports
  `scriptedSession`; the script drives the real exported `InteractiveSession` submit, permission event,
  busy-command, pending-queue, abort, turn-handle, and disposal surfaces.
- Product surface: PASS — the observable is public SDK workflow behavior (busy refusal without queue
  loss, fail-closed approval abort, turn settlement, idle recovery, and same-session next-prompt reuse),
  not build, test, typecheck, lint, harness/CI output, or repository-text inspection.
- Credentials and services: PASS — the prerequisites explicitly state that the deterministic shipped
  provider needs no provider key, network service, TTY, or owner action.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-13

**Status upgrade:** scenario written → scenario executed

- Ordering: PASS — `[DONE-GATE-STAGE-1]` passed before implementation; commit `01e2761a2` records
  the scenario with `Observed evidence: EMPTY`.
- Scenario `abort a parked approval and run the next prompt`: PASS — the durable artifact's exact
  Bash was independently executed against the completed implementation and exited `0`.
- Observed result: PASS — one permission request, busy refusal, queue preservation until abort,
  cancelled queued turn, settled aborted turn, idle/empty recovery, no denied-tool execution, and
  `NEXT_PROMPT_OK`.
- Evidence location: `.agents/evals/scenarios/runtime-005-approval-abort-agent-run.md` and this
  task's scenario evidence field.
- Cleanup: PASS — the materialized scratch script and constrained `/tmp/robota-runtime005.*` root
  were removed.

## Implementation — stage 1 of 2

### The approval wait, closed

`promptForApproval` awaited a consumer-supplied handler with no signal and no timeout, exactly as the
finding says. The turn's signal already reaches the tool wrapper as `context.signal` (CORE-018) and
stopped there, so the fix is a thread, not a new channel: wrapper → `checkPermission` → the wait.

Cancelling **denies**. That is the load-bearing choice, not a detail: if a cancelled approval read as
approval, aborting a turn would become a way to run an unapproved tool. Denial is also the answer the
enforcer already gives when no approver is attached, so the fail-closed path is one path rather than
two.

Red-proved eight ways, and every case RACES against a timer. The task asks for that explicitly and it
matters: the first draft of the deny case awaited outright and took the suite's 10-second timeout with
it, which proves only that something was slow. Two of the eight go through the tool wrapper, because
wiring `checkPermission` alone would have left the defect exactly as it was — removing the wrapper's
one argument still fails that case while every enforcer-level case passes.

### One correction to the finding

**A running tool IS given the signal.** `tool-execution-batch.ts` checks `signal.aborted` before
starting, as the finding says — but it also passes `createExecutionContext(request,
batchContext.signal)`, so a tool that honours its `context.signal` is cut mid-flight. CORE-018 makes
that the tool's obligation in as many words: "Long-running tools MUST honor it … Completing silently
after an abort is a contract violation."

So the gap is not a missing channel; it is that nothing verifies tools honour it. That is a different
item with a different shape (a conformance check over tool implementations), and it is not folded in
here.

### The size ceiling, and where it put the seam

The enforcer passed its frozen size, so the approval path moved to `abortable-approval.ts`. The seam
is real rather than convenient: that module decides whether a human said yes; the enforcer decides
whether a human is asked at all. Side effects come back as flags, so the enforcer keeps ownership of
its own allow lists.

It also removed a duplication that was there before this change: both prompt paths interpreted
`allow-session` / `allow-project` in their own copy. Two readings of "does this answer grant
permission" that can drift, now one.

### Remaining — stage 2

- **The `executing` flag has three writers and no owner**
  (`interactive-session-execution-controller.ts:274/385/423`), which is the LOCAL half of this item
  and untouched. Verified still true.
- **Tool cooperation with the signal is unverified.** The channel exists; nothing checks that
  long-running tools use it, and the CORE-018 contract is prose. Worth its own item rather than a
  sentence here.

## Implementation — stage 2

`SessionExecutionController` now derives `executing` from one private opaque claim. Prompt,
fork-skill, and foreground-command entry points acquire synchronously before their first state
mutation; only the identical claim may release, emit idle state, persist, and hand the pending queue
to its next turn. Queue-resume error handlers no longer clear another operation's state. A prompt
that cannot acquire also rejects the already-issued turn handle, so no caller waits forever.

Existing tests that directly wrote the boolean now hold a real foreground claim. The focused claim
suite proves stale-release rejection, mutual exclusion across all three kinds, and failed-acquisition
turn settlement. The real `Session.run()` integration parks on a never-resolving permission handler,
aborts, observes an `AbortError`, verifies `isRunning() === false`, and proves the unapproved tool did
not execute. The durable public scenario passed with exit `0` and the expected recovery JSON.
