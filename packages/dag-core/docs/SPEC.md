# DAG Core Specification

## Scope

`@robota-sdk/dag-core` is the single source of truth (SSOT) for all DAG domain contracts, state rules, and validation logic in the Robota monorepo. It owns the canonical type definitions for DAG definitions, runs, tasks, ports, nodes, edges, errors, and state machines. Every other `dag-*` package depends on `dag-core` and must import its contracts from this package rather than re-declaring them. This package contains no infrastructure adapters or runtime orchestration logic; it defines what the DAG domain looks like, not how it executes at scale.

## Boundaries

- **No infrastructure adapters.** Storage, queue, and lease implementations belong to consumer packages. `dag-core` defines only the port interfaces (`IStoragePort`, `IQueuePort`, `ILeasePort`, `IClockPort`, `ITaskExecutorPort`).
- **No orchestration runtime.** DAG scheduling, worker polling, and run coordination belong to runtime and orchestration packages.
- **No node implementations.** Concrete node types belong to node implementation packages.
- **No node authoring infrastructure.** Base classes (`AbstractNodeDefinition`), accessors (`NodeIoAccessor`), registries, lifecycle wrappers, and value objects (`MediaReference`) belong to a dedicated node authoring package. `dag-core` defines the interfaces they implement but does not own the implementations.
- **No projection or read models.** Event-sourced projections belong to projection packages.
- **No API layer.** HTTP/REST composition belongs to API packages.
- **No designer UI.** Visual graph editing belongs to designer packages.
- **Contract behavior must be deterministic and fail-fast.** No fallback logic.

## Architecture Overview

### Layer Structure

```
dag-core/
  src/
    types/           -- Domain type definitions (SSOT contracts)
    interfaces/      -- Port interfaces for infrastructure boundaries
    constants/       -- Status enums, event name constants
    state-machines/  -- DagRun and TaskRun finite state machines
    lifecycle/       -- Node lifecycle runner, cost policy evaluator, task executor port
    services/        -- Domain services (validation, definition mgmt, cost policy)
    registry/        -- (emptied — extracted to node authoring package)
    schemas/         -- (emptied — extracted to node authoring package)
    value-objects/   -- (emptied — extracted to node authoring package)
    utils/           -- Error builder helpers
    testing/         -- In-memory port implementations for test harnesses
    __tests__/       -- Unit tests
```

### Design Patterns

- **Result pattern (`TResult<T, E>`)**: All domain operations return discriminated unions (`{ ok: true; value: T } | { ok: false; error: E }`) instead of throwing exceptions. This enforces explicit error handling at every call site.
- **Port/adapter (hexagonal)**: Infrastructure concerns are defined as port interfaces (`IStoragePort`, `IQueuePort`, `ILeasePort`, `IClockPort`, `ITaskExecutorPort`). `dag-core` owns the ports; consumer packages provide adapters. The `testing/` directory provides in-memory adapters for test harnesses.
- **Finite state machines**: `DagRunStateMachine` and `TaskRunStateMachine` encode all legal state transitions as a lookup table. Invalid transitions return errors rather than silently succeeding. Terminal states (`success`, `failed`, `cancelled`) have no outgoing transitions except the explicit `RETRY` gate on `TaskRun.failed -> queued`.
- **Abstract template pattern**: `AbstractNodeDefinition<TSchema>` provides a config-parsing template that delegates to `*WithConfig` methods, ensuring every lifecycle step receives a validated, typed config object. (Owned by node authoring package.)
- **Value object**: `MediaReference` is an immutable value object with factory methods (`fromAssetReference`, `fromBinary`, `fromCandidate`) and no public constructor. (Owned by node authoring package.)
- **SSOT ownership**: Every domain type is defined exactly once in this package. Other packages import from `@robota-sdk/dag-core` and never re-declare these contracts.

## Type Ownership

All types below are the canonical SSOT definitions. Other `dag-*` packages must import them from `@robota-sdk/dag-core`.

