# DAG Core Specification

## Purpose

`@robota-sdk/dag-core` is the single source of truth (SSOT) for all DAG domain contracts, state
rules, and validation logic in the Robota monorepo. It owns the canonical type definitions for DAG
definitions, runs, tasks, ports, nodes, edges, errors, and state machines. Every other `dag-*`
package depends on `dag-core` and must import its contracts from this package rather than
re-declaring them. It defines what the DAG domain looks like, not how it executes at scale.

## Contract

### Definitions and validation

Definition reads and lifecycle changes (create, update, validate, publish) return domain
definitions, results, or errors — never HTTP envelopes or status codes; that choice belongs to the
API layer. Embedded adapters detach returned and caller-supplied values from live storage
references, so neither a stored definition nor a caller's copy can be mutated through the other.
The registered-node catalog exposes detached domain manifests the same way. A separate
catalog-aware validation reports unknown node types and dangling edge endpoints as domain findings
without mutating the definition; it is a lightweight check, not a replacement for the full
structural validator.

Persisted DAG JSON stores graph instances, not runtime node schemas. A node's `inputs`/`outputs`
are optional compatibility/catalog fields; new persisted definitions should omit them. Port
definitions are owned by the runtime node catalog and may change independently of saved
definitions, so validation checks node IDs, edge endpoints, binding presence, duplicate binding
identities, cycles, and cost policy without requiring node-local ports. Type compatibility is
checked only when both matching ports are available on a node. Callers that need strict port
validation must enrich definitions with the current runtime catalog before validating, and must not
persist that enriched form unless they intentionally own a compatibility migration.

Run execution state is kept separate from DAG definition JSON: a run draft holds the definition,
input, node state map, and optional run result so clients can restore execution state without
writing transient state into the definition. A missing draft is reported with a dedicated not-found
error rather than treated as empty. Decoding of untrusted draft request/response shapes is
centralized here so every adapter maps the same validated result to its own presentation format.
Resetting a node's state also resets all downstream dependents, because their traces are no longer
valid once an upstream result changes; overwriting a node's result upserts a manual result while
leaving the definition unchanged.

### Run and task state

Run and task transitions are pure lookup tables, and each transition emits a domain event
(`run.*`, `task.*`). The task `failed` state is not terminal: its one outgoing edge, `RETRY ->
queued`, lets the dead-letter reinject path retry it, so finalization treats `failed` as terminal
only once no retries remain. `failed` is the only task status that makes a run `failed`;
`upstream_failed`, `skipped` and `cancelled` are non-failure terminal states, and a run succeeds
when every task is terminal and none failed.

`RECLAIM` (`running -> queued`) lets a task whose worker died be recovered; without it a redelivered
message for a `running` task would be dropped and the pending work lost. It is a function of status
only — the state machine cannot verify the previous owner is gone, so the caller establishes that
through lease ownership or an expired lease, using the lease fields owned here.

Execution state changes for runs and tasks arbitrate against current persisted state in a single
atomic commit: cancellation and terminal finalization have one winner, so a terminal run cannot be
resurrected by a delayed result, a stale attempt or replaced worker cannot overwrite its successor,
and a rejected result emits no task outcome or retry. Failure settlement and retry reservation
commit together, and downstream task admission checks current run state, so a cancellation
committed first blocks a new attempt or child record; queue delivery is not part of the storage
transaction, so admission must still reject a message for an already cancelled run. Raw persistence
setters do not provide these preconditions; execution owners must go through the arbitration
contract. For runs with a definition snapshot, finalization treats a missing node whose
dependencies all succeeded as pending admission, not completion, so a run cannot close while a
sibling dispatcher is still admitting a ready child. A malformed snapshot returns a validation error
without finalizing; runs without a snapshot keep task-only finalization.

The node orchestration state is a read-model projection, never persisted in definitions. It keeps
node side-effect status (such as an in-progress upload) apart from execution status, so a run cannot
start while a side effect is pending or a node is already executing. Its reducers are pure and
depend on no UI framework, HTTP, storage, timers, or adapters.

### Cancellation

Task input and node lifecycle context carry an optional trusted in-process abort signal, never
deserialized from queue payloads, definitions or node configuration. A pre-aborted input never
enters the executor, and lifecycle progression stops at cancellation checks before initialization
and after awaited phases. Once execution has begun, cancellation takes precedence over a returned
failure and disposes the node, including partial initialization, returning a non-retryable
cancellation error without publishing a late node output. Cancellation is cooperative — disposal
may take time — and the signal does not establish a root budget owner, propagate to nested runs, or
preempt synchronous code.

