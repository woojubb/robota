---
title: 'DAG-003: `FileStoragePort` persists only definitions, so the crash recovery built on top of it has nothing to recover from'
status: todo
created: 2026-08-02
priority: high
urgency: next
area: packages/dag-adapters-local, packages/dag-core
depends_on: []
---

# DAG-003: a file-backed adapter whose runs are in memory

## Problem

`FileStoragePort` writes DAG **definitions** to disk and holds **runs** and **task runs** in plain
in-memory `Map`s with no file I/O at all. Its SPEC row says "File-based JSON storage for DAG
definitions, runs, and tasks".

The consequence lands on DAG-001. That task's whole second half — the idle sweep — exists for
"a queue without redelivery", framed around the sqlite/file path. Against this adapter a real process
crash loses the `status` and `leaseUntil` the sweeper reads, so there is nothing left to sweep. Only
`SqliteStorageAdapter` gets crash-durable recovery; the file adapter gets a recovery path with no
durable state under it.

## Evidence

Found by the CI review of PR #1600 (DAG-001), which read the adapter rather than its SPEC row.
Re-verified here:

- `packages/dag-adapters-local/src/file-storage-port.ts:53-75` — `saveDefinitionAtomically` /
  `readDefinitionFromFile` are the only file I/O. `writeFile` appears once, for definitions.
- Same file, `:140-152` — `createDagRun` / `getDagRun` / `listDagRuns` operate on `this.dagRuns`, an
  in-memory `Map`. Task runs are the same.
- `packages/dag-adapters-local/docs/SPEC.md:29` claims definitions, runs **and tasks**.
- DAG-001 introduced `packages/dag-adapters-local/src/task-run-recovery.ts` whose own comment says the
  file adapter "holds their task runs the same way" as the in-memory adapter — i.e. not persisted. The
  fact was written down in the same change that depended on the opposite being true.

**Pre-existing, not introduced by #1600.** The adapter has always been this way; DAG-001 is what made
the gap matter, by building a durability-shaped feature on top of it.

## Why this is foundational (or not)

**FOUNDATIONAL.** No caller can fix it: the durability is either in the adapter or nowhere. And the
defect is the familiar shape — a SPEC row asserting a property the code does not have, where the
claim is what stops the next reader checking. DAG-001 hit that class five times in its own diff and
landed `scan-authority-bypass` for one instance of it; this is another, in prose rather than code.

## Direction

Three admissible answers. The second is probably right, but the decision is not made here.

1. **Persist runs and task runs**, matching the SPEC row. Straightforward for definitions' atomic
   write-and-rename; needs a decision about write frequency, since a task-run status changes several
   times per task and this adapter is the "local, no database" tier.
2. **Correct the contract**: rename or re-document it as definition-durable only, and say plainly that
   run state does not survive a restart. Then DAG-001's SPEC must stop naming the file path as one of
   the sweeper's two target adapters.
3. **Retire it** in favour of `SqliteStorageAdapter` if nothing needs a database-free durable tier.

Whichever is chosen, `dag-worker`'s SPEC § Crash Recovery must end up describing what each adapter
actually guarantees, rather than one sentence covering both.

## Test Plan

- **Required red-first regression:** write a task run through `FileStoragePort`, construct a NEW
  instance over the same directory, and assert the task run is readable. Against current code this
  FAILS — the second instance starts with an empty `Map`. Prove it fails before the fix.
- Red-first for the recovery claim: the same round-trip for `status` and `leaseUntil` specifically,
  since those are what `listStaleRunningTaskRuns` reads.
- If the decision is (2) or (3), the regression is the SPEC one: the adapter's row and `dag-worker`'s
  § Crash Recovery must not claim durability for state that is in memory.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies** if the decision is (1). Killing a worker mid-run and restarting it against a file-backed
store is user-observable: the run either resumes or does not.

- **Prerequisites:** the CLI with the local file storage tier, a two-node workflow.
- **Steps:** start a run, kill the process mid-node, restart, query the run.
- **Expected observable result (after the fix):** the run's state survives and the abandoned task is
  recovered.
- **Expected observable result (before the fix, for contrast):** the run is simply gone — not stuck,
  not failed, absent.
- **Cleanup:** delete the store directory.
- **Evidence (fill in after implementation):** the run listing before the kill and after the restart.
