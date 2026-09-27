# @robota-sdk/dag-runtime

The run orchestration layer of the DAG engine: it creates runs from published definitions, resolves
their logical date, moves run and task state through the `dag-core` state machines, enqueues entry
tasks, and answers run queries and cancellations. Executing the queued tasks is `dag-worker`'s job.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) only. It imports no sibling DAG
  package and ships no storage, queue or clock implementation; every port is injected.
- Used by: [`dag-framework`](../dag-framework/README.md) (its execution composition) and
  [`dag-scheduler`](../dag-scheduler/README.md) (which triggers runs through
  `RunOrchestratorService`).

## Main exports

- `RunOrchestratorService(storage, queue, clock, progressReporter?, snapshotBudget?)` —
  `createRun(input)` validates and records a run without dispatching it; `startCreatedRun(dagRunId)`
  enqueues its entry tasks and is idempotent; `startRun(input)` does both. A run is keyed by DAG and
  logical date (plus an optional rerun key), so a repeated request for the same key returns the
  existing run. Scheduled triggers must supply `logicalDate`; manual and API triggers default it to
  the current time.
- `RunQueryService(storage)` — `getRun(dagRunId)` returns the run and its task runs.
- `RunCancelService(storage, clock, notifier?)` — `cancelRun(dagRunId)` cancels through the run
  state machine; the optional notifier is told once the cancellation has been committed.
- `IStartRunInput`, `IStartRunResult`, `ICreateRunResult`, `IRunQueryResult`, `IRunCancelResult` —
  the request and result shapes.

Every method returns `TResult<…, IDagError>`.

## Usage

```ts
import {
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { RunCancelService, RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';

const storage = new InMemoryStoragePort();
const queue = new InMemoryQueuePort();
const clock = new SystemClockPort();

declare const definition: IDagDefinition; // status: 'published'
await storage.saveDefinition(definition);

const orchestrator = new RunOrchestratorService(storage, queue, clock);
const started = await orchestrator.startRun({
  dagId: definition.dagId,
  trigger: 'manual',
  input: {},
});
if (started.ok) {
  // Entry tasks are on the queue now; a dag-worker WorkerLoopService executes them.
  const run = await new RunQueryService(storage).getRun(started.value.dagRunId);
  if (run.ok) console.log(run.value.dagRun.status); // 'running'
  await new RunCancelService(storage, clock).cancelRun(started.value.dagRunId);
}
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — purpose, boundaries and the contract for entry-task dispatch, run-key
  idempotency, budgets and cancellation.
