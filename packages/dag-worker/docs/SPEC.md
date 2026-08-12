# DAG Worker Specification

## Scope

Owns the dequeue-process loop for task execution within DAG runs.
Applies lease acquisition, timeout enforcement, retry logic, dead letter queue (DLQ) handling,
downstream task dispatch, and DAG run finalization behavior.

## Boundaries

- Depends on `dag-core` for domain contracts, state machines, port interfaces, and error builders.
- Does not define DAG definitions, API contracts, or scheduling logic.
- Does not own runtime orchestration (run creation, start) -- those belong to `dag-runtime`.
- Does not own projection or observability concerns.

## Architecture Overview

The package has three main modules:

- **WorkerLoopService** (`services/worker-loop-service.ts`): The core processing loop. Each `processOnce()` call dequeues a message, acquires a lease, executes the task via `ITaskExecutorPort`, handles success/failure paths, dispatches downstream tasks, and finalizes the DAG run when all tasks are terminal.
- **DownstreamTaskDispatcher** (`services/downstream-task-dispatcher.ts`): Resolves downstream nodes, builds input payloads from edge bindings, creates task runs, and enqueues them.
- **DagRunFinalizer** (`services/dag-run-finalizer.ts`): Checks whether all tasks in a DAG run are terminal and determines success/failure outcome.
- **DlqReinjectService** (`services/dlq-reinject-service.ts`): Dequeues from the dead letter queue, transitions the task to retry state, and re-enqueues to the main queue.
- **Composition factory** (`composition/create-worker-loop-service.ts`): Wires `WorkerLoopService` from port dependencies and policy options.

Supporting utility:

- `replaceAttemptSegment(path, nextAttempt)` -- updates the attempt segment in an execution path array.
- `loadWorkerExecutionContext(storage, message)` -- resolves DAG run, definition snapshot, and node definition for a dequeued message.
- `resolveCurrentTotalCredits(taskRuns)` -- calculates accumulated credit progress for task execution input.

## Behavioral Contracts

### Downstream Task Dispatch Atomicity

When dispatching a downstream task, the create-then-enqueue sequence must be atomic in outcome:

1. Create `TaskRun` record in storage with `queued` status.
2. Enqueue the task message to the queue.
3. **If enqueue fails**: the `TaskRun` is transitioned to `cancelled` status via the `CANCEL` event (`queued -> cancelled`) to prevent orphaned records. A `TaskRun` in `queued` status with no corresponding queue message is an invariant violation. Note: the `queued -> failed` transition does not exist in the state machine; `CANCEL` is the correct recovery path.

This is implemented in `dispatchSingleDownstreamNode` (`services/downstream-task-dispatcher.ts`): on `queue.enqueue` failure it runs `TaskRunStateMachine.transition('queued', 'CANCEL')`, updates the orphaned `TaskRun` status, and returns `DAG_DISPATCH_ENQUEUE_DOWNSTREAM_FAILED`.

### DLQ Reinject Concurrency Safety

`DlqReinjectService.reinjectOnce` uses two layers of concurrency protection:

1. **DLQ dequeue visibility timeout**: only one worker receives a given DLQ message at a time.
2. **Lease acquisition**: after dequeue, the service acquires a lease on the task run (`taskRun:{taskRunId}`) before modifying state. If the lease is held by another worker, the message is nacked and the method returns `reinjected: false` without error.

The lease is always released in a `finally` block after processing completes.

### DAG Run Finalization Classification

`DagRunFinalizer` determines the outcome of a DAG run when all tasks reach terminal states. The classification rules are:

- **Terminal task states**: `success`, `failed`, `upstream_failed`, `skipped`, `cancelled`
- **Non-terminal (pending) states**: `created`, `queued`, `running`
- **Failure-contributing states**: `failed` only
- **Non-failure terminal states**: `success`, `upstream_failed`, `skipped`, `cancelled`

A DAG run is `success` when all tasks are terminal and **none** are in the `failed` state. `upstream_failed`, `skipped`, and `cancelled` tasks do not indicate DAG-level failure — they represent expected propagation of upstream failures, conditional skips, or user cancellation.

This is implemented in `services/dag-run-finalizer.ts`: `PENDING_TASK_STATUSES = {'created', 'queued', 'running'}` gate whether the run is still in progress, and `FAILURE_TASK_STATUSES = {'failed'}` alone determines the `failed` outcome. `upstream_failed`, `skipped`, and `cancelled` are treated as non-failure terminal states.