| Type | Location | Purpose |
|------|----------|---------|
| `TDagDefinitionStatus` | `types/domain.ts` | Definition lifecycle status: `draft`, `published`, `deprecated` |
| `TPortValueType` | `types/domain.ts` | Port data types: `string`, `number`, `boolean`, `object`, `array`, `binary` |
| `TBinaryKind` | `types/domain.ts` | Binary payload kind: `image`, `video`, `audio`, `file` |
| `TNodeConfigValue` | `types/domain.ts` | Recursive config value type (primitives, objects, arrays) |
| `TNodeConfigRecord` | `types/domain.ts` | Node configuration record (alias for `INodeConfigObject`) |
| `TAssetReference` | `types/domain.ts` | Discriminated union for asset-by-id or asset-by-uri references |
| `TDagRunStatus` | `types/domain.ts` | DAG run states: `created`, `queued`, `running`, `success`, `failed`, `cancelled` |
| `TTaskRunStatus` | `types/domain.ts` | Task run states: `created`, `queued`, `running`, `success`, `failed`, `upstream_failed`, `skipped`, `cancelled` |
| `TDagTriggerType` | `types/domain.ts` | Trigger types: `manual`, `scheduled`, `api` |
| `IPortDefinition` | `types/domain.ts` | Port schema (key, type, required, binary constraints, list constraints) |
| `INodeManifest` | `types/domain.ts` | Node registration manifest (type, display name, category, ports, config schema) |
| `ICostPolicy` | `types/domain.ts` | Run-level cost budget configuration |
| `IDagNode` | `types/domain.ts` | Node instance within a DAG definition |
| `IEdgeBinding` | `types/domain.ts` | Single output-to-input port binding on an edge |
| `IDagEdgeDefinition` | `types/domain.ts` | Edge connecting two nodes with bindings |
| `IDagDefinition` | `types/domain.ts` | Complete DAG definition (nodes, edges, cost policy, schemas) |
| `IDagRun` | `types/domain.ts` | DAG execution run record |
| `ITaskRun` | `types/domain.ts` | Individual task execution record within a DAG run |
| `IExecutionPathSegment` | `types/domain.ts` | Segment of the hierarchical execution path |
| `TErrorCategory` | `types/error.ts` | Error categories: `validation`, `state_transition`, `lease`, `dispatch`, `task_execution` |
| `IDagError` | `types/error.ts` | Canonical error structure (code, category, message, retryable, context) |
| `TResult<T, E>` | `types/result.ts` | Discriminated union result type for all domain operations |
| `INodeLifecycle` | `types/node-lifecycle.ts` | Full node lifecycle interface (initialize, validateInput, estimateCost, execute, validateOutput, dispose) |
| `INodeLifecycleFactory` | `types/node-lifecycle.ts` | Factory interface for creating `INodeLifecycle` instances by node type |
| `INodeManifestRegistry` | `types/node-lifecycle.ts` | Registry interface for looking up node manifests |
| `INodeTaskHandler` | `types/node-lifecycle.ts` | Partial lifecycle handler (only `execute` is required) |
| `INodeTaskHandlerRegistry` | `types/node-lifecycle.ts` | Registry interface for looking up task handlers |
| `IDagNodeDefinition` | `types/node-lifecycle.ts` | Composite definition combining manifest fields with a task handler |
| `INodeDefinitionAssembly` | `types/node-lifecycle.ts` | Assembly result of manifests and handlers from node definitions |
| `INodeExecutionContext` | `types/node-lifecycle.ts` | Execution context passed to lifecycle methods |
| `INodeExecutionResult` | `types/node-lifecycle.ts` | Execution result with output payload and cost data |
| `ICostEstimate` | `types/node-lifecycle.ts` | Cost estimate returned from `estimateCost` |
| `IRunCostPolicyEvaluator` | `types/node-lifecycle.ts` | Interface for budget enforcement |
| `TRunProgressEvent` | `types/run-progress.ts` | Discriminated union of all run progress event types |
| `IRunProgressEventReporter` | `types/run-progress.ts` | Interface for publishing progress events |
| `TPortValue` | `interfaces/ports.ts` | Union of all port value types (primitives, binary, arrays, objects) |
| `TPortPayload` | `interfaces/ports.ts` | Key-value map of port values |
| `IQueuePort` | `interfaces/ports.ts` | Queue infrastructure port (enqueue, dequeue, ack, nack) |
| `ILeasePort` | `interfaces/ports.ts` | Lease infrastructure port (acquire, renew, release, get) |
| `IStoragePort` | `interfaces/ports.ts` | Storage infrastructure port (definitions, runs, tasks) |
| `ITaskExecutorPort` | `interfaces/ports.ts` | Task execution infrastructure port |
| `IClockPort` | `interfaces/ports.ts` | Clock infrastructure port (nowIso, nowEpochMs) |
| `IQueueMessage` | `interfaces/ports.ts` | Queue message structure |
| `ITaskExecutionInput` | `interfaces/ports.ts` | Input payload for task execution |
| `TTaskExecutionResult` | `interfaces/ports.ts` | Discriminated union result from task execution |

