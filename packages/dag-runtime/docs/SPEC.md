# DAG Runtime Specification

Package: `@robota-sdk/dag-runtime` v0.1.0

## Scope

`dag-runtime` owns the runtime orchestration layer for DAG execution. Its responsibilities are:

- Creating DAG runs from published definitions with idempotent run-key semantics.
- Resolving time semantics (logical date) based on trigger type via `TimeSemanticsService` from `dag-core`.
- Transitioning DAG run and task run states through `DagRunStateMachine` and `TaskRunStateMachine` from `dag-core`.
- Identifying entry nodes (nodes with empty `dependsOn`) and enqueuing them as initial task runs.
- Querying DAG run status along with associated task runs.
- Cancelling DAG runs through state machine transition validation.
- Publishing execution progress events (`STARTED`, `FAILED`) via `IRunProgressEventReporter`.

## Boundaries

### Depends on

- `@robota-sdk/dag-core` -- all domain types, state machines, port interfaces, error builders, time semantics, and execution progress event constants.

### Does not own

- **Worker execution loops** -- owned by `dag-worker`.
- **Scheduler triggers** -- owned by `dag-scheduler`.
- **Storage and queue implementations** -- consumed through port interfaces (`IStoragePort`, `IQueuePort`, `IClockPort`) defined in `dag-core`.
- **API transport** -- owned by `dag-api`.
- **DAG definition authoring or validation** -- owned by `dag-core` and `dag-designer`.
- **Projection or read-model concerns** -- owned by `dag-projection`.
- **Node definition or execution logic** -- owned by `dag-nodes` and `dag-worker`.

### Import direction

All imports flow toward `dag-core`. This package does not import from any sibling DAG package.

## Architecture Overview

The package exposes three service classes, each with a single responsibility:

1. **RunOrchestratorService** -- The primary orchestration service. Accepts port dependencies via constructor injection (`IStoragePort`, `IQueuePort`, `IClockPort`, optional `IRunProgressEventReporter`). Provides three public methods:
   - `createRun` -- Resolves the definition, validates publication status, resolves time semantics, generates an idempotent run key, and persists a new `DagRun` in `created` status. Handles race conditions by re-querying on storage conflict.
   - `startCreatedRun` -- Takes a `dagRunId` in `created` status, parses the definition snapshot, identifies entry nodes, transitions the run through `created -> queued -> running`, creates task runs for entry nodes, and enqueues queue messages. On enqueue failure, transitions the run to `failed` and the affected task to `cancelled`.
   - `startRun` -- Composes `createRun` and `startCreatedRun` into a single idempotent operation. If the run already exists and is past `created`, returns existing task run IDs.

2. **RunQueryService** -- Read-only service. Accepts `IStoragePort`. Retrieves a `DagRun` and its associated `ITaskRun[]` by `dagRunId`.

3. **RunCancelService** -- Accepts `IStoragePort` and `IClockPort`. Validates the cancel transition through `DagRunStateMachine` and updates run status to `cancelled`.

All services use the `TResult<T, IDagError>` pattern for error handling. There are no fallback paths or silent error swallowing.

### Run Key Idempotency

Run keys follow the format `{dagId}:{logicalDate}` or `{dagId}:{logicalDate}:rerun:{rerunKey}`. Duplicate run key detection prevents redundant DAG runs. A storage-level race condition (concurrent create) is handled by re-querying the existing run.

### State Transitions

All state transitions are delegated to `DagRunStateMachine` and `TaskRunStateMachine` from `dag-core`. The orchestrator does not define or override transition rules.

## Type Ownership

