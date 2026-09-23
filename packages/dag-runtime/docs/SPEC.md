# DAG Runtime Specification

## Purpose

`dag-runtime` owns the runtime orchestration layer for DAG execution: creating DAG runs from
published definitions with idempotent run-key semantics, resolving time semantics per trigger
type, transitioning DAG run and task run states, identifying and enqueuing entry nodes, querying
run status, cancelling runs, and publishing execution progress events.

## Boundaries

- Depends only on `@robota-sdk/dag-core` for domain types, state machines, port interfaces, error
  builders, and time semantics. All imports flow toward `dag-core`; this package imports from no
  sibling DAG package.
- Does not own worker execution loops (`dag-worker`), scheduler triggers (`dag-scheduler`),
  storage/queue implementations (consumed only through port interfaces), API transport (`dag-api`),
  DAG definition authoring/validation (`dag-core`), or projection/read-model concerns
  (`dag-projection`).
- Ships no storage, queue, or clock implementation of its own — every port is injected.
- Does not define or override state-transition rules; all transitions delegate to `dag-core`'s
  state machines, and state-transition failures are returned as-is, not wrapped or remapped.

## Contract

- **Entry-task enqueue failure recovery**: if one enqueue in a batch fails, already-enqueued tasks
  are not rolled back from the queue, but every task run created so far (including the
  successfully-enqueued ones) is transitioned to `cancelled`, and the DAG run is transitioned to
  `failed`. A worker that later dequeues an already-enqueued message finds it cancelled and skips
  execution via state-machine rejection. Entry nodes not yet reached in the dispatch loop never
  get a task run record, so storage may not hold a complete audit trail of every intended entry
  task — only those created before the failure.
- **`startCreatedRun` is idempotent**: called on a run already past `created` (queued, running, or
  terminal), it returns the existing task run IDs without re-enqueuing or re-transitioning,
  preventing duplicate task creation on retry.
- **Run key idempotency**: run keys follow `{dagId}:{logicalDate}` or
  `{dagId}:{logicalDate}:rerun:{rerunKey}`; a storage-level race on concurrent creation is handled
  by re-querying the existing run rather than failing.
- All service methods return `TResult<T, IDagError>` — no fallback paths, no silent error
  swallowing.

Cancellation commits against current run state. A terminal result that wins first remains terminal;
a cancellation that wins first cannot be overwritten by a stale start or dispatch-failure result.
Entry tasks are admitted only while the run remains running. This acknowledges stored cancellation,
not completion of active executor cleanup or descendant cancellation.

All entry tasks are admitted before the first entry message is published. This prevents a fast
consumer from completing the run while sibling entries have not yet become visible. If an entry
enqueue fails, the run is failed unless cancellation already won, and all preadmitted nonterminal
entry tasks are cancelled, including those not yet delivered. Already committed terminal task
outcomes are preserved.
