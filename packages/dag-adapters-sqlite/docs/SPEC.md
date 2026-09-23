# @robota-sdk/dag-adapters-sqlite SPEC

## Purpose

SQLite-backed implementations of `IStoragePort` and `IQueuePort` from `@robota-sdk/dag-core`. A
zero-infrastructure production backend — a single file, no server required — with an intended
upgrade path to PostgreSQL by swapping the adapter.

## Non-goals

- Single-process only. SQLite's WAL mode supports one writer at a time; multi-process deployments
  need a different adapter (e.g. a future Postgres-backed one).
- Does not own domain contracts or validation logic — it persists and reads back what `dag-core`
  defines and validates.

## Invariants

- `SqliteStorageAdapter` enforces referential integrity (foreign keys) between its tables;
  `SqliteQueueAdapter` owns a separate table and does not share that constraint.
- Storage migrations run automatically on construction and are numbered and idempotent. The queue
  table is not part of storage's migration set — it is created independently by the queue adapter's
  own constructor, so storage and queue can be provisioned independently.
- Long-poll waiting on dequeue is implemented as synchronous poll-with-sleep rather than a blocking
  wait, which bounds wake-up latency to the poll interval rather than being immediate.

## Design decisions

- WAL journal mode is used by both adapters for concurrent read performance, since the queue is
  read far more often than it is written.
