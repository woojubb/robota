# @robota-sdk/dag-adapters-sqlite SPEC

## Purpose

SQLite-backed implementations of `IStoragePort` and `IQueuePort` from `@robota-sdk/dag-core`.
Provides a zero-infrastructure production backend — a single file, no server required.
Upgrade path to PostgreSQL by swapping the adapter via environment variable.

## Exports

| Symbol                 | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `SqliteStorageAdapter` | Implements `IStoragePort` — persists DAG definitions, runs, task runs |
| `SqliteQueueAdapter`   | Implements `IQueuePort` — task queue with visibility timeouts         |

## Usage

```typescript
import { SqliteStorageAdapter, SqliteQueueAdapter } from '@robota-sdk/dag-adapters-sqlite';

// Default path: ./robota-dag.db
const storage = new SqliteStorageAdapter();
const queue = new SqliteQueueAdapter();

// Custom path
const storage = new SqliteStorageAdapter('/var/data/robota.db');

// In-memory (for tests)
const storage = new SqliteStorageAdapter(':memory:');

// Always close when done
storage.close();
queue.close();
```

## Environment Variable Integration

```typescript
const storage =
  process.env['DAG_STORAGE'] === 'sqlite'
    ? new SqliteStorageAdapter(process.env['DAG_SQLITE_PATH'] ?? './robota-dag.db')
    : new InMemoryStoragePort();
```

## Schema

### `dag_definitions`

| Column          | Type    | Description                          |
| --------------- | ------- | ------------------------------------ |
| dag_id          | TEXT    | DAG identifier (PK part)             |
| version         | INTEGER | Version number (PK part)             |
| status          | TEXT    | `draft` \| `published` \| `archived` |
| definition_json | TEXT    | Full `IDagDefinition` as JSON        |
| created_at      | INTEGER | Unix epoch ms                        |
| updated_at      | INTEGER | Unix epoch ms                        |

### `dag_runs`

| Column              | Type    | Description                        |
| ------------------- | ------- | ---------------------------------- |
| dag_run_id          | TEXT    | Run identifier (PK)                |
| dag_id              | TEXT    | Parent DAG ID                      |
| version             | INTEGER | DAG version at time of run         |
| status              | TEXT    | `TDagRunStatus`                    |
| run_key             | TEXT    | Idempotency key (indexed)          |
| logical_date        | TEXT    | ISO 8601 scheduled date            |
| trigger             | TEXT    | `manual` \| `scheduled` \| …       |
| definition_snapshot | TEXT    | Serialized definition at run start |
| input_snapshot      | TEXT    | Serialized input payload           |
| started_at          | TEXT    | ISO 8601                           |
| ended_at            | TEXT    | ISO 8601                           |

### `task_runs`

| Column                            | Type    | Description              |
| --------------------------------- | ------- | ------------------------ |
| task_run_id                       | TEXT    | Task run identifier (PK) |
| dag_run_id                        | TEXT    | Parent run ID (FK)       |
| node_id                           | TEXT    | Node identifier          |
| status                            | TEXT    | `TTaskRunStatus`         |
| attempt                           | INTEGER | Retry count              |
| lease_owner / lease_until         | TEXT    | Distributed lease fields |
| input_snapshot / output_snapshot  | TEXT    | Serialized port payloads |
| estimated_credits / total_credits | REAL    | Cost tracking            |
| error_code / error_message        | TEXT    | Structured error details |

### `task_queue`

Owned by `SqliteQueueAdapter`. Its `CREATE TABLE` DDL lives in the queue adapter constructor, not in `runMigrations()`.

| Column                             | Type    | Description                             |
| ---------------------------------- | ------- | --------------------------------------- |
| message_id                         | TEXT    | Message identifier (PK)                 |
| dag_run_id / task_run_id / node_id | TEXT    | Routing identifiers                     |
| visible_after                      | INTEGER | Epoch ms before which message is hidden |
| in_flight                          | INTEGER | `0` = available, `1` = being processed  |
| worker_id                          | TEXT    | Worker currently holding the message    |

## SQLite Configuration

- `PRAGMA journal_mode = WAL` — better concurrent read performance (set by both `SqliteStorageAdapter` and `SqliteQueueAdapter`).
- `PRAGMA foreign_keys = ON` — enforces referential integrity (set by `SqliteStorageAdapter` only; `SqliteQueueAdapter` sets only `journal_mode = WAL`).

## Migrations

`runMigrations()` runs automatically on `SqliteStorageAdapter` construction and creates the three
storage tables (`dag_definitions`, `dag_runs`, `task_runs`) plus the `schema_migrations` tracking
table. The `task_queue` table is not migrated here — `SqliteQueueAdapter` creates it in its own
constructor. Each migration is numbered and idempotent. Current schema version: **1**.

## Dependencies

| Package                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `better-sqlite3`       | Synchronous SQLite driver with TypeScript types |
| `@robota-sdk/dag-core` | Port interfaces and domain types                |

## Constraints

- `SqliteQueueAdapter` uses synchronous poll-with-sleep for `waitTimeoutMs`; poll interval is 50ms.
- Single-process only — SQLite WAL mode supports one writer at a time.
- For multi-process deployments, use the future `dag-adapters-pg` package.