| Type | Owner | Role |
|------|-------|------|
| `IStartRunInput` | `dag-runtime` | Input contract for `startRun` and `createRun` |
| `ICreateRunInput` | `dag-runtime` | Alias of `IStartRunInput` for `createRun` |
| `ICreateRunResult` | `dag-runtime` | Return value of `createRun` (includes `status`) |
| `IStartRunResult` | `dag-runtime` | Return value of `startRun` (includes `taskRunIds`) |
| `IRunQueryResult` | `dag-runtime` | Return value of `getRun` (dagRun + taskRuns) |
| `IRunCancelResult` | `dag-runtime` | Return value of `cancelRun` |
| `RunOrchestratorService` | `dag-runtime` | Orchestration service class |
| `RunQueryService` | `dag-runtime` | Query service class |
| `RunCancelService` | `dag-runtime` | Cancel service class |
| `DAG_RUNTIME_PACKAGE_NAME` | `dag-runtime` | Package name constant |
| `IDagDefinition` | `dag-core` | Imported -- DAG definition structure |
| `IDagRun` | `dag-core` | Imported -- DAG run record |
| `ITaskRun` | `dag-core` | Imported -- Task run record |
| `IDagError` | `dag-core` | Imported -- Structured error type |
| `TResult` | `dag-core` | Imported -- Result monad |
| `TDagRunStatus` | `dag-core` | Imported -- Run status union |
| `TDagTriggerType` | `dag-core` | Imported -- Trigger type union |
| `TPortPayload` | `dag-core` | Imported -- Port payload type |
| `IStoragePort` | `dag-core` | Imported -- Storage port interface |
| `IQueuePort` | `dag-core` | Imported -- Queue port interface |
| `IClockPort` | `dag-core` | Imported -- Clock port interface |
| `IQueueMessage` | `dag-core` | Imported -- Queue message structure |
| `IRunProgressEventReporter` | `dag-core` | Imported -- Event reporter port |
| `DagRunStateMachine` | `dag-core` | Imported -- Run state transition logic |
| `TaskRunStateMachine` | `dag-core` | Imported -- Task state transition logic |
| `TimeSemanticsService` | `dag-core` | Imported -- Logical date resolution |

## Public API Surface

| Export | Kind | Signature Summary |
|--------|------|-------------------|
| `RunOrchestratorService` | Class | `constructor(storage: IStoragePort, queue: IQueuePort, clock: IClockPort, runProgressEventReporter?: IRunProgressEventReporter)` |
| `RunOrchestratorService.createRun` | Method | `(input: ICreateRunInput) => Promise<TResult<ICreateRunResult, IDagError>>` |
| `RunOrchestratorService.startCreatedRun` | Method | `(dagRunId: string) => Promise<TResult<IStartRunResult, IDagError>>` |
| `RunOrchestratorService.startRun` | Method | `(input: IStartRunInput) => Promise<TResult<IStartRunResult, IDagError>>` |
| `RunQueryService` | Class | `constructor(storage: IStoragePort)` |
| `RunQueryService.getRun` | Method | `(dagRunId: string) => Promise<TResult<IRunQueryResult, IDagError>>` |
| `RunCancelService` | Class | `constructor(storage: IStoragePort, clock: IClockPort)` |
| `RunCancelService.cancelRun` | Method | `(dagRunId: string) => Promise<TResult<IRunCancelResult, IDagError>>` |
| `IStartRunInput` | Interface | `{ dagId, version?, trigger, logicalDate?, rerunKey?, input }` |
| `ICreateRunInput` | Interface | Extends `IStartRunInput` |
| `ICreateRunResult` | Interface | `{ dagRunId, dagId, version, logicalDate, status }` |
| `IStartRunResult` | Interface | `{ dagRunId, dagId, version, logicalDate, taskRunIds }` |
| `IRunQueryResult` | Interface | `{ dagRun: IDagRun, taskRuns: ITaskRun[] }` |
| `IRunCancelResult` | Interface | `{ dagRunId, status: 'cancelled' }` |
| `DAG_RUNTIME_PACKAGE_NAME` | Constant | `'@robota-sdk/dag-runtime'` |

## Extension Points

1. **Storage port** -- Any implementation of `IStoragePort` can be injected. The package ships no storage implementation; tests use `InMemoryStoragePort` from `dag-core`.

2. **Queue port** -- Any implementation of `IQueuePort` can be injected. Tests use `InMemoryQueuePort` from `dag-core`.

3. **Clock port** -- Any implementation of `IClockPort` can be injected. Tests use `FakeClockPort` from `dag-core`.

4. **Run progress event reporter** -- Optional `IRunProgressEventReporter` can be provided to the orchestrator to receive execution progress events. When omitted, no events are published.

5. **Rerun key** -- The `rerunKey` field in `IStartRunInput` allows creating distinct runs for the same DAG and logical date, enabling controlled rerun semantics without colliding with the original run key.

## Error Taxonomy

All errors use `IDagError` from `dag-core` and are constructed via `buildValidationError` or `buildDispatchError`.

### Validation Errors

