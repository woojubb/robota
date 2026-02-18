# API Server Host Specification

## Scope
- Hosts DAG development APIs and runtime bootstrap composition.
- Provides local development endpoints for design/runtime/run flows.
- `POST /v1/dag/runs` stores a temporary run definition snapshot and creates a run:
  - stores a DAG definition copy snapshot
  - starts runtime execution via `/v1/dag/runs/:dagRunId/start`
  - queries terminal run state and maps task snapshots to run traces
- Provides manual cleanup APIs for persisted artifacts:
  - `DELETE /v1/dag/runs/:dagRunId`
  - `DELETE /v1/dag/dev/definitions/:dagId?version=...`
  - `DELETE /v1/dag/runs/temporary-copies`

## Boundaries
- Host-level composition only.
- Core package contracts remain in DAG packages.
- `.local-assets/` is local runtime data only and must never be committed.