## Public API Surface

| Export | Kind | Description |
|--------|------|-------------|
| `DagRunStateMachine` | Class | Static state machine for DAG run status transitions |
| `TaskRunStateMachine` | Class | Static state machine for task run status transitions |
| `DagDefinitionValidator` | Class | Validates `IDagDefinition` structure (graph acyclicity, port compatibility, binding integrity) |
| `DagDefinitionService` | Class | Domain service for DAG definition CRUD and publish lifecycle |
| `TimeSemanticsService` | Class | Resolves trigger type and logical date with UTC normalization |
| `NodeLifecycleRunner` | Class | Orchestrates the full node lifecycle sequence (init, validate, estimate, execute, validate output, dispose) |
| `RunCostPolicyEvaluator` | Class | Evaluates whether estimated cost fits within the run budget |
| `MissingNodeLifecycleFactory` | Class | Sentinel factory that always returns an error (used as default) |
| `LifecycleTaskExecutorPort` | Class | `ITaskExecutorPort` adapter that delegates to `NodeLifecycleRunner` |
| `buildValidationError` | Function | Error builder for `validation` category |
| `buildDispatchError` | Function | Error builder for `dispatch` category |
| `buildLeaseError` | Function | Error builder for `lease` category |
| `buildTaskExecutionError` | Function | Error builder for `task_execution` category |
| `buildDagError` | Function | Generic error builder for any category |
| `buildListPortHandleKey` | Function | Builds a list-port handle key string (e.g., `images[0]`) |
| `parseListPortHandleKey` | Function | Parses a list-port handle key back to port key and index |
| `DAG_DEFINITION_STATUS` | Constant | Definition status enum object |
| `DAG_RUN_STATUS` | Constant | DAG run status enum object |
| `TASK_RUN_STATUS` | Constant | Task run status enum object |
| `RUN_EVENTS`, `TASK_EVENTS`, `WORKER_EVENTS`, `SCHEDULER_EVENTS` | Constants | Domain event name constants |
| `EXECUTION_PROGRESS_EVENTS`, `TASK_PROGRESS_EVENTS` | Constants | Progress event name constants |
| `RUN_EVENT_PREFIX`, `TASK_EVENT_PREFIX`, `WORKER_EVENT_PREFIX`, `SCHEDULER_EVENT_PREFIX`, `EXECUTION_EVENT_PREFIX` | Constants | Event prefix strings |
| `DAG_CORE_PACKAGE_NAME` | Constant | Package name string `@robota-sdk/dag-core` |
| `InMemoryStoragePort` | Class (testing) | In-memory `IStoragePort` for tests |
| `InMemoryQueuePort` | Class (testing) | In-memory `IQueuePort` for tests |
| `InMemoryLeasePort` | Class (testing) | In-memory `ILeasePort` for tests |
| `FakeClockPort` | Class (testing) | Deterministic `IClockPort` for tests |
| `MockTaskExecutorPort` | Class (testing) | Mock `ITaskExecutorPort` for tests |

