---
title: 'RUNTIME-005: a turn parked on a human-approval prompt cannot be cancelled, and the framework flag that hides it has no owner'
status: in-progress
created: 2026-08-02
priority: high
urgency: next
area: packages/agent-session, packages/agent-core, packages/agent-framework
depends_on: []
---

# RUNTIME-005: abort() reaches the provider but not the wait

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
[RUNTIME-004](RUNTIME-004-cancellation-declared-at-four-layers-honoured-at-none.md) — check whether
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

**Applies.** Pressing ESC while a permission prompt is open is a user-reachable path.

- **Prerequisites:** built `robota` CLI, a provider key, permission mode that prompts.
- **Steps:** ask for an action that triggers an approval prompt; press ESC instead of answering; then
  submit a new prompt.
- **Expected observable result (after the fix):** the turn ends and the next prompt runs.
- **Expected observable result (before the fix, for contrast):** the session reports busy and refuses
  the next prompt until it is discarded.
- **Cleanup:** none.
- **Evidence (fill in after implementation):** transcript excerpt.

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
