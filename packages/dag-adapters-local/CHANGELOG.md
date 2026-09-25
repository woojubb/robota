# @robota-sdk/dag-adapters-local

## 3.0.0-beta.61

### Major Changes

- 6238e38: Cost-limited DAG runs now reserve credits for each leased task attempt before execution. Successful output settlement converts the hold to a charge; failure, cancellation, and reclaim release it. Stored cumulative totals from successful legacy tasks remain the accounting floor when individual estimates are absent.

  Custom executors used with `createDagFramework` or `WorkerLoopService` must implement `estimateCost(input)` for cost-limited runs. It must return a finite, nonnegative estimate before `execute` starts; a missing or invalid estimate fails the task. Direct `commitExecution` callers must reserve credits before settling a successful task in a cost-limited run.

  Direct `createExecutionComposition` callers that wrap a `LifecycleTaskExecutorPort` must pass `lifecycleCreditAdmission: true` in the composition dependencies so the worker recognizes that the wrapped lifecycle reserves credits before execution.

### Minor Changes

- 0214ff8: `FileStoragePort` now enforces its single-owner contract: it claims ownership of its storage root before
  any read or write, and a second live instance over the same root fails with a typed
  `FileStoreOwnerConflictError` naming the holder's pid, host and acquisition time, instead of silently
  losing the live owner's writes.

  Ownership is held as numbered epoch files in the storage root. Each epoch is claimed only by exclusive
  creation, so exactly one instance can win it, and an instance owns the root only while its epoch is the
  newest. A new epoch is claimed only over one that its holder released, whose holder on the same host is
  no longer running, or whose heartbeat lease has lapsed — the last covers other hosts and recreated
  containers, which never run exit handlers on SIGTERM/SIGKILL. The owner renews its lease on an interval
  and stops acting before its lease could look lapsed to anyone else; timing options that do not leave that
  margin (a refresh interval above a third of the lease timeout) are rejected at construction.

  Losing ownership — being superseded by a newer epoch or self-expiring — is permanent for that instance:
  every later read and write rejects with `FileStoreOwnerConflictError`, and using the root again means
  opening a new instance.

  `FileStoragePort` gains `close()`, which releases ownership. Closing is final: later operations reject
  with `FileStoragePortClosedError`, while work already queued before `close()` completes first.
  `createDagFramework`'s `stop()` closes the file storage it created itself, never a caller-supplied storage
  port. `IFileStoragePortOwnerLockOptions` is exported alongside `FileStoragePort`.

- caabd3c: **BREAKING (dag-core) — DAG-001: `running` was a terminal trap; the DAG subsystem now has a crash-recovery path.**

  A worker that died mid-node left its task and its run in `running` forever, silently. On the one queue
  adapter that redelivers, recovery was _guaranteed to fail_: the redelivered task hit `running:START`,
  which the transition table did not contain, so it errored and the message was acked and dropped — the
  only path that could have recovered destroyed the last record that the work was pending.

  `dag-core` owned the three things a recovery path needs and none of them could express recovery. All
  three change:

  - **`TaskRunStateMachine`** gains a `RECLAIM` event and the `running --RECLAIM--> queued` transition.
  - **`IStoragePort`** gains `setTaskRunLease(taskRunId, leaseOwner?, leaseUntil?)` and
    `listStaleRunningTaskRuns(asOfIso)`. **Any custom `IStoragePort` implementation must add both.**
  - **`ILeasePort.renew` is REMOVED.** It had zero production callers. A heartbeat is the design that
    would need it, and this is not that design: a task's lease expiry is derived from the time the task
    is allowed to run, which is known up front. **Any custom `ILeasePort` implementation may drop it.**

  `ITaskRun.leaseOwner` / `leaseUntil` are now actually written. They existed on the domain type and in
  the sqlite INSERT with nothing ever setting them.

  `@robota-sdk/dag-worker` gains `sweepStaleTaskRuns`, called from `WorkerLoopService.processOnce` when
  the queue is idle, so recovery also reaches adapters that never redeliver.

### Patch Changes

- Updated dependencies [eb71c83]
- Updated dependencies [fec722f]
- Updated dependencies [9fbab1b]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [5a46402]
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-cost@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.60
- @robota-sdk/dag-cost@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.59
- @robota-sdk/dag-cost@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.58
- @robota-sdk/dag-cost@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.57
- @robota-sdk/dag-cost@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.56
- @robota-sdk/dag-cost@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- Updated dependencies [38a72bf]
  - @robota-sdk/dag-core@3.0.0-beta.55
  - @robota-sdk/dag-cost@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.54
- @robota-sdk/dag-cost@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.53
- @robota-sdk/dag-cost@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.52
- @robota-sdk/dag-cost@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.51
- @robota-sdk/dag-cost@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.50
- @robota-sdk/dag-cost@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.49
- @robota-sdk/dag-cost@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.48
- @robota-sdk/dag-cost@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.47
- @robota-sdk/dag-cost@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.46
- @robota-sdk/dag-cost@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.45
- @robota-sdk/dag-cost@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.44
- @robota-sdk/dag-cost@3.0.0-beta.44
