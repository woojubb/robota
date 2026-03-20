# DAG Adapters Local

`@robota-sdk/dag-adapters-local` provides lightweight in-memory and file-based implementations of port interfaces defined by `@robota-sdk/dag-core` and `@robota-sdk/dag-cost`. These adapters are intended for local development, testing, and single-machine deployments where external infrastructure is not needed.

## Usage

```typescript
import {
  InMemoryStoragePort,
  InMemoryQueuePort,
  InMemoryLeasePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';

const storage = new InMemoryStoragePort();
const queue = new InMemoryQueuePort();
const lease = new InMemoryLeasePort();
const clock = new SystemClockPort();
```

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
