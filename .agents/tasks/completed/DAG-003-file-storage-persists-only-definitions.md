---
title: 'DAG-003: `FileStoragePort` persists only definitions, so the crash recovery built on top of it has nothing to recover from'
status: done
completed: 2026-08-03
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
- **Evidence:** agent-run. A process writes a run and a leased task run, then `SIGKILL`s itself; a
  second process opens the same directory.

  ```
  BEFORE the fix
    runs after restart      : (none)
    sweeper finds abandoned : (none)

  AFTER
    runs after restart      : run-crash=running
    sweeper finds abandoned : task-crash
  ```

  The "before" column is the same two commands against the previous adapter, produced by stashing the
  change and rebuilding. Not stuck, not failed — absent, exactly as this task predicted. On disk
  afterwards: `runs/dag-runs.json` and `runs/task-runs.json`.

## Implementation

### One premise was already stale, and it changes what was left to do

The task quotes the SPEC row as claiming "definitions, runs, and tasks". It does not — it was
corrected during DAG-001's review rounds and already read "**definitions only** — runs and task runs
are in-memory and do NOT survive a restart (DAG-003)". `dag-worker`'s § Crash Recovery had the
matching caveat. So the prose half of the finding, the "claim that stops the next reader checking",
was closed before this change started.

That left the actual decision the task deferred. Option **1** — persist runs and task runs — is the
right one, and usage decides it rather than taste: `FileStoragePort` is the DEFAULT storage in
`createDagFramework`, and both `dag-runtime-server` and `dag-mcp-server` construct the framework with
no `ports.storage` override. Two long-running servers lost every run on restart, from a store whose
name is `File`.

### The change

The in-memory `Map`s stay as the working set, so every existing query is untouched —
`listStaleRunningTaskRuns`, `applyTaskRunLease`, the run-key scan. Only their lifetime moves: they
hydrate from disk on first use and are written after every mutation, through the same
write-and-rename the definitions already used.

Whole-collection writes rather than a file per entity. This tier is single-process — its queue and
lease ports are in-memory too — so there is no concurrent writer to lose, and one rename is cheaper
than the directory walk a per-entity layout needs on every hydrate. That is the write-frequency
trade the task asked to be decided: a task-run status changes a handful of times per task.

A missing file hydrates as empty; any OTHER read error throws. Treating an unreadable file as "nothing
was stored" would silently discard exactly the state this exists to keep.

### Red-proved on the thing that matters

Nine cases, each building a SECOND adapter over the same directory — the only way to test a restart;
asserting through the same instance passes against the Maps. Five failed before the change and pass
after. Two were green throughout (deletion, empty directory) and are kept as the non-regression half.

The two that matter most are not about storage at all: DAG-001's sweep now FINDS a task abandoned by
a dead process, and still does NOT reclaim one whose lease is live. Before, the sweep returned `[]` —
and an empty sweep is indistinguishable from a healthy one.

### Documentation

Both SPECs now describe what is true: the adapter's row, and `dag-worker`'s § Crash Recovery, which
named the file path as one of two adapters it could not actually protect. The caveat is replaced
rather than deleted — `InMemoryStoragePort` still has a recovery path with nothing durable under it,
and that is now the named exception.

### The size ceiling, and where it put the seams

The adapter grew past its 300-line maximum, so it was split rather than trimmed — and the boundaries
were already in the data:

- `json-collection-file.ts` — a `Map` that lives in a JSON file. The durability, which is a different
  responsibility from knowing what a DAG run is.
- `definition-files.ts` — definitions on disk, one immutable file per `(dagId, version)`. A different
  storage SHAPE from runs: addressed rather than rewritten, so it gets a file each and needs no
  whole-collection write.

Moving the definition directory walk there was the last step, because knowing that a version is a
`<number>.json` is the layout module's subject, not the port's.

### Review round 1 (PR #1613)

One MUST, upheld, and it made the suite accidental-green against its own claim: `saveTaskRunSnapshots`
and `incrementTaskAttempt` mutated the Map and never persisted, while every other task-run mutator was
migrated. The SPEC row this change wrote — "all three survive a restart" — was therefore false for
those fields, and no case covered them.

`attempt` is the load-bearing one. `worker-failure-handler` increments it on each retry and the retry
LIMIT is counted from it, so a crash mid-retry-loop reset the count and a task could retry past its
configured maximum. That is worse than losing a value: the store then actively reports a wrong one.
Red-proved — two increments then a restart read back `1`.

Fixing the two review named would have been the same mistake, so a mechanical sweep checked every
public method: each that mutates the Maps must hydrate first and persist after, and each that reads
them must hydrate. Result: none missing. The two were the whole set.

Both moved into `task-run-recovery.ts` beside `applyTaskRunLease`, which already owned pure edits to
the task-run Map — the port keeps only WHEN they happen and when they reach disk. That also brought
the port back under its size ceiling. (The first attempt at that cut too far and removed
`deleteDefinition` with them; typecheck caught it, and the size scan had gone green for the wrong
reason.)

### Remaining

- The default `queue` and `lease` ports are still in-memory, so a restart loses queued messages even
  though the store survives. The sweep is what closes that: a task whose lease expired is re-enqueued
  into the fresh queue. Worth stating because "storage is durable" is not "the framework is durable".
- Options 2 and 3 from the task are moot: 2 was already applied to the prose, and 3 (retire the
  adapter) is not available while it is the default for two servers.
