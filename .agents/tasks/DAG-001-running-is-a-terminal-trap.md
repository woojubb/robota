---
title: 'DAG-001: `running` is a terminal trap — the DAG subsystem has no crash-recovery path at the contract level'
status: in-progress
created: 2026-08-02
priority: critical
urgency: now
area: packages/dag-core, packages/dag-worker, packages/dag-runtime, packages/dag-adapters-local
depends_on: []
---

# DAG-001: dag-core owns the three things a recovery path needs, and none of them can express recovery

## Problem

A worker that dies mid-node leaves its task and its run in `running` **forever**. The failure is
silent and permanent. On the one adapter that _does_ redeliver the message, recovery is **guaranteed
to fail** — the redelivered task hits a transition the state machine does not contain, errors, and is
acked and dropped.

The run lifecycle is total on the happy path and silently partial on crash.

## Evidence

**Layer: L5 (DAG) only** — no other auditor's scope reaches `dag-core`. L5 F1 rests on four
independent facts:

- `packages/dag-core/src/state-machines/task-run-state-machine.ts:23-34` — the transition table has
  no `running:RECLAIM`, no `running:EXPIRE`, no `running → queued` at all.
- `packages/dag-core/src/interfaces/ports.ts:89-117` — `IStoragePort` has no query that can _find_ a
  stale task.
- `packages/dag-core/src/types/domain.ts:186-187` — `ITaskRun.leaseOwner?` / `leaseUntil?` exist and
  **nothing ever writes them**; the sqlite adapter copies them at INSERT
  (`sqlite-storage-adapter.ts:245-246`) from a record that never has them set. Ghost columns.
- `ILeasePort.renew` (`ports.ts:80-84`) has **zero callers**; the worker acquires at
  `worker-loop-service.ts:84-88` and releases in `finally` at `:97`.

Traced consequence: `finalizeDagRunIfTerminal` (`dag-run-finalizer.ts:15,56`) treats `running` as
pending and returns early forever. On the in-memory queue the message _is_ redelivered
(`in-memory-queue-port.ts:71-82`) — and recovery still fails, because it hits `transitionToRunning`
(`worker-loop-service.ts:161`) → `transition('running','START')` → not in the table → error →
`failAfterAck` (`:119`) acks and drops it.

The synthesis re-verified, read-only: the transition table is exactly the ten entries reported, with
no `running → queued`; `ILeasePort.renew` has callers only in
`dag-adapters-local/src/__tests__/testing-ports.test.ts`.

The cause in one sentence, from the synthesis: _`dag-core` owns the state machine, the persistence
port and the lease port — the three things a recovery path needs — and none of them can express
recovery, so the run lifecycle is total on the happy path and silently partial on crash._

## Why this is foundational (or not)

**FOUNDATIONAL — `dag-core`.** The synthesis is unambiguous: the defect is in the contracts
`dag-core` owns, not in any adapter. No adapter can add recovery, because the state machine has no
transition for it, the storage port has no query to find a stale task, and the lease fields are never
written by anything.

The synthesis rates it **BLOCKER** on the grounds that the failure is silent _and_ permanent.

The synthesis also carries a related caution about L5's scope (correction 8): L5's broader "the DAG
subsystem is not layered" observation _should not be read as a defect on its own_ — a hub-and-spoke
with one composition root is a legitimate ports-and-adapters shape. The defect L5 actually
establishes, and which the synthesis agrees with as stated, is narrower: **the flat graph plus a core
that under-specifies the cross-spoke contracts**, which is what produces this finding (F1) along with
F3 and F9.

## Direction

No full remediation design is chosen in the synthesis. What it does establish is the exact shape of
the gap — a recovery path needs three things, and `dag-core` owns all three and none of them works:

1. **A transition.** `task-run-state-machine.ts:23-34` has no `running:RECLAIM` / `running:EXPIRE` /
   `running → queued`. Without one, redelivery cannot succeed even where it happens.
2. **A query.** `IStoragePort` (`ports.ts:89-117`) has no way to _find_ a stale task.
3. **A written lease.** `ITaskRun.leaseOwner` / `leaseUntil` (`domain.ts:186-187`) exist and are ghost
   columns; `ILeasePort.renew` (`ports.ts:80-84`) has zero production callers.

The synthesis lists the lease fields and `renew` under its theme T2 — _a declared seam must be
reachable from the construction path the product actually uses, and a capability that cannot fire
must not be recorded as delivered_ — so "delete them" and "make them load-bearing" are both
admissible answers to that half; the synthesis does not choose.

