# DAG Core Specification

## Purpose

`@robota-sdk/dag-core` is the single source of truth (SSOT) for all DAG domain contracts, state
rules, and validation logic in the Robota monorepo. It owns the canonical type definitions for DAG
definitions, runs, tasks, ports, nodes, edges, errors, and state machines. Every other `dag-*`
package depends on `dag-core` and must import its contracts from this package rather than
re-declaring them. It defines what the DAG domain looks like, not how it executes at scale.

## Non-goals

- **No infrastructure adapters.** Storage, queue, lease, and run-draft implementations belong to
  consumer packages; `dag-core` defines only the port interfaces.
- **No orchestration runtime.** DAG scheduling, worker polling, and run coordination belong to
  runtime and orchestration packages.
- **No node implementations or node authoring infrastructure.** Base classes, accessors,
  registries, and value objects belong to a dedicated node authoring package (`dag-node`).
  `dag-core` defines the interfaces they implement but does not own the implementations.
- **No projection/read-model, API, or designer-UI logic.** Those belong to their own packages.
- Contract behavior must be deterministic and fail-fast — no fallback logic.

## Design decisions

- **Result pattern (`TResult<T, E>`)**: all domain operations return discriminated unions instead
  of throwing, so error handling is explicit at every call site.
- **Port/adapter (hexagonal)**: infrastructure concerns are port interfaces owned here; consumer
  packages provide adapters. In-memory adapters for test harnesses live in
  `@robota-sdk/dag-adapters-local`, not here.
- **Finite state machines**: run and task state transitions are encoded as lookup tables. Invalid
  transitions return errors rather than silently succeeding, and terminal states have no outgoing
  transitions except explicit policy gates (e.g. task `RETRY`).
- **SSOT ownership**: every domain type is defined exactly once in this package; other packages
  import rather than re-declare.

## DAG definition port catalog policy

The catalog-aware definition validation capability reports unknown node types and edges whose
endpoints are absent from the definition as domain findings. It does not mutate the definition or
assign an HTTP status. This lightweight check does not replace the full structural validator below.

Persisted DAG JSON stores graph instances, not runtime node schemas. A node's `inputs`/`outputs`
are optional compatibility/catalog fields; new persisted definitions should omit them. Port
definitions are owned by the runtime node catalog and may change independently of saved DAG
definitions, so validation checks node IDs, edge endpoints, binding presence, duplicate binding
identities, cycles, and cost policy without requiring node-local ports. Type compatibility is
checked only when both matching ports are available on a node. Callers that need strict port
validation must enrich definitions with the current runtime catalog before validating, and must not
persist that enriched form unless they intentionally own a compatibility migration.

## Run draft and partial execution contracts

Run execution state is kept separate from DAG definition JSON: a run draft holds the definition,
input, node state map, and optional run result so clients can restore execution state without
writing transient state into the DAG definition itself. A missing draft is reported with a
dedicated not-found error rather than treated as empty. Decoding of untrusted draft
request/response shapes is centralized in this package so every adapter maps the same validated
result to its own presentation format instead of re-validating independently.

Resetting a node's state also resets all downstream dependents, because their traces are no longer
valid once an upstream result changes. Overwriting a node's result is a distinct operation that
upserts a manual result while leaving the DAG definition unchanged.

## Extension points

- **`IDagNodeDefinition` / `INodeLifecycle`**: `dag-core` defines these interfaces; the abstract
  base class and supporting infrastructure that implement them are owned by `dag-node`.
- **Port interfaces** (`IStoragePort`, `IQueuePort`, `ILeasePort`, `IClockPort`,
  `ITaskExecutorPort`, `IRunDraftStore`): consumer packages implement these to provide
  infrastructure. `IQueuePort.dequeue` may wait up to an optional timeout before returning nothing;
  adapters that cannot support long-polling may ignore the timeout and return immediately.
- **`INodeTaskHandler`**: a lighter alternative to full `INodeLifecycle` where only `execute` is
  required; a wrapper fills in defaults and base port validation for the rest.

## Trusted execution root (ARCH-010)

