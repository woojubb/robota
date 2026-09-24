# @robota-sdk/dag-adapters-sqlite SPEC

## Purpose

SQLite-backed implementations of `IStoragePort` and `IQueuePort` from `@robota-sdk/dag-core`. A
zero-infrastructure production backend — a host-selected single file, no server required — with an
intended upgrade path to PostgreSQL by swapping the adapter.

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
- Execution arbitration reads the current run and tasks and applies its decision, including task
  outcome status, output snapshot and credits, per-attempt credit reservations, and stale-attempt/lease/cancellation predicates,
  under one immediate SQLite transaction; queue delivery is outside this storage transaction. Task
  input snapshots use that same guarded transaction, rejecting stale-attempt or cancelled-run
  writes, but the adapter does not own or reconstruct the caller's in-process aggregate snapshot
  authority.
- A run's persisted `lineage_json` is read back unvalidated — unlike a DAG definition row, which is
  decoded totally and treated as corruption on failure, a malformed lineage value is handed through
  to the caller exactly as stored. Validation belongs to `dag-core`'s lineage decode contract at the
  worker/orchestrator boundary; this adapter must not throw a plain `getDagRun`/`listDagRuns` read
  over it, since that would take down a caller that has no lineage-specific handling on that path.

## Design decisions

- WAL journal mode is used by both adapters for concurrent read performance, since the queue is
  read far more often than it is written.
