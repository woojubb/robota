# @robota-sdk/dag-api

The API layer of the DAG engine: thin controllers for design, runtime, observability and
diagnostics, the request/response types they use, the narrow service ports they call, and the
`IProblemDetails` error envelope. Controllers turn domain results into `{ ok, status, data }` or
`{ ok, status, errors }` responses; they hold no runtime logic of their own.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) only. Runtime, worker, scheduler and
  projection packages are not dependencies; controllers reach them through the ports below.
- Used by: [`dag-framework`](../dag-framework/README.md), which builds the controllers and uses
  `RunProgressEventBus` and the run lifecycle port, and
  [`apps/dag-runtime-server`](../../apps/dag-runtime-server/docs/README.md), which maps results to
  HTTP with `toProblemDetails`.

Worker execution and advancement belong to [`dag-worker`](../dag-worker/README.md), framework
assembly to [`dag-framework`](../dag-framework/README.md), and the HTTP client to
[`dag-orchestration-client`](../dag-orchestration-client/README.md).

## Main exports

- `DagDesignController`, `DagRuntimeController`, `DagObservabilityController`,
  `DagDiagnosticsController` — create, validate, publish and list definitions; trigger, query and
  cancel runs; read projections; analyze failures, rerun and reinject dead letters.
- `createDagControllerComposition(dependencies, options?)` — builds all four controllers from
  `storage` and the run starter, reader, canceller, projection-reader and dead-letter ports.
- `PromptApiController` — the prompt-format API (submit a prompt, queue, history, object info,
  system stats) over an `IPromptBackendPort`.
- `IProblemDetails`, `toProblemDetails(error, instance, correlationId?)` — the RFC 7807-style error
  envelope with a URN `type` (`urn:robota:problems:dag:<category>`), so callers branch on category
  without parsing messages.
- `IDagRunLifecyclePort` — in-process run lifecycle (`createRun`, `startRun`, `getRun`,
  `cancelRun`, `startPublishedWorkflowRun`) that reports domain results, not HTTP statuses.
- `IRuntimeRunStarterPort`, `IRuntimeRunReaderPort`, `IRuntimeRunCancellerPort`,
  `IObservabilityProjectionReaderPort`, `IDiagnosticsDeadLetterReinjectPort` — the ports controllers
  consume.
- `RunProgressEventBus` — in-memory publish/subscribe for run progress events.

## Usage

The ports are satisfied structurally by the runtime, projection and worker services:

```ts
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import { createDagControllerComposition } from '@robota-sdk/dag-api';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import { RunCancelService, RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import { DlqReinjectService } from '@robota-sdk/dag-worker';

const storage = new InMemoryStoragePort();
const queue = new InMemoryQueuePort();
const deadLetterQueue = new InMemoryQueuePort();
const clock = new SystemClockPort();

const controllers = createDagControllerComposition({
  storage,
  runStarter: new RunOrchestratorService(storage, queue, clock),
  runReader: new RunQueryService(storage),
  runCanceller: new RunCancelService(storage, clock),
  projectionReader: new ProjectionReadModelService(storage),
  deadLetterReinject: new DlqReinjectService(
    storage,
    deadLetterQueue,
    queue,
    new InMemoryLeasePort(),
    clock,
  ),
});

const response = await controllers.runtime.queryRun({ dagRunId: 'missing-run' });
if (!response.ok) {
  console.log(response.status, response.errors[0]?.type); // 404 'urn:robota:problems:dag:validation'
}
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — scope, boundaries, contract guarantees and extension points.