### Budgets and bounds

Execution byte limits are immutable host policy, carried separately from definitions, node config,
queue payloads and snapshots, and snapshotted at construction so a later caller cannot change them.
A trusted host may only tighten the built-in per-operation UTF-8 output ceilings, never raise them;
a host policy that omits a newer operation's limit keeps its default, and an invalid limit fails at
composition rather than silently disabling the bound. Exhaustion is a non-retryable byte-limit
error. These are per-operation ceilings — they do not bound other nodes, upstream input, serialized
snapshots, memory, nested runs, or CPU time.

A live root invocation may carry one trusted snapshot authority through every child run, bounding
cumulative input and output bytes across run and task snapshots, and a separate credit reservation
authority that counts pending sibling estimates against the root's cost limit. Neither is
reconstructed from a child definition or a persisted task counter, and snapshot policy is never
deserialized from workflow data. Persisted task totals stay scoped to their own DAG; a stored
cumulative total is the floor for later reservations when an older successful task lacks its own
estimate, and a success with no cost evidence closes credit admission. Every accepted snapshot
write consumes its full size permanently — admission is cumulative, and a committed write is never
refunded even if later work fails. Encoding stops before a complete oversized snapshot is built and
accepts plain JSON data only; it never invokes data-defined `toJSON` methods or accessors, so
workflow data cannot run code during encoding. An ambiguous (thrown) persistence write keeps its
reservation and closes the authority rather than risk under-counting, and a committed cancellation
in a participating run closes future admissions for that root, though already-admitted writes may
finish. Both authorities are in-process only, with no crash recovery or cross-process coordination,
and do not bound memory, CPU, queue size, or provider-generation output.

### Composite child lineage

A composite node's child run persists its ancestry with the run itself. After a restart that record
is the sole authority for depth and recursion decisions, never a constructor-captured default.
Decoding is total: a malformed record is rejected rather than reset to a fresh root, so corruption
or tampering fails the task closed instead of re-authorizing recursion, while an absent value
decodes to a root run. A storage adapter's plain read never throws over a bad record; only this
decode step, run where something is about to act on the ancestry, rejects it.

### Host-supplied capabilities

The execution root carried through task and node execution is a required, trusted, canonical
absolute directory. It is never derived from `process.cwd()`, a definition, a queue payload, or
node configuration; the workspace layout's `root` is project-relative definition metadata, never
execution authority.

A host may supply a trusted regex replacement capability independently of workflow configuration;
only plain text, pattern, flags and replacement cross its boundary, so signals, storage and the
snapshot authority stay in the host. An isolation shutdown capability, if supplied, settles only
after its own execution has exited or rejects shutdown — it is not general node cleanup.

## Non-goals

- **No infrastructure adapters.** Storage, queue, lease, and run-draft implementations belong to
  consumer packages; `dag-core` defines only the port interfaces.
- **No orchestration runtime.** Scheduling, worker polling, and run coordination belong to runtime
  and orchestration packages.
- **No node implementations or authoring infrastructure.** Base classes, accessors, registries, and
  value objects belong to `dag-node`; `dag-core` defines the interfaces they implement.
- **No event bus.** It defines event name prefixes; publishing is a consumer concern.
- **No projection/read-model, API, or designer-UI logic.** Those belong to their own packages.
- Contract behavior must be deterministic and fail-fast — no fallback logic.

## Design decisions

- **Result pattern (`TResult<T, E>`)**: domain operations return discriminated unions instead of
  throwing, so error handling is explicit at every call site. Every error shares one shape — code,
  category, message, retryable, optional context — and each category carries a retryable default
  (only dispatch failures are retryable by default).
- **Port/adapter (hexagonal)**: infrastructure concerns are port interfaces owned here; consumer
  packages provide adapters. In-memory adapters for test harnesses live in
  `@robota-sdk/dag-adapters-local`. A queue port may long-poll up to an optional timeout; adapters
  that cannot may return immediately.
- **Finite state machines**: invalid transitions return errors rather than silently succeeding, and
  terminal states have no outgoing transitions except explicit policy gates such as task `RETRY`.
- **SSOT ownership**: every domain type is defined exactly once in this package; other packages
  import rather than re-declare.
