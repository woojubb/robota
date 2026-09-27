# DAG Adapters Local

In-memory and file-based implementations of the DAG ports from `@robota-sdk/dag-core` and
`@robota-sdk/dag-cost`, for tests, local development and single-machine deployments.

In-memory adapters keep state only for the life of the process; file-based adapters write to the local
filesystem and survive restarts. Queue and lease semantics are single-process only, and the package
adds no domain logic of its own. Test-support ports (a manual clock, a scripted task executor and a
canned prompt backend) are exported separately from `@robota-sdk/dag-adapters-local/testing`.

```ts
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';

const storage = new InMemoryStoragePort();
const queue = new InMemoryQueuePort();
const lease = new InMemoryLeasePort();
const clock = new SystemClockPort();
```

`InMemoryQueuePort.dequeue(workerId, visibilityTimeoutMs, waitTimeoutMs)` can wait for a later
`enqueue` in the same process, which lets local worker loops avoid fixed sleep polling while idle.

## Documents

- [SPEC.md](SPEC.md) — the contract: file persistence, queue notification, run-draft storage and
  execution-mutation arbitration.
- [Package README](../README.md) — all exports, including the file-backed stores, and a fuller
  usage example.