### Lease Failure Handling

When `WorkerLoopService` fails to acquire a lease (another worker already holds it), this is a normal contention scenario, not an error. The method should return a non-error result indicating no work was processed (`processed: false`), allowing the message to remain in the queue for the lease holder to process.

### Crash Recovery (DAG-001)

A worker that dies mid-node used to leave its task and its run in `running` **forever**, silently. Two
paths now recover it, and both go through `dag-core`'s `running --RECLAIM--> queued` edge.

**On redelivery.** `processOnce` reclaims a task that is already `running` when its message arrives.
This is safe precisely here: the code reaches that point only after `lease.acquire` SUCCEEDED, so a
live owner's duplicate delivery is nacked before it gets there. Acquiring means the previous owner
released the lease or died and let it expire — the definition of abandoned.

**Which adapters this actually protects.** The sweep recovers state it can still READ after a
restart, so it is crash-durable only where the store is. `SqliteStorageAdapter` and `FileStoragePort`
both persist task runs and their leases and get the full guarantee — the file adapter did not until
DAG-003, which is what made this section's earlier caveat necessary. An adapter that keeps runs in
memory (`InMemoryStoragePort`) still gets a recovery path with nothing durable under it, and the sweep
against it can only reclaim within a single process lifetime — named here rather than left implied,
because this section would otherwise promise a guarantee one of its adapters cannot give.

**On idle.** Only the in-memory queue redelivers. On a queue without it there is no message left to
arrive, so `processOnce` calls `sweepStaleTaskRuns` on its idle branch — the one point every loop
driver goes through, throttled to at most once per `leaseDurationMs` since a lease cannot expire
faster than that.

**When a task counts as stale**: its recorded `leaseUntil` has passed, or it is `running` with no
lease recorded at all. The second case is included deliberately — a task orphaned before its lease was
written has the least evidence and would otherwise be exactly the one left stuck forever.

**Lease expiry is derived from the execution bound, not from `leaseDurationMs`.** That option bounds
how long a worker may hold the distributed lock; a task's execution is bounded by its own `timeoutMs`,
and the two are unrelated numbers. Using the lock duration would let the sweeper reclaim a task that
is still legitimately running — executed twice, a worse failure than the trap being fixed.

A swept task returns to `queued` with its attempt INCREMENTED and is executed again, bounded by
`maxAttempts` exactly like any other retry. Two cases are not re-run at all:

- **A run that is already over.** `RunCancelService.cancelRun` updates only the RUN, leaving its tasks
  `running`, so without this check cancelling a run and waiting would silently re-execute the node the
  user cancelled. Such tasks are marked `cancelled`.
- **A task with no attempts left.** Failed with `DAG_TASK_EXECUTION_ABANDONED`. Without the attempt increment
  above, a task that keeps killing its worker would be swept and re-run forever and `maxAttempts`
  would never apply.

The sweep returns what it did (`requeued` / `abandoned` / `skipped`) rather than a count, so a sweep
that finds tasks and moves none is observable.

**Ownership is one bound, used twice.** The worker acquires the `ILeasePort` lease for
`max(timeoutMs, leaseDurationMs) + grace` — the same value it records as `leaseUntil` — so the
in-memory lock and the persisted lease cannot disagree about when a task stops being owned. Acquiring
for `leaseDurationMs` alone let the lease expire mid-execution (real configs pair a 60s lease with a
300s default timeout), after which the queue's visibility timeout redelivered the message to a worker
that could acquire it — reclaiming a task that was still running.

**A reclaimed task stays `running` until a message provably exists for it.** The sweep's four writes
have no transaction between them, and the sweeper is exactly as mortal as the worker whose death it
is cleaning up after. Writing the status first meant a sweeper that died mid-sequence left the task
`queued` with no message — and `listStaleRunningTaskRuns` queries only `running`, so nothing would
ever find it again. The order is: increment the attempt, enqueue, then set `queued`, then clear the
lease. The attempt advances before the enqueue because the message id derives from it; a crash
between the two burns one attempt rather than producing a second message with an id the first
already took.

**The lease is written BEFORE the status.** They are two writes with no transaction between them; in
the other order a sweeper running in the gap would see `running` with no lease — the shape it treats
as abandoned — and reclaim a task that was in the middle of starting.

