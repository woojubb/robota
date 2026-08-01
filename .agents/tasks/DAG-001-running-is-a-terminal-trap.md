---
title: 'DAG-001: `running` is a terminal trap — the DAG subsystem has no crash-recovery path at the contract level'
status: todo
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
