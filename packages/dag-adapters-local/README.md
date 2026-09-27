# @robota-sdk/dag-adapters-local

In-memory and file-based implementations of the DAG ports defined by `@robota-sdk/dag-core` and
`@robota-sdk/dag-cost`, for tests, local development and single-machine use where no database,
message broker or lock service is available.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) and
  [`@robota-sdk/dag-cost`](../dag-cost/README.md).
- Used by: [`dag-framework`](../dag-framework/README.md), whose `createDagFramework()` uses these
  adapters by default. Other `dag-*` packages use them in their tests.

## Main exports

- `InMemoryStoragePort`, `InMemoryQueuePort`, `InMemoryLeasePort`, `SystemClockPort` — in-process
  ports; state is lost when the process exits.
- `FileStoragePort` — file-backed `IStoragePort` for definitions, runs and task runs. Call `close()`
  when done; afterwards every operation throws `FileStoragePortClosedError`.
- `FileStoreOwnerConflictError` — a storage root has one live `FileStoragePort` owner at a time;
  operations fail with this error when another live instance owns the root or this instance lost
  ownership. `IFileStoragePortOwnerLockOptions` tunes the ownership lease (mainly for tests).
- `InMemoryRunDraftStore`, `FileRunDraftStore` — run-draft stores (one JSON file per draft for the
  file store).
- `FileCostMetaStorage` — `ICostMetaStoragePort` backed by a `cost-meta.json` file in a
  caller-supplied directory, created owner-only.

`InMemoryQueuePort.dequeue(workerId, visibilityTimeoutMs, waitTimeoutMs)` waits up to
`waitTimeoutMs` for a later `enqueue` in the same process, so a single-process worker loop can
long-poll instead of sleeping between polls.

`FileStoragePort` coalesces overlapping writes to the same file and resolves each persistence call
only after that state, or a newer state that supersedes it, has been atomically written to disk.

Test-support ports live on a separate entry point, `@robota-sdk/dag-adapters-local/testing`:
`ManualClockPort`, `ScriptedTaskExecutorPort` and `createCannedPromptBackend`.

## Usage

```ts
import {
  FileStoragePort,
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';

// In-memory ports: state lives only as long as the process.
const storage = new InMemoryStoragePort();
const queue = new InMemoryQueuePort();
const lease = new InMemoryLeasePort();
const clock = new SystemClockPort();

// dequeue(workerId, visibilityTimeoutMs, waitTimeoutMs): wait up to 500 ms for a message.
const message = await queue.dequeue('worker-1', 30_000, 500);

// File-backed storage: definitions, runs and task runs survive a restart.
const fileStorage = new FileStoragePort('/var/lib/my-app/dag-storage');
try {
  console.log(await fileStorage.listDagRuns());
} finally {
  await fileStorage.close(); // releases the storage root for the next owner
}
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — the contract: persistence, queue notification, run-draft storage
  and execution-mutation semantics.
