# @robota-sdk/dag-projection

Read models for DAG runs. `ProjectionReadModelService` builds, from storage records, a run
projection (the run, its task runs and a count per task status), a lineage projection (the
definition's node graph with each node's task status) and a dashboard projection that combines
both.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) only.
- Used by: [`dag-framework`](../dag-framework/README.md), which passes it to `dag-api`'s
  observability controller. It does not import [`dag-api`](../dag-api/README.md); its service is
  structurally compatible with `dag-api`'s `IObservabilityProjectionReaderPort`, and composition
  roots connect the two.

The service is read-only: it never changes run or task state and has no dispatch, worker or
scheduling behavior.

## Main exports

- `ProjectionReadModelService(storage)` — `buildRunProjection(dagRunId)`,
  `buildLineageProjection(dagRunId)` and `buildDashboardProjection(dagRunId)`, each returning
  `TResult<…, IDagError>`. A lineage or dashboard projection fails with a not-found error when the
  run's definition no longer exists, rather than returning a partial graph.
- `IRunProjection`, `ILineageProjection`, `ILineageNodeProjection`, `ILineageEdgeProjection`,
  `IDashboardProjection`, `TTaskStatusSummary` — the projection shapes.

## Usage

```ts
import type { IStoragePort } from '@robota-sdk/dag-core';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';

declare const storage: IStoragePort;
declare const dagRunId: string;

const projections = new ProjectionReadModelService(storage);
const dashboard = await projections.buildDashboardProjection(dagRunId);
if (dashboard.ok) {
  const { runProjection, lineageProjection } = dashboard.value;
  console.log(runProjection.taskStatusSummary.success); // tasks that succeeded
  console.log(lineageProjection.nodes.map((node) => `${node.nodeId}: ${node.taskStatus}`));
}
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — purpose, boundaries, contract and design decisions.
