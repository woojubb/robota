# DAG Worker Specification

## Purpose

Owns the dequeue-process step and the queue-scoped actor that advances task execution within DAG
runs: lease acquisition, timeout enforcement, retry logic, dead letter queue (DLQ) handling,
downstream task dispatch, and DAG run finalization.

## Contract

### Dispatch, leases and retries

Creating a downstream task run and enqueuing its message are atomic in outcome: if enqueue fails
after the record was created, the record is cancelled rather than left `queued`, because a `queued`
task with no queue message is an invariant violation and the state machine has no `queued -> failed`
edge.

Failing to acquire a lease is normal contention, not an error: the worker returns a non-error "not
processed" result and leaves the message to the lease holder. DLQ reinject is protected twice — the
DLQ's visibility timeout gives a message to one worker, and a lease on the task run makes a losing
worker nack and report `reinjected: false` without error; the lease is always released.

A run succeeds once every task is terminal and none is `failed`; `upstream_failed`, `skipped` and
`cancelled` are expected propagation, not worker error. Eligible failure settlement atomically
reserves the next queued attempt before publishing the failure event, so a concurrent finalizer
sees pending work. For runs with a definition snapshot, ready nodes not yet admitted also keep the
run running, so a sibling finishing while another dispatcher awaits admission cannot close it.

### Cancellation and result precedence

After dequeuing a task and acquiring its lease, the worker checks the parent run's status before
claiming the task and again immediately before invoking the executor. A cancelled run cancels the
task, clears its lease and acknowledges the message without invoking the executor (a claim that
raced may already have published `task.started`). These checks close admission only at the checked
points; they do not make the read and the invocation atomic. The worker registers a local attempt
signal before its final read, so a committed cancellation still aborts an attempt a stale read let
through, and while active it observes durable run state at a bounded interval, so cancellation
committed by another owner aborts the attempt once storage reflects it. An unreadable or missing run
closes the attempt rather than authorizing it. The file adapter is single-owner and gives no such
cross-process visibility.

An executor result settles only while its run is running and its task still belongs to that exact
attempt and worker. A prior cancellation cancels the task instead, with no output or credit
persistence, completion or failure publication, retry, or downstream admission, and a stale attempt
can never settle or cancel its replacement. Whichever of settlement or cancellation commits first
wins; finalization and cancellation arbitrate atomically, so an awaited read cannot resurrect a
cancelled run. A cancellation that commits first rejects both a failure outcome and its retry
reservation; if the reservation commits first, the worker settles its delivered message without
invoking the executor. A pre-aborted input never enters the executor.

Each attempt receives a trusted in-process abort signal. A timeout settles the attempt as a timeout
and aborts the signal before the caller resumes, so a late executor result cannot replace that
outcome; an upstream attempt signal or same-process run cancellation aborts it as a non-retryable
cancellation. This is cooperative interruption, not CPU preemption: an executor that ignores its
signal can continue side effects after timeout, including while a retry runs, and synchronous work
can block the timer. Durable observation reaches other SQLite-backed workers but does not join
arbitrary executor cleanup, cancel nested executions, or provide root-owned descendant cancellation.

An executor may offer a trusted isolation stop/join capability: the worker claims the settlement
winner before running abort listeners, then stops and joins that isolation before the caller
resumes, so a reentrant or late success cannot replace the winner. A shutdown failure preserves the
winning error, disables retry, and is never reported as successful termination.

### Crash recovery

A task whose worker died is recovered through `dag-core`'s `RECLAIM` edge, on two paths:

- **On redelivery**: a message for a `running` task is reclaimed only after lease acquisition
  succeeded, so a live owner's duplicate delivery is nacked before it gets there.
- **On idle** (for queues that do not redeliver): the idle branch sweeps stale task runs, at most
  once per lease duration. It is crash-durable only where the store is; with in-memory storage it
  recovers only within one process lifetime.

A task is stale when its recorded lease has expired, or when it is `running` with no lease at all —
a task orphaned before its lease was written has the least evidence of ownership. A swept task
returns to `queued` with its attempt count incremented and is bounded by the same max-attempts
policy; a task of an already cancelled run is cancelled instead, and one with no attempts left is
marked abandoned. The sweep reports what it did per task, so finding work and moving nothing is
observable.

### Composite child lineage

Before entering the executor, the worker decodes the run's persisted composite lineage rather than
trusting an in-process default, so a restarted or separate-process worker enforces depth and
recursion limits on runs it did not create, and refuses — and cancels through the same committed
transition — a child run whose persisted root or immediate parent is committed cancelled. Invalid
persisted ancestry fails that one task closed without stopping the worker loop; an ancestor
reference with no persisted run is not a cancellation signal, since lineage may carry a depth cap
without a persisted ancestor.

### Budgets

The worker snapshots the host's execution byte limits at construction and passes them into every
task's lifecycle context; queue and definition data cannot raise them. When a shared root snapshot
authority is supplied, input persistence is admitted before executor entry and output persistence
before success publication or downstream dispatch, using current run, attempt and lease ownership in
the storage commit. Snapshots are encoded from plain JSON data only; data-defined `toJSON` methods
and accessors are never invoked. Exhaustion is a non-retryable task failure; a rejected stale or
cancelled write consumes nothing, accepted input stays charged even if execution fails, and a
persistence exception keeps its reservation and closes the root authority rather than risk
under-counting. For a cost-limited run, the worker reserves its estimate against sibling charges and
holds before execution — a custom executor must estimate first or fail without executing — and
successful settlement converts the hold to a charge while failure, cancellation and reclaim release
it. Workers without an injected authority provide no such accounting.

### Advancement actor

Exactly one advancement actor exists per worker/queue composition, and only it invokes the single
processing step, so at most one step is in flight however many callers request advancement or
observe a run's terminal state. Aborting or timing out an observer removes only that observer and
never cancels the run. A step failure is queue-wide, so the actor logs, backs off and retries while
demand exists; a query failure settles only the waiters for that run. The lifecycle is terminal:
start and stop are idempotent, start after stop is rejected, and stop closes admission, wakes any
backoff, settles pending observers and waits only for the in-flight query or step — it neither waits
for runs to finish nor persists a cancelled state. An optional idle-wait duration is passed to the
queue's dequeue so long-polling adapters wake the worker as soon as a task is enqueued.

The execution root is required execution authority, validated and canonicalized at construction and
copied into every task execution input; it is never read from `process.cwd()` or taken from a queue
message or definition.

## Non-goals

- Does not redefine `dag-core` contracts, state machines, ports or error builders; execution,
  leasing, queueing and progress reporting are supplied through those ports.
- Does not define DAG definitions, API contracts, or scheduling logic.
- Does not own run creation or start — that belongs to `dag-runtime`.
- Does not own projection or observability concerns.
- Does not clean up executors, cancel nested executions, or bound generation-time root budgets.

## Design decisions

- **Lease and `leaseUntil` share one bound** derived from the task's execution timeout, not the
  lease-duration option alone; otherwise the lock could expire mid-execution and another worker
  could reclaim a task that is still running.
- **Sweep write order is fixed** because the writes are not transactional and the sweeper can die
  too: the attempt advances before the enqueue (message ids derive from the attempt, so a crash
  burns an attempt instead of colliding), the message exists before the status becomes `queued` (so
  a task is never `queued` with nothing in the queue), and the lease is written before the status
  (so a concurrent sweeper never sees `running` with no lease on a task still starting).
- **The sweeper takes the same lease a worker would**, so two idle workers cannot sweep one task
  concurrently and double its attempts or enqueue duplicate message ids.
