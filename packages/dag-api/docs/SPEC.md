# DAG API Specification

## Scope

API-layer contracts and thin controllers for DAG design, runtime, diagnostics, and
observability operations. This package exposes endpoint-facing request/response shapes,
controller implementations, and narrow service ports consumed by those controllers.

## Boundaries

- Does not own core domain contracts (`IDagDefinition`, `IDagRun`, `ITaskRun`, state machines) -- those belong to `dag-core`.
- Does not own runtime orchestration logic -- delegates through API-owned service ports.
- Does not own worker execution or DLQ behavior -- delegates through API-owned service ports.
- Does not own projection read-model logic -- delegates through API-owned service ports.
- Does not own operational HTTP client behavior -- that belongs to `@robota-sdk/dag-orchestration-client`.
- Depends on `dag-core` only for production domain contracts. Runtime, worker, scheduler,
  and projection packages must not be production dependencies of this package.

## Architecture Overview

The package follows a controller-composition pattern:

- **Contracts** (`contracts/`): Define API request/response types and the `IProblemDetails` error shape.
- **Ports** (`ports/`): Define the minimal runtime, diagnostics, and observability service capabilities required by controllers.
- **Controllers** (`controllers/`): Thin API controllers that delegate to domain services and map results to API responses. Four controllers: Design, Runtime, Diagnostics, Observability.
- **Composition roots** (`composition/`): Factory functions that wire controllers from already-created port implementations.
  - `createDagControllerComposition` -- assembles all four controllers from API-owned ports.
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
- `IRunProjectionView`, `ILineageProjectionView`, `IObservabilityProjectionReaderPort` -- observability controller DTO and port contracts
- `IRuntimeRunStarterPort`, `IRuntimeRunReaderPort`, `IRuntimeRunCancellerPort`, `IDiagnosticsDeadLetterReinjectPort` -- runtime and diagnostics controller service ports
- `IDagControllerComposition`, `IDagControllerCompositionDependencies`, `IDagControllerCompositionOptions` -- controller composition types
- `IDagExecutionComposition` -- runtime execution composition port consumed by Prompt API backends
- `IRunProgressEventBus`, `TRunProgressEventListener` -- event bus types
- `INodeCatalogService` -- runtime `TObjectInfo` node catalog port interface
- `IDiagnosticsPolicy` -- diagnostics policy interface

## Public API Surface

- `toProblemDetails(error, instance, correlationId?)` -- maps `IDagError` to `IProblemDetails`
- `toRuntimeProblemDetails(error, instance, correlationId?)` -- runtime-specific alias
- `DagDesignController` -- CRUD + validate + publish for DAG definitions
- `DagRuntimeController` -- trigger, query, cancel runs
- `DagObservabilityController` -- run/lineage/dashboard projection queries
- `DagDiagnosticsController` -- failure analysis, rerun, DLQ reinject
- `createDagControllerComposition(deps, options?)` -- wires all controllers from explicit service ports
- `IDagExecutionComposition` -- interface-only execution composition contract; implementations live in runtime composition roots
- `RunProgressEventBus` -- in-memory pub/sub for run progress events

## Extension Points

- `INodeCatalogService` -- implement to provide runtime `TObjectInfo` listing and async node type validation. Implementations return `TResult` so catalog/runtime failures are mapped to API problem details instead of escaping the controller layer.
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

| Interface                            | Implementor                                     | Kind       | Location                                    |
| ------------------------------------ | ----------------------------------------------- | ---------- | ------------------------------------------- |
| `IRunProgressEventBus`               | `RunProgressEventBus`                           | production | `src/composition/run-progress-event-bus.ts` |
| `INodeCatalogService`                | (external: runtime object-info catalog service) | port       | N/A (consumed via DI)                       |
| `IRuntimeRunStarterPort`             | (external runtime service)                      | port       | N/A (consumed via DI)                       |
| `IRuntimeRunReaderPort`              | (external runtime service)                      | port       | N/A (consumed via DI)                       |
| `IRuntimeRunCancellerPort`           | (external runtime service)                      | port       | N/A (consumed via DI)                       |
| `IObservabilityProjectionReaderPort` | (external projection service)                   | port       | N/A (consumed via DI)                       |
| `IDiagnosticsDeadLetterReinjectPort` | (external worker/DLQ service)                   | port       | N/A (consumed via DI)                       |
| `IDiagnosticsPolicy`                 | (external)                                      | port       | N/A (consumed via DI)                       |

### Inheritance Chains

None. Controller and composition classes are standalone.

### Port Consumption via DI

| Service/Controller               | Injected Port                                                                                          | Location           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| `createDagControllerComposition` | `IStoragePort`, `IRuntimeRunStarterPort`, `IRuntimeRunReaderPort`, `IRuntimeRunCancellerPort`          | `src/composition/` |
| `createDagControllerComposition` | `IObservabilityProjectionReaderPort`, `IDiagnosticsDeadLetterReinjectPort`, optional node catalog port | `src/composition/` |

### Cross-Package Port Consumers

| Port (Owner)                                   | Consumer                                       | Location           |
| ---------------------------------------------- | ---------------------------------------------- | ------------------ |
| `IStoragePort` (dag-core)                      | Controller composition factories               | `src/composition/` |
| `IRuntimeRunStarterPort` (dag-api)             | `DagRuntimeController`, diagnostics controller | `src/controllers/` |
| `IRuntimeRunReaderPort` (dag-api)              | `DagRuntimeController`, diagnostics controller | `src/controllers/` |
| `IRuntimeRunCancellerPort` (dag-api)           | `DagRuntimeController`                         | `src/controllers/` |
| `IObservabilityProjectionReaderPort` (dag-api) | `DagObservabilityController`                   | `src/controllers/` |
| `IDiagnosticsDeadLetterReinjectPort` (dag-api) | `DagDiagnosticsController`                     | `src/controllers/` |

## Test Strategy

- **Unit tests**: `src/__tests__/run-progress-event-bus.test.ts`, controller tests, controller composition tests
- **E2E tests**: `design-flow-e2e.test.ts`
- Tests use in-memory port implementations from `dag-adapters-local` and controller service stubs.
- Coverage focus: controller request/response mapping, port-driven composition wiring, error-to-problem-details translation, event bus pub/sub lifecycle.
- Run: `pnpm --filter @robota-sdk/dag-api test`
