# API Server Host Specification

## Scope
- Hosts DAG development APIs and runtime bootstrap composition.
- Provides local development endpoints for design/runtime/preview flows.
- `POST /v1/dag/dev/preview` is a thin adapter over persisted runtime flow:
  - stores a DAG definition copy snapshot
  - triggers runtime execution
  - queries terminal run state and maps task snapshots to preview traces
- Provides manual cleanup APIs for persisted artifacts:
  - `DELETE /v1/dag/dev/runs/:dagRunId`
  - `DELETE /v1/dag/dev/definitions/:dagId?version=...`
  - `DELETE /v1/dag/dev/preview-copies`

## Boundaries
- Host-level composition only.
- Core package contracts remain in DAG packages.
