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
- **DlqReinjectService** (`services/dlq-reinject-service.ts`): Dequeues from the dead letter queue, transitions the task to retry state, and re-enqueues to the main queue.
- **Composition factory** (`composition/create-worker-loop-service.ts`): Wires `WorkerLoopService` from port dependencies and policy options.

Supporting utility:

- `replaceAttemptSegment(path, nextAttempt)` -- updates the attempt segment in an execution path array.

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

## Test Strategy

- **Unit tests**: `worker-loop-service.test.ts`, `dlq-reinject-service.test.ts`, `worker-loop-composition.test.ts`
- Tests use in-memory port implementations from `dag-core`.
- Coverage focus: lease acquisition/release, success/failure paths, retry logic with attempt increment, DLQ enqueue/reinject, downstream dispatch with binding resolution, DAG run finalization (success/failure), timeout enforcement.
- Run: `pnpm --filter @robota-sdk/dag-worker test`