**The sweeper takes the same `ILeasePort` lease a worker takes**, for the same reason. Without it two
idle workers sweep one task concurrently: both requeue it, the attempt jumps by two so a healthy task
is failed well before `maxAttempts`, and the two messages carry the same id — which on the sqlite
queue is a PRIMARY KEY, so the second insert throws. The reclaim message's id is keyed on the
ATTEMPT rather than the clock, so it is unique by construction rather than by timing, and it carries
the incremented attempt so the message and storage agree (`handleRetry` reads the message's).

### Idle Wait / Queue Wake-up

`IWorkerLoopOptions.idleWaitMs` is optional and defaults to immediate dequeue semantics when omitted. When configured, `WorkerLoopService.processOnce()` passes the value to `IQueuePort.dequeue(..., waitTimeoutMs)`.

- Queue adapters that support long-polling can wake the worker immediately when a new task is enqueued.
- Queue adapters that do not support long-polling may ignore the optional timeout and return immediately.
- Worker-level polling loops should prefer `idleWaitMs` over an external fixed sleep interval so downstream tasks can start as soon as the queue receives them.

### Timeout Enforcement Scope

Task timeout (`defaultTimeoutMs`) is enforced via `AbortController` signal during execution. However, if the executor does not respect the abort signal, the timeout has no effect. This is a known limitation — node implementations must cooperate with the abort signal for timeout to be effective.

## Type Ownership

This package is SSOT for:

- `IWorkerLoopOptions` -- worker configuration (workerId, leaseDurationMs, visibilityTimeoutMs, retryEnabled, deadLetterEnabled, maxAttempts, defaultTimeoutMs, idleWaitMs)
- `IWorkerLoopResult` -- processing result (processed, taskRunId, retried)
- `IDlqReinjectResult` -- reinject result (reinjected, taskRunId)
- `IWorkerLoopDependencies` -- dependency injection shape for the composition factory
- `IWorkerLoopPolicyOptions` -- policy-level options with optional retry/DLQ flags

`IWorkerLoopDependencies.executionRoot` is required execution authority, not worker policy. The worker
validates it at construction, canonicalizes it to an absolute real directory, and copies that trusted
value into every `ITaskExecutionInput`; it never reads `process.cwd()` or accepts a root from a queue
message or DAG definition.

## Public API Surface

A table rather than a bullet list, because `check-spec-public-surface` reads table rows — as a list
this section was invisible to the surface scan and every export in it counted as undocumented.

| Export                    | Kind     | Description                                                                                                                                                      |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkerLoopService`       | class    | Main service. `processOnce(): Promise<TResult<IWorkerLoopResult, IDagError>>` dequeues and processes one task, and sweeps abandoned tasks when the queue is idle |
| `DlqReinjectService`      | class    | DLQ reinject. `reinjectOnce(workerId, visibilityTimeoutMs): Promise<TResult<IDlqReinjectResult, IDagError>>`                                                     |
| `createWorkerLoopService` | function | Composition factory — `(deps, options) => WorkerLoopService`                                                                                                     |
| `sweepStaleTaskRuns`      | function | DAG-001: returns tasks abandoned by a dead worker to the queue. The reader for `IStoragePort.listStaleRunningTaskRuns` — see § Crash Recovery                    |
| `DAG_WORKER_PACKAGE_NAME` | constant | This package's name                                                                                                                                              |

`replaceAttemptSegment(path, nextAttempt)` is an internal utility (`src/utils/execution-path.ts`), not re-exported from `src/index.ts`; see "Supporting utility" above.

## Extension Points

- `ITaskExecutorPort` (from `dag-core`) -- consumers implement this to define how tasks are executed.
- `ILeasePort` (from `dag-core`) -- consumers provide lease acquisition/release mechanics.
- `IQueuePort` (from `dag-core`) -- consumers provide queue enqueue/dequeue/ack/nack behavior.
- `IRunProgressEventReporter` (from `dag-core`) -- optional reporter for publishing task/run progress events.

## Error Taxonomy

All errors use `IDagError` from `dag-core` with the following codes:

**Lease errors** (`category: 'lease'`):

- `DAG_LEASE_CONTRACT_VIOLATION` -- failed to acquire lease for a task run

**Validation errors** (`category: 'validation'`):

- `DAG_VALIDATION_TASK_RUN_NOT_FOUND` -- task run missing for dequeued message
- `DAG_VALIDATION_DAG_RUN_NOT_FOUND` -- DAG run missing
- `DAG_VALIDATION_NODE_NOT_FOUND` -- node definition missing for task
- `DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING` / `_INVALID` / `_PARSE_FAILED` -- snapshot errors
- `DAG_VALIDATION_DOWNSTREAM_NODE_NOT_FOUND` -- downstream node missing
- `DAG_VALIDATION_BINDING_*` -- binding resolution errors (REQUIRED, OUTPUT_KEY_MISSING, INPUT_KEY_MISSING, INPUT_KEY_CONFLICT, LIST_PAYLOAD_INVALID)
- `DAG_VALIDATION_UPSTREAM_OUTPUT_*` -- upstream output errors (MISSING, INVALID, PARSE_FAILED)
- `DAG_VALIDATION_DEAD_LETTER_QUEUE_NOT_CONFIGURED` -- DLQ enabled but not configured

**Dispatch errors** (`category: 'dispatch'`):

- `DAG_DISPATCH_ENQUEUE_RETRY_FAILED` -- retry enqueue failure
- `DAG_DISPATCH_ENQUEUE_DOWNSTREAM_FAILED` -- downstream enqueue failure
- `DAG_DISPATCH_DEAD_LETTER_ENQUEUE_FAILED` -- DLQ enqueue failure
- `DAG_DISPATCH_REINJECT_ENQUEUE_FAILED` -- reinject enqueue failure

**Task execution errors** (`category: 'task_execution'`):

- `DAG_TASK_EXECUTION_TIMEOUT` -- task exceeded timeout
- `DAG_TASK_EXECUTION_EXCEPTION` -- executor threw an exception
- `DAG_TASK_EXECUTION_FAILED` -- generic run failure
- `DAG_TASK_EXECUTION_ABANDONED` -- DAG-001: the task was abandoned by its worker and has no attempts
  left. Emitted by the stale-task sweep, not by an executor
- `DAG_TASK_EXECUTION_ORPHANED` -- DAG-001: the task's parent DAG run no longer exists, so it can be
  neither run nor finalized. `deleteDagRun` does not cascade to task runs, so a retention job can
  leave this. Reported in its own `orphaned` bucket rather than as an ordinary abandonment — treating
  a missing parent record as a finished run is how a referential-integrity bug becomes invisible
- `DAG_TASK_SWEEP_FAILED` -- DAG-001: the stale-task sweep itself failed. Returned as an ordinary
  `processOnce` error rather than thrown, because the sweep runs on the idle branch whose promise the
  drivers only `.catch` when stopping — a throw there became an unhandled rejection that killed the
  worker. Recovery failing must not take the worker with it

## Class Contract Registry

### Interface Implementations

No classes in this package use the `implements` keyword. All port dependencies are consumed via constructor injection.

### Inheritance Chains

None. Service classes are standalone (no `extends`).

### Port Consumption via DI

| Service Class        | Injected Port (from dag-core)                                                 | Location                               |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| `WorkerLoopService`  | `IStoragePort`, `IQueuePort`, `ILeasePort`, `ITaskExecutorPort`, `IClockPort` | `src/services/worker-loop-service.ts`  |
| `DlqReinjectService` | `IStoragePort`, `IQueuePort` (x2), `ILeasePort`, `IClockPort`                 | `src/services/dlq-reinject-service.ts` |

### Cross-Package Port Consumers

| Port (Owner)                   | Consumer Class                            | Location                              |
| ------------------------------ | ----------------------------------------- | ------------------------------------- |
| `IStoragePort` (dag-core)      | `WorkerLoopService`, `DlqReinjectService` | `src/services/`                       |
| `IQueuePort` (dag-core)        | `WorkerLoopService`, `DlqReinjectService` | `src/services/`                       |
| `ILeasePort` (dag-core)        | `WorkerLoopService`, `DlqReinjectService` | `src/services/`                       |
| `ITaskExecutorPort` (dag-core) | `WorkerLoopService`                       | `src/services/worker-loop-service.ts` |
| `IClockPort` (dag-core)        | `WorkerLoopService`, `DlqReinjectService` | `src/services/`                       |

## Test Strategy

- **Unit tests**: `worker-loop-service.test.ts`, `dlq-reinject-service.test.ts`, `worker-loop-composition.test.ts`
- Tests use in-memory port implementations from `@robota-sdk/dag-adapters-local`.
- Coverage focus: lease acquisition/release, success/failure paths, retry logic with attempt increment, DLQ enqueue/reinject, downstream dispatch with binding resolution, DAG run finalization (success/failure), timeout enforcement.
- Run: `pnpm --filter @robota-sdk/dag-worker test`
