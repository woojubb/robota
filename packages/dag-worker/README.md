# @robota-sdk/dag-worker

The execution side of the DAG engine: it takes queued tasks, runs them through an
`ITaskExecutorPort`, and advances the run — leases, timeouts, retries, the dead-letter queue,
downstream dispatch, crash recovery and run finalization. `RunAdvancementCoordinator` is the single
actor that drives this for one queue.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) and `@robota-sdk/agent-core` (for the
  trusted execution-root check).
- Used by: [`dag-framework`](../dag-framework/README.md), whose execution composition wires one
  worker and one coordinator per queue. Creating and starting runs belongs to
  [`dag-runtime`](../dag-runtime/README.md).

## Main exports

- `createWorkerLoopService(dependencies, options)` — builds a `WorkerLoopService` from ports
  (`storage`, `queue`, `lease`, `executor`, `clock`, a required absolute `executionRoot`, and an
  optional dead-letter queue) and policy options (`workerId`, `leaseDurationMs`,
  `visibilityTimeoutMs`, `maxAttempts`, `defaultTimeoutMs`, and optional `idleWaitMs`,
  `retryEnabled`, `deadLetterEnabled`). Retry and dead-lettering are off unless enabled.
- `WorkerLoopService` — `processOnce()` dequeues and processes one task. With `idleWaitMs` set, an
  idle dequeue waits for the queue to wake it instead of relying on fixed sleep polling.
- `RunAdvancementCoordinator(worker, runReader, logger?)` — the only actor that calls
  `processOnce()` for one worker/queue composition. `start()` begins persistent advancement;
  `waitForTerminal(dagRunId, { signal?, deadlineEpochMs? })` resolves when the run is terminal;
  `stop()` settles observers and drains only the in-flight step.
- `DlqReinjectService` — `reinjectOnce(workerId, visibilityTimeoutMs)` moves one message from the
  dead-letter queue back to the main queue with the next attempt number.
- `sweepStaleTaskRuns(storage, queue, clock, lease, options)` — requeues or abandons tasks whose
  worker died, for queues that do not redeliver; the worker also runs it when idle.

Persistent background advancement and concurrent `waitForTerminal()` observers share one actor, so
only one worker step is active for the queue. An observer's abort signal or deadline stops that
observation only; it never cancels the DAG run.

## Usage

```ts
import type {
  IClockPort,
  ILeasePort,
  IQueuePort,
  IStoragePort,
  ITaskExecutorPort,
} from '@robota-sdk/dag-core';
import { RunQueryService } from '@robota-sdk/dag-runtime';
import { createWorkerLoopService, RunAdvancementCoordinator } from '@robota-sdk/dag-worker';

declare const storage: IStoragePort;
declare const queue: IQueuePort;
declare const lease: ILeasePort;
declare const clock: IClockPort;
declare const executor: ITaskExecutorPort; // runs one task, e.g. dag-core's LifecycleTaskExecutorPort
declare const dagRunId: string;

const worker = createWorkerLoopService(
  { executionRoot: '/path/to/project', storage, queue, lease, executor, clock },
  {
    workerId: 'worker-1',
    leaseDurationMs: 30_000,
    visibilityTimeoutMs: 30_000,
    maxAttempts: 1,
    defaultTimeoutMs: 30_000,
    idleWaitMs: 500, // long-poll the queue instead of sleeping between polls
  },
);

// The coordinator is the only caller of worker.processOnce() for this queue.
const advancement = new RunAdvancementCoordinator(worker, new RunQueryService(storage));
await advancement.start();

const terminal = await advancement.waitForTerminal(dagRunId, {
  deadlineEpochMs: Date.now() + 60_000, // stops observing; does not cancel the run
});
if (terminal.ok) console.log(terminal.value.dagRun.status);

await advancement.stop();
```

`createDagFramework()` in [`@robota-sdk/dag-framework`](../dag-framework/README.md) performs this
wiring for you, including the executor.

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — the contract: dispatch, leases and retries, cancellation, crash
  recovery, lineage, budgets and the advancement actor.
