---
'@robota-sdk/dag-core': major
'@robota-sdk/dag-worker': minor
'@robota-sdk/dag-adapters-local': minor
'@robota-sdk/dag-adapters-sqlite': minor
---

**BREAKING (dag-core) — DAG-001: `running` was a terminal trap; the DAG subsystem now has a crash-recovery path.**

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