Risk it names: the in-memory queue **already redelivers** (`in-memory-queue-port.ts:71-82`), so a
partial fix that adds a lease without adding the transition leaves the redelivery path still ending
in `failAfterAck` (`worker-loop-service.ts:119`) — acked and dropped, which is worse than not
redelivering, because the message is now gone.

## Test Plan

- **Required red-first regression:** enqueue a task, take it to `running`, kill/abandon the worker
  without completing it, and assert the task is reclaimed and the run reaches a terminal state.
  Against current code this must FAIL — the redelivered message hits
  `transition('running','START')`, which is not in the table, and is acked and dropped by
  `failAfterAck` (`worker-loop-service.ts:119,161`).
- Red-first: assert `finalizeDagRunIfTerminal` (`dag-run-finalizer.ts:15,56`) can finalize a run whose
  only non-terminal task was abandoned. Today it returns early forever.
- Red-first: assert `leaseOwner`/`leaseUntil` are actually written for a task in flight
  (`domain.ts:186-187`, `sqlite-storage-adapter.ts:245-246`) — or, if the decision is to remove them,
  assert they are gone from the domain type and the adapter.
- A conformance test run against **both** queue adapters, since only one redelivers today.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** A workflow run that never terminates is user-visible on the workflow surface.

- **Prerequisites:** built `robota` CLI with the workflow/DAG surface available, and a workflow
  definition with at least two nodes. A minimal two-node workflow fixture is needed; the workflow
  authoring surface already exists, so the fixture is authored as part of this work.
- **Steps:**
  1. Start a workflow run through the product's workflow surface.
  2. While a node is executing, terminate the worker process (simulating a crash).
  3. Restart the worker and query the run's status through the same surface.
- **Expected observable result (after the fix):** the abandoned task is reclaimed and re-executed (or
  the run is failed explicitly); the run reaches a terminal status and reports it.
- **Expected observable result (before the fix, for contrast):** the run and its task stay `running`
  indefinitely; the status query never changes, and on the redelivering adapter the task is silently
  dropped.
- **Cleanup:** delete the run's state/store artifacts created by the scenario.
- **Evidence (fill in after implementation):** the status output before the kill, after the restart,
  and at terminal state, with timestamps.

## Progress

### Complete — all three gaps closed (100% of the contract work; the two red-first regressions in the Test Plan pass)

The audit named exactly three things a recovery path needs, all owned by `dag-core`, none of which
worked. All three now do.

**1. The transition.** `running --RECLAIM--> queued` in `task-run-state-machine.ts`. The event's doc
states the precondition the state machine cannot itself check — a caller may only issue it once it has
established the previous owner is gone — so a second caller cannot be added that skips it.

**2. The query.** `IStoragePort.listStaleRunningTaskRuns(asOfIso)`, implemented in all four
implementations (in-memory, file, sqlite, and the dag-core test double). A `running` task with NO
lease recorded counts as stale, deliberately: one orphaned before its lease was written has the least
evidence and would otherwise be exactly the task left stuck forever.

**3. The written lease.** `IStoragePort.setTaskRunLease` is the writer `ITaskRun.leaseOwner` /
`leaseUntil` never had. The sqlite `lease_owner` / `lease_until` columns have existed since the first
migration and the INSERT has always copied them — from a record nothing ever set. Ghost columns, now
load-bearing.

**Two recovery paths, because only one queue adapter redelivers.**

- On redelivery: `claimTaskForExecution` (`task-lease-recovery.ts`) reclaims a task already `running`. Safe
  precisely there — it is reached only after `lease.acquire` SUCCEEDED, so a live owner's duplicate
  delivery is nacked before it gets there.
- On idle: `sweepStaleTaskRuns` (new, `dag-worker`), called from `processOnce`'s idle branch. That is
  the one point all three loop drivers the audit found go through, so wiring it into any single driver
  would have left the others without recovery. Throttled to once per `leaseDurationMs` — a lease
  cannot expire faster than that, and the driver's 25ms idle floor would otherwise mean forty storage
  queries a second per worker.

**A bug this fix could easily have introduced, and does not.** Lease expiry is derived from the time a
task is ALLOWED to run, not from `leaseDurationMs`. That option bounds how long a worker may hold the
distributed lock; execution is bounded by the task's own `timeoutMs`, and the two are unrelated. Using
the lock duration would let the sweeper reclaim a task that is still legitimately running — executed
TWICE, worse than the trap being fixed. Pinned by its own case.

