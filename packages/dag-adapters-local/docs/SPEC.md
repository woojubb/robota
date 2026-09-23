# DAG Adapters Local Specification

## Scope

`@robota-sdk/dag-adapters-local` provides lightweight local implementations of port interfaces defined by `@robota-sdk/dag-core` and `@robota-sdk/dag-cost`. These adapters include both in-memory implementations (for state that does not need persistence) and file-based implementations (for state that should survive process restarts). They are designed for local development, testing, single-machine deployment, and demos where external infrastructure (databases, message queues, distributed locks, object stores) is not needed.

## Boundaries

- **In-memory adapters have no persistence.** State is held in memory and lost on process restart.
- **File-based adapters use local filesystem only.** No network or cloud storage.
- **No distributed semantics.** Lease and queue implementations are single-process only.
- **No domain logic.** This package implements port interfaces; it does not define or extend domain contracts.

`FileCostMetaStorage` writes its cost-metadata file into a caller-supplied, potentially shared data
directory, so the file is created with an owner-only mode rather than inheriting the process umask.

### File collection persistence semantics

`FileStoragePort` serializes writes independently per collection file and may coalesce overlapping
same-file requests to the newest requested state. A persistence promise resolves only after that
request's state, or a later state that supersedes it, has reached the atomically-renamed file. The
per-file writer releases ownership only in the same synchronous handoff that confirms no newer state
is queued; a request after release installs a successor writer and cannot receive the completed
owner's promise. Different file paths do not share writer ownership. If the final write attempt for a
coalescing cohort fails, the cohort promise rejects; an earlier failure superseded by a later
successful latest-state write does not make a current durable state fail.

### `./testing` entry — test-support ports

Test-support ports (a manually-advanced clock, a scripted task executor, a canned prompt backend) are
exported from a dedicated `@robota-sdk/dag-adapters-local/testing` subpath, kept out of the package's
production surface, and named for what they are rather than with `Fake*`/`Mock*`/`Stub*` test-double
names.

## Use Cases

- **Unit / integration tests:** Deterministic, fast, no external setup required.
- **Local development:** Run the full DAG pipeline on a single machine without Docker or external services.
- **Demos and prototyping:** Quick start with zero infrastructure.

## Queue Notification Semantics

The in-memory queue's dequeue operation supports an optional wait timeout:

- If a message is already pending, dequeue returns it immediately.
- If the queue is empty and the wait timeout is positive, dequeue waits until an enqueue or nack makes a message available, then returns it without requiring an external sleep/poll loop.
- If no message arrives before the timeout, dequeue returns `undefined`.
- This notification is single-process only and does not provide distributed queue wake-up semantics.

## Run Draft Storage Semantics

Run draft adapters store execution drafts separately from DAG definitions. A draft may contain
node-state and run-result data that adapters must not write back into a DAG definition.

- The in-memory draft store is test-only/local state and loses drafts on restart.
- The file-based draft store writes one JSON file per draft under its configured root and uses atomic temp-file rename for writes.
- Draft listing order is deterministic by last-updated time descending, then draft ID ascending.

## Execution mutation arbitration

Execution preconditions and their state edits are indivisible within one live adapter instance.
The file adapter hydrates before adjudication and persists the changed collection before resolving;
task success and its snapshot share one collection write. A storage root has one live file-adapter
owner: independent instances do not coordinate their cached state. This is not a cross-process or
multi-file transaction guarantee. Queue delivery remains separate from storage admission.

File execution commits are serialized through persistence completion, so a later finalization cannot
acknowledge success using an earlier outcome whose write is still pending. If an execution commit's
persistence fails, subsequent execution commits on that instance reject with that failure; recovery
must reopen durable state. Cached changes after a failed write are not a basis for continued
execution. This does not make independent collection files a crash-atomic unit, or change raw
persistence setters into execution transactions.