## Extension Points

### AbstractNodeDefinition\<TSchema\>

The primary extension point for node implementors. `dag-core` defines the `IDagNodeDefinition` and `INodeLifecycle` interfaces; the abstract base class and supporting infrastructure are owned by the node authoring package.

### Port Interfaces

Consumer packages implement these interfaces to provide infrastructure:

- `IStoragePort` -- persistence for definitions, runs, and tasks.
- `IQueuePort` -- message queue for task dispatch (enqueue, dequeue, ack, nack).
- `ILeasePort` -- distributed lease management (acquire, renew, release).
- `IClockPort` -- clock abstraction for deterministic time in tests.
- `ITaskExecutorPort` -- task execution delegation.

### INodeTaskHandler

A lighter alternative to full `INodeLifecycle`. Only `execute` is required; all other lifecycle methods are optional. The `RegisteredNodeLifecycle` wrapper fills in defaults and adds base port validation for handlers that omit `validateInput`/`validateOutput`.

## Error Taxonomy

### Error Structure

All errors conform to `IDagError`:

```typescript
interface IDagError {
    code: string;
    category: TErrorCategory;
    message: string;
    retryable: boolean;
    context?: Record<string, string | number | boolean>;
}
```

### Error Categories

| Category | Description | Default Retryable |
|----------|-------------|-------------------|
| `validation` | Schema, structure, or constraint violations | `false` |
| `state_transition` | Invalid state machine transitions | `false` |
| `lease` | Lease acquisition or renewal failures | `false` |
| `dispatch` | Task dispatch/queue failures | `true` |
| `task_execution` | Errors during node execution | varies |

### Error Codes

**Validation errors** (category: `validation`, retryable: `false`):