**`ILeasePort.renew`: REMOVED.** The synthesis allowed either "delete" or "make load-bearing" and did
not choose. It is deleted, because the design that would need it is a heartbeat and this is not that
design — lease expiry is known up front. Its only callers anywhere were three tests, which is how a
seam nothing could reach stayed green; the port records what would justify bringing it back. Keeping
it on "we might need it later" is the argument that produced the ghost lease columns this same task
had to fix.

**Red-proof.** Removing the single `RECLAIM` table entry: 9 of 16 cases fail on named assertions
(`expected [] to deeply equal [ 'task-run-1' ]`, `expected 'running' to be 'success'`,
`expected 'dead-worker' to be undefined`, …). Removing the `sweepIfDue()` call alone fails the
reachability case (`expected 'running' to be 'queued'`) — the sweep is wired, not merely written. The non-provers are the guards: live lease, live long-running task, nothing-stale, and the idle no-op.

Whole workspace green: build, typecheck, every package's test suite. `spec-public-surface` passes and
`dag-worker` leaves the burn-down entirely (4 undocumented → 0) — its Public API section was a bullet
LIST, which the scan cannot read, so every export in it counted as undocumented; converting it to a
table made the existing documentation visible. Baseline re-frozen in the same change.

### Remaining

**User Execution Test Scenarios.** The scenario is written against the product's workflow surface with
a real worker process killed mid-node. The contract-level regressions are covered here; the
end-to-end kill/restart scenario needs the two-node fixture the scenario itself calls for, and is not
expressible in-process — a real mid-node kill is a separate process. Tracked as the remaining item on
this task.

### Review round — three MUSTs, all measured, all real

An independent review probed the first draft rather than reading it, and found that it made things
**worse than the trap it replaced**. All three are fixed and each red-proves on its own assertion.

1. **The lease was not held during execution.** `return this.processAcquiredMessage(message)` inside
   `try/finally` runs the `finally` at the RETURN STATEMENT, not when the promise settles — so the
   lease was released one microtask in. The entire "a live owner still holds its lease" safety
   argument, stated in four places, was false: the probe measured `executions: 2` at HEAD against 1
   on `develop`. One missing `await`. The existing guard case could not catch it because it acquires
   the lease EXTERNALLY and so never exercises the worker's own hold; the new case observes the lease
   from inside the executor.
2. **The lease was acquired for the lock duration, not the task's runtime.** Real configs pair
   `leaseDurationMs: 60_000` with `defaultTimeoutMs: 300_000`, so the lease expired mid-execution and
   the visibility timeout redelivered to a worker that could then acquire — reclaiming a task still
   running. Removing `renew` had closed the only mechanism that could have extended it. Ownership is
   now one bound (`taskOwnershipMs`) used for both the lock and the recorded `leaseUntil`.
3. **The sweeper resurrected CANCELLED runs.** `RunCancelService.cancelRun` updates only the run,
   leaving tasks `running`, so cancelling and waiting silently re-executed the node the user
   cancelled. Cancel has to mean stop; such tasks are now marked `cancelled`.

Also from that round: the lease is written BEFORE the status (two non-atomic writes, and a sweep in
the gap saw `running` with no lease and reclaimed a task that was STARTING); the attempt is
incremented on reclaim and a task out of attempts is failed with `DAG_TASK_ABANDONED`, since without
it a task that kills its worker was swept and re-run forever with `maxAttempts` never applying; the
sweep returns what it did rather than a count, so a sweep that moves nothing is observable; and the
throttle advances its clock AFTER the sweep, so a throwing sweep no longer suppresses recovery for a
full lease duration.

### Second review round — three more, all measured

The same reviewer probed the fixes rather than reading them, and found the first round had left two
hazards open and one fix unguarded.

- **Two idle workers swept the same task concurrently.** Both requeued it, the attempt went 1 → 3 so a
  healthy task would be failed well before `maxAttempts`, and both messages carried the IDENTICAL id —
  which on the sqlite queue is a `TEXT PRIMARY KEY`, so the second insert threw. That throw escaped
  `sweepIfDue` and `processOnce` into `WorkerLoopDriver.runLoop`, whose promise is only `.catch`ed in
  `stop()`: an unhandled rejection and a dead worker. The sweeper now takes the same `ILeasePort`
  lease a worker takes, the message id is keyed on the ATTEMPT rather than the clock, and a sweep
  failure is RETURNED as a `processOnce` error instead of thrown.
