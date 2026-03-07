# DAG Projection Specification

## Scope

Builds query/read models for DAG runs and tasks from storage records.
Provides run projections (status summaries), lineage projections (graph structure with
task status overlay), and combined dashboard projections. All projection updates are
deterministic from explicit fields -- no derived heuristics.

## Boundaries

- Depends on `dag-core` for domain contracts (`IDagRun`, `ITaskRun`, `IDagDefinition`, `IStoragePort`), error builders, and status types.
- No dispatch, worker, or scheduling behavior in this package.
- Does not mutate run or task state -- read-only projections.
- Does not own API response shaping -- that belongs to `dag-api`.

## Architecture Overview

Single-service architecture:

- **ProjectionReadModelService** (`services/projection-read-model-service.ts`): Accepts `IStoragePort` via constructor. Provides three projection builders:
  1. `buildRunProjection(dagRunId)` -- fetches `IDagRun` and its `ITaskRun[]`, computes a `ITaskStatusSummary` counting tasks by status.
  2. `buildLineageProjection(dagRunId)` -- builds on top of run projection, fetches the definition, maps nodes and edges with optional task status overlay.
  3. `buildDashboardProjection(dagRunId)` -- combines run and lineage projections into a single response.

## Type Ownership

This package is SSOT for:

- `ITaskStatusSummary` -- counts per task status (created, queued, running, success, failed, upstream_failed, skipped, cancelled)
- `IRunProjection` -- run projection (dagRun, taskRuns, taskStatusSummary)
- `ILineageNodeProjection` -- lineage node (nodeId, nodeType, dependsOn, taskStatus?)
- `ILineageEdgeProjection` -- lineage edge (from, to)
- `ILineageProjection` -- lineage projection (dagId, version, dagRunId, nodes, edges)
- `IDashboardProjection` -- combined run + lineage projection

## Public API Surface

- `ProjectionReadModelService` -- main service class
  - `constructor(storage: IStoragePort)`
  - `buildRunProjection(dagRunId): Promise<TResult<IRunProjection, IDagError>>`
  - `buildLineageProjection(dagRunId): Promise<TResult<ILineageProjection, IDagError>>`
  - `buildDashboardProjection(dagRunId): Promise<TResult<IDashboardProjection, IDagError>>`

## Extension Points

- Accepts `IStoragePort` from `dag-core` via constructor injection. Custom storage implementations provide the underlying data.
- No abstract classes to extend; the service is used directly.
- `dag-api`'s `DagObservabilityController` consumes this service for API-layer projection queries.

## Error Taxonomy

All errors use `IDagError` from `dag-core` with `category: 'validation'`:

- `DAG_VALIDATION_DAG_RUN_NOT_FOUND` -- DAG run not found for the requested projection
- `DAG_VALIDATION_DEFINITION_NOT_FOUND` -- definition not found for lineage projection (required to map nodes and edges)

## Test Strategy

- **Unit tests**: `projection-read-model-service.test.ts`
- Tests use in-memory port implementations from `dag-core`.
- Coverage focus: run projection with status summary computation, lineage projection with node/edge mapping and task status overlay, dashboard composition, error paths for missing run and missing definition.
- Run: `pnpm --filter @robota-sdk/dag-projection test`