| Code | Source | Description |
|------|--------|-------------|
| `DAG_VALIDATION_EMPTY_DAG_ID` | `DagDefinitionValidator` | dagId is empty |
| `DAG_VALIDATION_INVALID_VERSION` | `DagDefinitionValidator` | version is not a positive integer |
| `DAG_VALIDATION_EMPTY_NODES` | `DagDefinitionValidator` | DAG has no nodes |
| `DAG_VALIDATION_EMPTY_NODE_ID` | `DagDefinitionValidator` | nodeId is empty |
| `DAG_VALIDATION_DUPLICATE_NODE_ID` | `DagDefinitionValidator` | duplicate nodeId |
| `DAG_VALIDATION_NODE_TYPE_REMOVED` | `DagDefinitionValidator` | deprecated node type used |
| `DAG_VALIDATION_EMPTY_INPUT_KEY` | `DagDefinitionValidator` | input port key is empty |
| `DAG_VALIDATION_EMPTY_OUTPUT_KEY` | `DagDefinitionValidator` | output port key is empty |
| `DAG_VALIDATION_DUPLICATE_INPUT_KEY` | `DagDefinitionValidator` | duplicate input port key within a node |
| `DAG_VALIDATION_DUPLICATE_OUTPUT_KEY` | `DagDefinitionValidator` | duplicate output port key within a node |
| `DAG_VALIDATION_INVALID_INPUT_ORDER` | `DagDefinitionValidator` | input port order is not a non-negative integer |
| `DAG_VALIDATION_INVALID_OUTPUT_ORDER` | `DagDefinitionValidator` | output port order is not a non-negative integer |
| `DAG_VALIDATION_INVALID_INPUT_MIN_ITEMS` | `DagDefinitionValidator` | input port minItems is invalid |
| `DAG_VALIDATION_INVALID_INPUT_MAX_ITEMS` | `DagDefinitionValidator` | input port maxItems is invalid |
| `DAG_VALIDATION_INVALID_INPUT_ITEM_RANGE` | `DagDefinitionValidator` | minItems exceeds maxItems |
| `DAG_VALIDATION_EDGE_FROM_NOT_FOUND` | `DagDefinitionValidator` | edge references nonexistent source node |
| `DAG_VALIDATION_EDGE_TO_NOT_FOUND` | `DagDefinitionValidator` | edge references nonexistent target node |
| `DAG_VALIDATION_BINDING_REQUIRED` | `DagDefinitionValidator` | edge has no bindings |
| `DAG_VALIDATION_BINDING_OUTPUT_NOT_FOUND` | `DagDefinitionValidator` | binding references nonexistent output port |
| `DAG_VALIDATION_BINDING_INPUT_NOT_FOUND` | `DagDefinitionValidator` | binding references nonexistent input port |
| `DAG_VALIDATION_BINDING_INPUT_KEY_DUPLICATE` | `DagDefinitionValidator` | multiple outputs map to same input in one edge |
| `DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT` | `DagDefinitionValidator` | multiple upstream edges map to same input |
| `DAG_VALIDATION_BINDING_TYPE_MISMATCH` | `DagDefinitionValidator` | output and input port types are incompatible |
| `DAG_VALIDATION_CYCLE_DETECTED` | `DagDefinitionValidator` | DAG contains a cycle |
| `DAG_VALIDATION_INVALID_COST_LIMIT` | `DagDefinitionValidator` | cost limit is not positive |
| `DAG_VALIDATION_INVALID_COST_POLICY_VERSION` | `DagDefinitionValidator` | cost policy version is not positive |
| `DAG_VALIDATION_TEST_ENTRY_NODE_COUNT_INVALID` | `DagDefinitionValidator` | test DAG has wrong entry node count |
| `DAG_VALIDATION_TEST_ENTRY_NODE_TYPE_INVALID` | `DagDefinitionValidator` | test DAG entry node is wrong type |
| `DAG_VALIDATION_DUPLICATE_VERSION` | `DagDefinitionService` | definition with same dagId and version already exists |
| `DAG_VALIDATION_DEFINITION_NOT_FOUND` | `DagDefinitionService` | definition does not exist |
| `DAG_VALIDATION_UPDATE_ONLY_DRAFT` | `DagDefinitionService` | only draft definitions can be updated |
| `DAG_VALIDATION_PUBLISH_ONLY_DRAFT` | `DagDefinitionService` | only draft definitions can be published |
| `DAG_VALIDATION_MISSING_LOGICAL_DATE` | `TimeSemanticsService` | scheduled trigger requires logicalDate |
| `DAG_VALIDATION_INVALID_LOGICAL_DATE` | `TimeSemanticsService` | logicalDate is not valid ISO-8601 |
| `DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID` | node definition base class | node config fails Zod schema parse |
| `DAG_VALIDATION_NODE_INPUT_MISSING` | node I/O accessor | required input key is missing |
| `DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH` | node I/O accessor, lifecycle wrapper | input value type does not match port type |
| `DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED` | node I/O accessor, lifecycle wrapper | list input has fewer items than minItems |
| `DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED` | node I/O accessor, lifecycle wrapper | list input has more items than maxItems |
| `DAG_VALIDATION_NODE_REQUIRED_INPUT_MISSING` | lifecycle wrapper | required input port value is missing |
| `DAG_VALIDATION_NODE_REQUIRED_OUTPUT_MISSING` | lifecycle wrapper | required output port value is missing |
| `DAG_VALIDATION_NODE_OUTPUT_TYPE_MISMATCH` | lifecycle wrapper | output value type does not match port type |
| `DAG_VALIDATION_NODE_OUTPUT_MIN_ITEMS_NOT_SATISFIED` | lifecycle wrapper | list output has fewer items than minItems |
| `DAG_VALIDATION_NODE_OUTPUT_MAX_ITEMS_EXCEEDED` | lifecycle wrapper | list output has more items than maxItems |
| `DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED` | lifecycle factory, `MissingNodeLifecycleFactory` | no lifecycle registered for node type |
| `DAG_VALIDATION_NODE_DEFINITION_MISSING` | `LifecycleTaskExecutorPort` | task execution input lacks nodeDefinition |
| `DAG_VALIDATION_NODE_MANIFEST_NOT_FOUND` | `LifecycleTaskExecutorPort` | no manifest registered for node type |
| `DAG_VALIDATION_NEGATIVE_ESTIMATED_COST` | `RunCostPolicyEvaluator` | estimated cost is negative |
| `DAG_VALIDATION_COST_LIMIT_EXCEEDED` | `RunCostPolicyEvaluator` | estimated run cost exceeds budget |
| `DAG_VALIDATION_MEDIA_REFERENCE_INVALID` | media reference value object | media reference structure is invalid |
| `DAG_VALIDATION_MEDIA_REFERENCE_XOR_REQUIRED` | media reference value object | exactly one of assetId or uri must be provided |
| `DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH` | media reference value object | referenceType does not match provided fields |

