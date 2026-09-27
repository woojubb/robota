# DAG Adapters SQLite

SQLite-backed `IStoragePort` and `IQueuePort` for the DAG engine: a persistent backend in a single
host-selected database file, with no database server to run.

Internal package: `@robota-sdk/dag-adapters-sqlite` is private to this monorepo (`"private": true`) and
not published to npm. It is part of the DAG workflow subsystem; see
[the DAG packages](../../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../../dag-core/docs/README.md) and `better-sqlite3`.
- Used by: nothing composes it by default — `createDagFramework()` uses
  [`dag-adapters-local`](../../dag-adapters-local/docs/README.md). A host can pass these adapters
  wherever an `IStoragePort` or `IQueuePort` is expected, such as the `ports` option of
  `createDagFramework()`. `dag-worker`'s tests run against them.

## Main exports

- `SqliteStorageAdapter` — `IStoragePort` over SQLite. The constructor requires a database path,
  enables WAL mode and foreign keys, and runs the numbered, idempotent schema migrations.
- `SqliteQueueAdapter` — `IQueuePort` over its own `task_queue` table, with visibility timeouts.

Both adapters take the database path as their only constructor argument and expose `close()`.

Things to know before choosing it:

- Single process only: SQLite in WAL mode allows one writer at a time.
- Execution commits (run and task state, credits, snapshots) run in one immediate SQLite
  transaction; queue delivery is outside that transaction.
- Long-poll dequeue is poll-with-sleep, so wake-up latency is bounded by the poll interval rather
  than immediate.

## Usage

```ts
import { SqliteQueueAdapter, SqliteStorageAdapter } from '@robota-sdk/dag-adapters-sqlite';

// The host chooses the database file; both adapters may share it.
const storage = new SqliteStorageAdapter('/var/lib/my-app/dag.sqlite');
const queue = new SqliteQueueAdapter('/var/lib/my-app/dag.sqlite');
try {
  // Pass them wherever an IStoragePort / IQueuePort is expected.
  await storage.listDagRuns();
  await queue.dequeue('worker-1', 30_000);
} finally {
  queue.close();
  storage.close();
}
```

## Documents

- [SPEC.md](SPEC.md) — purpose, non-goals, invariants and design decisions for the SQLite adapters.
