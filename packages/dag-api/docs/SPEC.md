# DAG API Specification

## Scope

API-layer composition for DAG design, runtime, diagnostics, and observability operations.
Exposes endpoint-facing contracts, response shapes, and controller implementations that
orchestrate domain services from `dag-core`, `dag-runtime`, `dag-projection`, and `dag-worker`.

## Boundaries

- Does not own core domain contracts (`IDagDefinition`, `IDagRun`, `ITaskRun`, state machines) -- those belong to `dag-core`.
- Does not own runtime orchestration logic -- delegates to `dag-runtime` services.
- Does not own worker execution or DLQ behavior -- delegates to `dag-worker`.
- Does not own projection read-model logic -- delegates to `dag-projection`.
- Depends on `dag-core` (SSOT), `dag-runtime`, `dag-projection`, and `dag-worker` as sibling dependencies.

## Architecture Overview

The package follows a controller-composition pattern:

- **Contracts** (`contracts/`): Define API request/response types and the `IProblemDetails` error shape.
- **Controllers** (`controllers/`): Thin API controllers that delegate to domain services and map results to API responses. Four controllers: Design, Runtime, Diagnostics, Observability.
- **Composition roots** (`composition/`): Factory functions that wire domain services and controllers together from port dependencies.
  - `createDagControllerComposition` -- assembles all four controllers.
  - `createDagExecutionComposition` -- assembles runtime + worker loop for in-process execution.
  - `RunProgressEventBus` -- pub/sub bus for `TRunProgressEvent` streaming.

## Type Ownership

This package is SSOT for:

- `IProblemDetails` -- RFC 7807-style error detail shape
- `TDesignApiSuccess<TData>`, `TDesignApiFailure`, `TDesignApiResponse<TData>` -- design API result aliases
- `IApiSuccess<TData>`, `IApiFailure<TError>`, `TApiResponse<TData, TError>` -- generic API envelope types
- `ICreateDefinitionRequest`, `IUpdateDraftRequest`, `IValidateDefinitionRequest`, `IPublishDefinitionRequest`, `IGetDefinitionRequest`, `IListDefinitionsRequest`, `IListNodeCatalogRequest` -- design API request types
- `IDefinitionListItem`, `IDefinitionValidationResult` -- design API response types
- `ITriggerRunRequest`, `IQueryRunRequest`, `ICancelRunRequest` -- runtime API request types
- `IAnalyzeFailureRequest`, `IRerunRequest`, `IReinjectDeadLetterRequest`, `IFailureCodeCount`, `IFailureAnalysis` -- diagnostics API types
- `IQueryRunProjectionRequest`, `IQueryLineageProjectionRequest`, `IObservabilityDashboardData` -- observability API types
- `IDagControllerComposition`, `IDagControllerCompositionDependencies`, `IDagControllerCompositionOptions` -- controller composition types
- `IDagExecutionComposition`, `IDagExecutionCompositionDependencies`, `IDagExecutionCompositionOptions` -- execution composition types
- `IRunProgressEventBus`, `TRunProgressEventListener` -- event bus types
- `INodeCatalogService` -- node catalog port interface
- `IDiagnosticsPolicy` -- diagnostics policy interface

## Public API Surface

- `toProblemDetails(error, instance, correlationId?)` -- maps `IDagError` to `IProblemDetails`
- `toRuntimeProblemDetails(error, instance, correlationId?)` -- runtime-specific alias
- `DagDesignController` -- CRUD + validate + publish for DAG definitions
- `DagRuntimeController` -- trigger, query, cancel runs
- `DagObservabilityController` -- run/lineage/dashboard projection queries
- `DagDiagnosticsController` -- failure analysis, rerun, DLQ reinject
- `createDagControllerComposition(deps, options?)` -- wires all controllers
- `createDagExecutionComposition(deps, options)` -- wires runtime + worker loop
- `RunProgressEventBus` -- in-memory pub/sub for run progress events

## Extension Points

- `INodeCatalogService` -- implement to provide node manifest listing and type validation.
- `IDiagnosticsPolicy` -- configure to enable/disable DLQ reinject.
- All composition factories accept port interfaces (`IStoragePort`, `IQueuePort`, `IClockPort`, `ILeasePort`, `ITaskExecutorPort`) from `dag-core`, allowing custom implementations.

## Error Taxonomy

All API errors use the `IProblemDetails` shape with URN-based `type` field:

- `urn:robota:problems:dag:validation` (HTTP 400) -- validation failures
- `urn:robota:problems:dag:state_transition` (HTTP 409) -- invalid state transitions
- `urn:robota:problems:dag:lease` (HTTP 400) -- lease contract violations
- `urn:robota:problems:dag:dispatch` (HTTP 503) -- dispatch unavailability
- `urn:robota:problems:dag:task_execution` (HTTP 500) -- task execution failures

Controller-specific codes:

- `DAG_VALIDATION_DEFINITION_NOT_FOUND` (404)
- `DAG_VALIDATION_NODE_TYPE_NOT_REGISTERED` (400)
- `DAG_VALIDATION_NODE_CATALOG_NOT_CONFIGURED` (400)
- `DAG_POLICY_REINJECT_DISABLED` (409)

## Class Contract Registry

### Interface Implementations

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IRunProgressEventBus` | `RunProgressEventBus` | production | `src/composition/run-progress-event-bus.ts` |
| `INodeCatalogService` | (external: `BundledNodeCatalogService` in dag-server-core) | port | N/A (consumed via DI) |
| `IDiagnosticsPolicy` | (external) | port | N/A (consumed via DI) |

### Inheritance Chains

None. Controller and composition classes are standalone.

### Port Consumption via DI

| Service/Controller | Injected Port (from dag-core) | Location |
|-------------------|------------------------------|----------|
| `createDagControllerComposition` | `IStoragePort`, `IQueuePort`, `IClockPort`, `ILeasePort`, `ITaskExecutorPort` | `src/composition/` |
| `createDagExecutionComposition` | `IStoragePort`, `IQueuePort`, `IClockPort`, `ILeasePort`, `ITaskExecutorPort` | `src/composition/` |

### Cross-Package Port Consumers

| Port (Owner) | Consumer | Location |
|--------------|---------|----------|
| `IStoragePort` (dag-core) | Controller composition factories | `src/composition/` |
| `IQueuePort` (dag-core) | Controller composition factories | `src/composition/` |
| `IClockPort` (dag-core) | Controller composition factories | `src/composition/` |
| `ILeasePort` (dag-core) | Controller composition factories | `src/composition/` |
| `ITaskExecutorPort` (dag-core) | Controller composition factories | `src/composition/` |
| `RunOrchestratorService` (dag-runtime) | `DagRuntimeController` | `src/controllers/` |
| `ProjectionReadModelService` (dag-projection) | `DagObservabilityController` | `src/controllers/` |
| `WorkerLoopService` (dag-worker) | Execution composition | `src/composition/` |

## Test Strategy

- **Unit tests**: `src/__tests__/run-progress-event-bus.test.ts`, `execution-composition.test.ts`
- **E2E tests**: `design-flow-e2e.test.ts`, `runtime-flow-e2e.test.ts`, `diagnostics-flow-e2e.test.ts`, `observability-flow-e2e.test.ts`, `single-dagrun-e2e.test.ts`
- Tests use in-memory port implementations from `dag-core`.
- Coverage focus: controller request/response mapping, composition wiring, error-to-problem-details translation, event bus pub/sub lifecycle.
- Run: `pnpm --filter @robota-sdk/dag-api test`
