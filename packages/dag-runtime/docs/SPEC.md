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
- When supplied with a live root snapshot authority, run creation admits its published definition
  and run input together against the shared input allowance before persisting the run or dispatching
  entry tasks; a rejected admission creates no run, and an uncertain storage write closes future
  root admissions rather than refund capacity. Definition and input share the existing input pool
  with task inputs, so nested runs cannot reset a separate run allowance.
- Cancellation commits against current run state, so whichever of a terminal result or a
  cancellation wins first is not overwritten by the other, and entry tasks are admitted only while
  the run remains running; this acknowledges stored cancellation, not completion of active executor
  cleanup or descendant cancellation. An optional same-process listener is notified only after
  cancellation wins persistence arbitration, and notification failure cannot reverse committed
  state — workers in other processes still rely on persisted admission checks.
- All entry tasks are admitted before the first entry message is published, so a fast consumer
  cannot complete the run while sibling entries have not yet become visible. If an entry enqueue
  fails, the run is failed unless cancellation already won, and every preadmitted nonterminal entry
  task is cancelled, including ones not yet delivered; already committed terminal task outcomes are
  preserved.