- **The lease-before-status ordering had no test.** Swapping the two writes back left all 16 cases
  green — measured. Every other fix red-proved; this one did not, so a refactor could have
  reintroduced it silently. There is now a case that sweeps in the window between the two writes.
- **`DAG_TASK_ABANDONED` was not in the SPEC's error registry** and did not follow the naming of the
  three codes in its own category. Renamed `DAG_TASK_EXECUTION_ABANDONED` and listed, along with
  `DAG_TASK_SWEEP_FAILED`.

Also taken: the requeued message now carries the INCREMENTED attempt, matching storage — they
disagreed by one and `handleRetry` reads the message's, so the sweeper's bound was reached before the
message-driven one.

### CI review round — the trap moved one level up

`Claude review` on the PR read the sweeper's terminal writes against the paths that already existed
and found the one thing two probing rounds had not:

**The abandoned branch never finalized the run.** Every other path that terminates a task
(`handleSuccessPath`, `handleTerminalFailure`) also calls `finalizeDagRunIfTerminal`, because a run
only leaves `running` once its last task is terminal. Writing the task's status and stopping meant a
swept task that was the run's LAST pending one left the run stuck forever — the same terminal trap
this task exists to close, moved from the task to the run. And the sweeper's tests asserted only the
task's status, so it was accidental-green on exactly that axis. Both terminal branches now go through
one `finishTask` helper that finalizes.

Also from that round: a failed `queue.enqueue` left the task `queued` with an incremented attempt, no
message, and nothing that could find it again — `listStaleRunningTaskRuns` only looks at `running`, so
the recovery path had its own unrecoverable state. It now puts the task back to `running` before the
failure surfaces. And the `cancelled` write went through a string literal rather than the state
machine, in a change whose own comment argues the table must stay the single place legal transitions
live.

### Second CI review round — the recovered task ran with no input

The sweeper sent `payload: {}` on a claim I wrote into its own doc comment: that the worker reloads
its execution context from storage. **The claim was wrong.** `loadWorkerExecutionContext` reloads the
run, the definition and the node definition; `buildExecutionInput` reads `input: message.payload`
straight off the message. So every task recovered through the sweep — on exactly the adapters the
sweeper exists for — would have re-executed with an empty input.

Worse in a way that loops back on this task: the per-node `timeoutMs` rides the same payload, so a
custom timeout silently dropped to `defaultTimeoutMs`. When the real timeout is the longer of the
two, that reopens the double-execution race the ownership bound was added to close.

The input was available all along on `taskRun.inputSnapshot`, written by `claimTaskForExecution` at
the first claim, and simply never read back. It is now restored, with an unparseable snapshot treated
as absent rather than throwing — one corrupt row must not stop a sweep, and a task re-run with no
input is a visible failure while a sweep that never runs is not.

Also from that round: a single throwing `sweepOne` aborted the whole pass. Per-task failures are now
collected in the outcome and the pass continues; the throttle still surfaces the first one as the
loop's error, so nothing is swallowed.

**A note on this Task's own record.** Four review rounds found nine, three, and one finding
respectively, and the pattern held: every round found something the previous round's fix had created
or left. Three of those were cases where a comment I wrote asserted a property the code did not have
— the lease being held during execution, the state machine being the single place transitions live,
and the worker reloading its payload. Writing the claim down did not make it true, and in each case
the claim was what stopped the next reader (me) from checking.

Fifth round, one SHOULD: `dagRun === undefined` — the parent run record is MISSING — was folded into
the same branch as "the run finished". `deleteDagRun` does not cascade to task runs in any of the
three adapters, so a retention job can leave exactly that, and reporting it as a routine abandonment
is how a referential-integrity bug stays invisible. It now has its own `orphaned` bucket and its own
error code, and the file's `parseInputSnapshot` fallback — which IS deliberate — carries the
`allow-fallback` marker this branch did not.

Sixth round, one SHOULD, and the sharpest of them: the reclaim path's four writes were still ordered
status-first, so **a sweeper that died mid-sequence** left the task `queued` with no message — and
the query only looks at `running`. DAG-001's own trap, reintroduced inside the recovery path, in code
whose entire subject is that processes die at inconvenient moments. The order is now: advance the
attempt, enqueue, set `queued`, clear the lease — so the task remains findable until a message
provably exists. The existing test simulated only a synchronous throw and did not cover the crash
window; there is now a case for both sides of the enqueue.
