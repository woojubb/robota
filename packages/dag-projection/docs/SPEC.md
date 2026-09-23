# DAG Projection Specification

## Purpose

Builds query/read models for DAG runs and tasks from storage records: run projections (status
summaries), lineage projections (graph structure with task-status overlay), and combined dashboard
projections.

## Boundaries

- Read-only: never mutates run or task state.
- No dispatch, worker, or scheduling behavior.
- Does not own API response shaping — that belongs to `dag-api`. Does not depend on `dag-api`;
  instead, `ProjectionReadModelService` is kept structurally compatible with `dag-api`'s
  observability-projection reader port, and composition roots wire the two together.

## Contract

- All projection fields are deterministic from explicit stored fields — no derived heuristics or
  inferred status.
- A lineage or dashboard projection for a DAG run whose definition can no longer be found fails
  explicitly (definition-not-found), rather than returning a partial graph.

## Design decisions

- Kept as a single injectable service (constructor takes only `IStoragePort`) rather than one
  class per projection type, so all three projections share one consistent read path over
  storage.
