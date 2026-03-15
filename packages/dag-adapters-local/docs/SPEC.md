# DAG Adapters Local Specification

## Scope

`@robota-sdk/dag-adapters-local` provides lightweight local implementations of port interfaces defined by `@robota-sdk/dag-core` and `@robota-sdk/dag-cost`. These adapters include both in-memory implementations (for state that does not need persistence) and file-based implementations (for state that should survive process restarts). They are designed for local development, testing, single-machine deployment, and demos where external infrastructure (databases, message queues, distributed locks) is not needed.

## Boundaries

- **In-memory adapters have no persistence.** State is held in memory and lost on process restart.
- **File-based adapters use local filesystem only.** No network or cloud storage.
- **No distributed semantics.** Lease and queue implementations are single-process only.
- **No domain logic.** This package implements port interfaces; it does not define or extend domain contracts.

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@robota-sdk/dag-core` | Port interface definitions (`IStoragePort`, `IQueuePort`, `ILeasePort`, `IClockPort`, `ITaskExecutorPort`) |
| `@robota-sdk/dag-cost` | Cost meta port interface (`ICostMetaStoragePort`, `ICostMeta`) |

## Public API Surface

| Export | Kind | Implements | Description |
|--------|------|------------|-------------|
| `InMemoryStoragePort` | Class | `IStoragePort` | In-memory storage for DAG definitions, runs, and tasks |
| `InMemoryQueuePort` | Class | `IQueuePort` | In-memory message queue (enqueue, dequeue, ack, nack) |
| `InMemoryLeasePort` | Class | `ILeasePort` | In-memory lease management (acquire, renew, release) |
| `SystemClockPort` | Class | `IClockPort` | Real system clock (`Date.now()`) |
| `FakeClockPort` | Class | `IClockPort` | Deterministic clock for tests (manually advance time) |
| `MockTaskExecutorPort` | Class | `ITaskExecutorPort` | Configurable mock for task execution |
| `TTaskExecutorHandler` | Type | -- | Handler function type for `MockTaskExecutorPort` |
| `createStubPromptBackend` | Function | -- | Factory for stub prompt backend used in node testing |
| `FileStoragePort` | Class | `IStoragePort` | File-based JSON storage for DAG definitions, runs, and tasks |
| `FileCostMetaStorage` | Class | `ICostMetaStoragePort` | File-based JSON storage for cost metadata |

## Use Cases

- **Unit / integration tests:** Deterministic, fast, no external setup required.
- **Local development:** Run the full DAG pipeline on a single machine without Docker or external services.
- **Demos and prototyping:** Quick start with zero infrastructure.

## Future Direction

Production-grade adapters for external infrastructure will follow the same port-adapter pattern in separate packages:

- `dag-adapters-mongodb` -- MongoDB persistence adapter
- `dag-adapters-redis` -- Redis queue and lease adapters
- `dag-adapters-postgresql` -- PostgreSQL persistence adapter

Each adapter package will depend on `dag-core` for port interfaces and its respective driver library.