The execution root carried through task-execution input and node-execution context is a required,
trusted, canonical absolute directory. Neither contract may derive a root from `process.cwd()`, a
DAG definition, a queue payload, or node configuration — the workspace layout's `root` is
project-relative workflow-definition metadata only and is never execution authority.

## Error taxonomy

All errors conform to a canonical shape: `code`, `category`, `message`, `retryable`, optional
`context`. Categories and their retryable defaults:

| Category           | Meaning                                     | Default retryable |
| ------------------ | ------------------------------------------- | ----------------- |
| `validation`       | Schema, structure, or constraint violations | `false`           |
| `state_transition` | Invalid state machine transition            | `false`           |
| `lease`            | Lease acquisition failure                   | `false`           |
| `dispatch`         | Task dispatch/queue failure                 | `true`            |
| `task_execution`   | Error during node execution                 | varies            |

## State lifecycle

### DAG run and task run state machines

Both DagRun and TaskRun status transitions are pure lookup tables; each transition emits a domain
event with a fixed prefix (`run.*`, `task.*`).

The task `failed` state is **not** terminal: it has exactly one outgoing edge, `RETRY -> queued`,
so a failed task can be retried via the DLQ reinject mechanism. Consumer packages doing run
finalization must treat `failed` as terminal only once no retries remain.

### Finalization semantics

- `failed` is the only task status that contributes to a `failed` DAG run outcome.
- `upstream_failed`, `skipped`, and `cancelled` are non-failure terminal states.
- A run is `success` when all tasks are terminal and none is `failed`.

### Crash recovery: `RECLAIM` (DAG-001)

Before this, `running` was a terminal trap: a worker dying mid-node left its task and run in
`running` forever, and on the one queue adapter that redelivers, recovery was guaranteed to fail —
the redelivered task hit `running:START`, which the transition table did not contain, so the
message was acked and dropped, destroying the last record that work was pending.

`RECLAIM` (`running -> queued`) is the fix. It is a pure function of status only; the state machine
cannot verify the previous owner is actually gone, so that condition is the caller's
responsibility (established via lease ownership or an expired `leaseUntil`). The two supporting
contracts this required — lease read/write on task runs, and `leaseOwner`/`leaseUntil` fields on
the task run type — are owned here.

### Node orchestration state (`IDagNodeState`)

A read-model projection for orchestration surfaces to show or gate node-local state around a run;
it is not persisted in DAG definitions. It separates node side-effect status (e.g. an in-progress
upload) from execution status, so a run cannot start while a side effect is pending or a node is
already executing. The reducers are pure and must not depend on React, HTTP, storage, timers, or
backend adapters.

## Event architecture

`dag-core` defines event name prefixes (`run`, `task`, `worker`, `scheduler`, `execution`) but does
not own an event bus or emitter — publishing is a consumer concern.

## Execution mutation arbitration

Execution state changes arbitrate against current persisted run/task state in one adapter-owned
commit. Cancellation and terminal finalization have a single winner; a terminal run cannot be
resurrected by a delayed execution result. Task settlement checks both the attempt and lease owner,
so a replaced worker cannot overwrite its successor. An accepted success includes its output
snapshot and credit fields in the same mutation. A rejected result emits no task outcome or retry.

Failure settlement and retry reservation share one commit point: an eligible retry is already
queued with its next attempt when the failure event is published, so finalization cannot overtake
it. Downstream admission has its own commit point. Cancellation committed before admission
prevents the new attempt or child record. Admission committed first may still deliver a
queue message afterwards: queue delivery is not a storage transaction, and worker admission must
reject that message if the run has since been cancelled. Run finalization evaluates pending tasks
and commits its terminal status together. Raw persistence setters do not provide these execution
preconditions; execution owners must use the arbitration contract.

For runs with a definition snapshot, finalization also checks the immutable DAG topology: a missing
node whose dependencies have all succeeded is pending admission, not evidence of completion. This
prevents parallel task completion from closing the run while another dispatcher is still admitting
a ready child. Missing descendants of failed or skipped dependencies do not block termination.
Malformed snapshots return a validation error without finalizing. Legacy/programmatic run records
without a definition snapshot retain their task-only finalization behavior.