| Code | Source | Condition |
|------|--------|-----------|
| `DAG_VALIDATION_DEFINITION_NOT_FOUND` | `createRun` | No published definition found for the given `dagId` (and optional `version`) |
| `DAG_VALIDATION_DEFINITION_NOT_PUBLISHED` | `createRun` | Definition exists but its status is not `published` |
| `DAG_VALIDATION_MISSING_LOGICAL_DATE` | `createRun` | Scheduled trigger without a `logicalDate` (via `TimeSemanticsService`) |
| `DAG_VALIDATION_DAG_RUN_NOT_FOUND` | `startCreatedRun`, `getRun`, `cancelRun` | No `DagRun` found for the given `dagRunId` |
| `DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING` | `startCreatedRun` | `DagRun` record has empty or missing `definitionSnapshot` |
| `DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID` | `startCreatedRun` | `definitionSnapshot` fails structural parse |
| `DAG_VALIDATION_RUN_INPUT_SNAPSHOT_INVALID` | `startCreatedRun` | `inputSnapshot` fails JSON object parse |
| `DAG_VALIDATION_NO_ENTRY_NODE` | `startCreatedRun` | Definition contains no nodes with empty `dependsOn` |
| `DAG_VALIDATION_PAYLOAD_INVALID` | internal | Parsed payload is not a JSON object |
| `DAG_VALIDATION_PAYLOAD_PARSE_FAILED` | internal | Payload string is not valid JSON |
| `DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED` | internal | Definition snapshot string is not valid JSON |

### Dispatch Errors

| Code | Source | Condition |
|------|--------|-----------|
| `DAG_DISPATCH_DAG_RUN_CREATE_FAILED` | `createRun` | Storage-level failure when creating the `DagRun` record (and no raced run found) |
| `DAG_DISPATCH_ENQUEUE_FAILED` | `startCreatedRun` | Queue `enqueue` call throws for an entry task; triggers run failure and task cancellation |

### State Machine Errors

State transition failures (e.g., attempting to cancel a terminal run) are returned directly from `DagRunStateMachine.transition` and `TaskRunStateMachine.transition` in `dag-core`. This package does not wrap or remap those errors.

## Class Contract Registry

### Interface Implementations

No classes in this package use the `implements` keyword. All port dependencies are consumed via constructor injection.

### Inheritance Chains

None. Service classes are standalone (no `extends`).

### Port Consumption via DI

| Service Class | Injected Port (from dag-core) | Location |
|---------------|------------------------------|----------|
| `RunOrchestratorService` | `IStoragePort`, `IQueuePort`, `IClockPort`, `IRunProgressEventReporter` | `src/services/run-orchestrator-service.ts` |
| `RunQueryService` | `IStoragePort` | `src/services/run-query-service.ts` |
| `RunCancelService` | `IStoragePort`, `IClockPort` | `src/services/run-cancel-service.ts` |

### Cross-Package Port Consumers

| Port (Owner) | Consumer Class | Location |
|--------------|---------------|----------|
| `IStoragePort` (dag-core) | `RunOrchestratorService`, `RunQueryService`, `RunCancelService` | `src/services/` |
| `IQueuePort` (dag-core) | `RunOrchestratorService` | `src/services/run-orchestrator-service.ts` |
| `IClockPort` (dag-core) | `RunOrchestratorService`, `RunCancelService` | `src/services/` |
| `IRunProgressEventReporter` (dag-core) | `RunOrchestratorService` | `src/services/run-orchestrator-service.ts` |

## Test Strategy

Tests are located in `packages/dag-runtime/src/__tests__/` and executed via `vitest`.

### Test files

- `run-orchestrator-service.test.ts` -- Tests for `RunOrchestratorService` covering:
  - Successful run creation and entry task enqueue
  - Missing definition error
  - Scheduled trigger without logical date error
  - Idempotent duplicate run key handling
  - Two-phase create-then-start workflow
  - Idempotent `startCreatedRun` on already-running run
  - No-entry-node validation
  - Enqueue failure transitions (run to `failed`, task to `cancelled`)
  - Race condition handling during concurrent `createDagRun`

- `run-query-cancel-service.test.ts` -- Tests for `RunQueryService` and `RunCancelService` covering:
  - Query of run with associated task runs
  - Cancel from `running` status with timestamp verification

### Test infrastructure

All tests use in-memory fakes from `dag-core`:
- `InMemoryStoragePort` -- in-memory storage implementation
- `InMemoryQueuePort` -- in-memory queue implementation
- `FakeClockPort` -- deterministic clock for reproducible timestamps

Custom test doubles are defined locally:
- `FailingQueuePort` -- simulates enqueue failure at a configurable call count
- `RacyDagRunStoragePort` -- extends `InMemoryStoragePort` to simulate storage race conditions

### Run command

```bash
pnpm --filter @robota-sdk/dag-runtime test
```