**State transition errors** (category: `state_transition`, retryable: `false`):

| Code | Source | Description |
|------|--------|-------------|
| `DAG_STATE_TRANSITION_INVALID` | `DagRunStateMachine`, `TaskRunStateMachine` | attempted transition is not allowed |

**Task execution errors** (category: `task_execution`, retryable: varies):

| Code | Source | Description |
|------|--------|-------------|
| `DAG_TASK_EXECUTION_DISPOSE_FAILED` | `NodeLifecycleRunner` | node dispose step failed after successful execution |

## State Lifecycle

### DagRun State Machine

States: `created`, `queued`, `running`, `success`, `failed`, `cancelled`

Terminal states: `success`, `failed`, `cancelled`

```
created --QUEUE--> queued --START--> running --COMPLETE_SUCCESS--> success
created --CANCEL--> cancelled
queued --CANCEL--> cancelled
running --COMPLETE_FAILURE--> failed
running --CANCEL--> cancelled
```

Each transition emits a domain event with the `run.*` prefix (e.g., `run.queued`, `run.running`).

### TaskRun State Machine

States: `created`, `queued`, `running`, `success`, `failed`, `upstream_failed`, `skipped`, `cancelled`

Terminal states: `success`, `upstream_failed`, `skipped`, `cancelled`

**Note**: The `failed` state is NOT terminal — it has a single explicit policy gate: `RETRY` transitions back to `queued`. This is intentional: a failed task may be retried via the DLQ reinject mechanism. Consumer packages implementing run finalization must treat `failed` as terminal only when no remaining retries exist (i.e., a failed task with no remaining retries is effectively terminal for DAG completion evaluation).

### Finalization Semantics

For DAG run finalization (determining `success` vs `failed` outcome):

- `failed` is the **only** task status that contributes to a `failed` DAG run outcome.
- `upstream_failed`, `skipped`, and `cancelled` are non-failure terminal states — they do not cause the DAG run to fail.
- A DAG run is `success` when all tasks are in terminal states AND no task is `failed`.

```
created --QUEUE--> queued --START--> running --COMPLETE_SUCCESS--> success
created --CANCEL--> cancelled
queued --UPSTREAM_FAIL--> upstream_failed
queued --SKIP--> skipped
queued --CANCEL--> cancelled
running --COMPLETE_FAILURE--> failed
running --CANCEL--> cancelled
failed --RETRY--> queued
```

Each transition emits a domain event with the `task.*` prefix (e.g., `task.queued`, `task.running`).

## Event Architecture

`dag-core` defines event name constants but does not own an event bus or emitter. Event prefixes owned by this package:

| Prefix | Constant | Domain |
|--------|----------|--------|
| `run` | `RUN_EVENT_PREFIX` | DAG run state changes |
| `task` | `TASK_EVENT_PREFIX` | Task run state changes |
| `worker` | `WORKER_EVENT_PREFIX` | Worker lifecycle events |
| `scheduler` | `SCHEDULER_EVENT_PREFIX` | Scheduler evaluation events |
| `execution` | `EXECUTION_EVENT_PREFIX` | Execution progress events |

