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

## Behavioral Contracts

### Downstream Task Dispatch Atomicity

When dispatching a downstream task, the create-then-enqueue sequence must be atomic in outcome:

1. Create `TaskRun` record in storage with `queued` status.
2. Enqueue the task message to the queue.
3. **If enqueue fails**: the `TaskRun` must be transitioned to `cancelled` status via the `CANCEL` event (`queued -> cancelled`) to prevent orphaned records. A `TaskRun` in `queued` status with no corresponding queue message is an invariant violation. Note: the `queued -> failed` transition does not exist in the state machine; `CANCEL` is the correct recovery path.

**Current gap**: The implementation creates the `TaskRun` then attempts enqueue. On enqueue failure, it returns an error but does not transition the orphaned `TaskRun`. This must be corrected.

### DLQ Reinject Concurrency Safety

`DlqReinjectService.reinjectOnce` relies on the DLQ's dequeue visibility timeout for message-level exclusion — only one worker receives a given DLQ message at a time. This provides partial concurrency safety.

However, for defense-in-depth, the service should acquire a lease on the task run (via `ILeasePort`) before modifying its state. This prevents races in edge cases where the visibility timeout expires before the reinject completes, allowing another worker to dequeue the same message.

**Current gap**: The `DlqReinjectService` constructor does not accept an `ILeasePort` dependency. Adding lease acquisition would require extending the constructor signature and the composition factory.

### DAG Run Finalization Classification

`DagRunFinalizer` determines the outcome of a DAG run when all tasks reach terminal states. The classification rules are:

- **Terminal task states**: `success`, `failed`, `upstream_failed`, `skipped`, `cancelled`
- **Non-terminal (pending) states**: `created`, `queued`, `running`
- **Failure-contributing states**: `failed` only
- **Non-failure terminal states**: `success`, `upstream_failed`, `skipped`, `cancelled`

A DAG run is `success` when all tasks are terminal and **none** are in the `failed` state. `upstream_failed`, `skipped`, and `cancelled` tasks do not indicate DAG-level failure — they represent expected propagation of upstream failures, conditional skips, or user cancellation.

**Current gap**: The `FAILURE_TASK_STATUSES` set includes `upstream_failed` and `cancelled`, causing DAG runs to be marked `failed` when tasks are only `upstream_failed`/`cancelled` (no actual `failed` task). Additionally, `skipped` is not in either the pending or failure set, which may cause incorrect finalization. This must be corrected.

### Lease Failure Handling

When `WorkerLoopService` fails to acquire a lease (another worker already holds it), this is a normal contention scenario, not an error. The method should return a non-error result indicating no work was processed (`processed: false`), allowing the message to remain in the queue for the lease holder to process.

### Timeout Enforcement Scope

Task timeout (`defaultTimeoutMs`) is enforced via `AbortController` signal during execution. However, if the executor does not respect the abort signal, the timeout has no effect. This is a known limitation — node implementations must cooperate with the abort signal for timeout to be effective.

## Type Ownership

This package is SSOT for:

- `IWorkerLoopOptions` -- worker configuration (workerId, leaseDurationMs, visibilityTimeoutMs, retryEnabled, deadLetterEnabled, maxAttempts, defaultTimeoutMs)
- `IWorkerLoopResult` -- processing result (processed, taskRunId, retried)
- `IDlqReinjectResult` -- reinject result (reinjected, taskRunId)
- `IWorkerLoopDependencies` -- dependency injection shape for the composition factory
- `IWorkerLoopPolicyOptions` -- policy-level options with optional retry/DLQ flags

## Public API Surface

- `WorkerLoopService` -- main service class
  - `processOnce(): Promise<TResult<IWorkerLoopResult, IDagError>>` -- dequeue and process one task
- `DlqReinjectService` -- DLQ reinject service
  - `reinjectOnce(workerId, visibilityTimeoutMs): Promise<TResult<IDlqReinjectResult, IDagError>>`
- `createWorkerLoopService(deps, options): WorkerLoopService` -- composition factory
- `replaceAttemptSegment(path, nextAttempt): string[]` -- execution path utility

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

## Class Contract Registry

### Interface Implementations

No classes in this package use the `implements` keyword. All port dependencies are consumed via constructor injection.

### Inheritance Chains

None. Service classes are standalone (no `extends`).

### Port Consumption via DI

| Service Class | Injected Port (from dag-core) | Location |
|---------------|------------------------------|----------|
| `WorkerLoopService` | `IStoragePort`, `IQueuePort`, `ILeasePort`, `ITaskExecutorPort`, `IClockPort` | `src/services/worker-loop-service.ts` |
| `DlqReinjectService` | `IStoragePort`, `IQueuePort` (x2), `IClockPort` | `src/services/dlq-reinject-service.ts` |

### Cross-Package Port Consumers

| Port (Owner) | Consumer Class | Location |
|--------------|---------------|----------|
| `IStoragePort` (dag-core) | `WorkerLoopService`, `DlqReinjectService` | `src/services/` |
| `IQueuePort` (dag-core) | `WorkerLoopService`, `DlqReinjectService` | `src/services/` |
| `ILeasePort` (dag-core) | `WorkerLoopService` | `src/services/worker-loop-service.ts` |
| `ITaskExecutorPort` (dag-core) | `WorkerLoopService` | `src/services/worker-loop-service.ts` |
| `IClockPort` (dag-core) | `WorkerLoopService`, `DlqReinjectService` | `src/services/` |

## Test Strategy

- **Unit tests**: `worker-loop-service.test.ts`, `dlq-reinject-service.test.ts`, `worker-loop-composition.test.ts`
- Tests use in-memory port implementations from `dag-core`.
- Coverage focus: lease acquisition/release, success/failure paths, retry logic with attempt increment, DLQ enqueue/reinject, downstream dispatch with binding resolution, DAG run finalization (success/failure), timeout enforcement.
- Run: `pnpm --filter @robota-sdk/dag-worker test`