Progress event types are defined as `TRunProgressEvent` (discriminated union) with reporter interface `IRunProgressEventReporter`.

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `zod` | Runtime schema validation for node configs and media references |
| `zod-to-json-schema` | Converts Zod schemas to JSON Schema 7 for manifest `configSchema` |

No peer dependencies.

## Class Contract Registry

### Internal Implementations

Implementations owned by this package:

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `INodeLifecycleFactory` | `MissingNodeLifecycleFactory` | sentinel | `src/lifecycle/node-lifecycle-runner.ts` |
| `IRunCostPolicyEvaluator` | `RunCostPolicyEvaluator` | production | `src/lifecycle/node-lifecycle-runner.ts` |
| `ITaskExecutorPort` | `LifecycleTaskExecutorPort` | production | `src/lifecycle/lifecycle-task-executor-port.ts` |
| `IStoragePort` | `InMemoryStoragePort` | test adapter | `src/testing/in-memory-storage-port.ts` |
| `IQueuePort` | `InMemoryQueuePort` | test adapter | `src/testing/in-memory-queue-port.ts` |
| `ILeasePort` | `InMemoryLeasePort` | test adapter | `src/testing/in-memory-lease-port.ts` |
| `IClockPort` | `FakeClockPort` | test adapter | `src/testing/fake-clock-port.ts` |
| `IClockPort` | `SystemClockPort` | test adapter | `src/testing/fake-clock-port.ts` |
| `ITaskExecutorPort` | `MockTaskExecutorPort` | test adapter | `src/testing/mock-task-executor-port.ts` |

### Interfaces Designed for External Implementation

The following interfaces are defined by `dag-core` and intended to be implemented by consumer packages. Each consumer package documents its own implementations in its SPEC.md.

| Interface | Expected Implementor Role |
|-----------|--------------------------|
| `IDagNodeDefinition` | Node authoring packages (abstract base class) |
| `INodeLifecycle` | Node authoring packages (lifecycle wrapper) |
| `INodeLifecycleFactory` | Node authoring packages (factory from handler registry) |
| `INodeManifestRegistry` | Node authoring packages (manifest lookup) |
| `INodeTaskHandlerRegistry` | Node authoring packages (handler lookup) |
| `IStoragePort` | Persistence adapters (file, database) |
| `IQueuePort` | Message queue adapters |
| `ILeasePort` | Distributed lease adapters |
| `IClockPort` | Clock adapters (system, deterministic) |
| `ITaskExecutorPort` | Task execution adapters |

## Test Strategy

### Current Test Files

| File | Coverage |
|------|----------|
| `__tests__/definition-service.test.ts` | `DagDefinitionValidator` (duplicate nodeId, cycle detection), `DagDefinitionService` (publish invalid, update non-draft) |
| `__tests__/time-semantics.test.ts` | `TimeSemanticsService` (manual/api/scheduled triggers, UTC normalization, invalid date rejection) |

### Coverage Gaps

The following areas lack dedicated unit tests in this package:

- **DagRunStateMachine** and **TaskRunStateMachine**: No tests for valid transitions, invalid transitions, or domain event emission. May be tested indirectly by consumer packages.
- **NodeLifecycleRunner**: No tests for the full lifecycle sequence (init, validate, estimate, budget check, execute, validate output, dispose) or cost policy evaluation.
- **RunCostPolicyEvaluator**: No tests for budget enforcement (negative cost, limit exceeded, within budget).
- **LifecycleTaskExecutorPort**: No tests for manifest lookup, node definition validation, or runner delegation.
- **DagDefinitionValidator**: Partial coverage. Missing tests for edge binding validation, port type compatibility, cost policy validation, list port handle resolution, and many specific validation codes.
- **MediaReference**, **StaticNodeManifestRegistry**, **StaticNodeTaskHandlerRegistry**: Owned by the node authoring package; tested there.
- **In-memory testing ports**: No tests verifying the correctness of test double implementations.
