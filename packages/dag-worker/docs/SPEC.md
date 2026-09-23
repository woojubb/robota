# DAG Worker Specification

## Purpose

Owns the dequeue-process step and the queue-scoped actor that advances task execution within DAG
runs: lease acquisition, timeout enforcement, retry logic, dead letter queue (DLQ) handling,
downstream task dispatch, and DAG run finalization.

## Non-goals

- Depends on `dag-core` for domain contracts, state machines, port interfaces, and error builders;
  does not redefine them.
- Does not define DAG definitions, API contracts, or scheduling logic.
- Does not own runtime orchestration (run creation, start) — that belongs to `dag-runtime`.
- Does not own projection or observability concerns.

## Behavioral contracts

### Downstream task dispatch atomicity

Creating a downstream task run and enqueuing its message must be atomic in outcome. If enqueue
fails after the task run record was created, the record is transitioned to `cancelled` rather than
left `queued` — a `queued` task run with no corresponding queue message is an invariant violation,
and the state machine has no `queued -> failed` edge, so `CANCEL` is the only correct recovery.

### DLQ reinject concurrency safety

Reinject is protected at two layers: the DLQ's own dequeue visibility timeout ensures only one
worker receives a given message, and a lease acquired on the task run before mutating state means a
losing worker nacks the message and reports `reinjected: false` without error rather than racing.
The lease is always released in a `finally` block.

### DAG run finalization

A run is `success` once all tasks are terminal and none is `failed`. `upstream_failed`, `skipped`,
and `cancelled` do not indicate run-level failure — they represent expected propagation of upstream
failures, conditional skips, or user cancellation, not worker error.

### Lease failure handling

Failing to acquire a lease (another worker already holds it) is normal contention, not an error:
the worker returns a non-error "not processed" result and leaves the message for the lease holder.

### Cancelled-run worker admission

After dequeuing a task and acquiring its lease, the worker checks the parent run's status before
claiming the task, and again after loading execution context and immediately before invoking the
executor. If the run is cancelled, the task transitions to `cancelled`, its lease is cleared, and
the message is acknowledged without publishing `task.started` or invoking the executor. A claim
that raced with cancellation may already have published `task.started`; the task still ends
`cancelled` without invoking the executor. These checks close worker admission at the checked
points only — they do not interrupt an executor already running, and do not make the status read
and executor invocation atomic; that is out of scope here.

### Crash recovery (DAG-001)

A worker that dies mid-node used to leave its task and run in `running` forever, silently. Two
paths recover it, both via `dag-core`'s `running -> RECLAIM -> queued` edge:

- **On redelivery**: reclaiming a task that is already `running` when its message arrives is safe
  only because that code path is reached solely after lease acquisition succeeded — a live owner's
  duplicate delivery is nacked before it gets there.
- **On idle** (for adapters whose queue does not redeliver): the idle branch sweeps stale task
  runs, throttled to at most once per lease duration, since a lease cannot expire faster than that.
  This is crash-durable only where the underlying store is; an in-memory storage adapter still gets
  a recovery path, but with nothing durable under it, so the sweep can only reclaim within a single
  process lifetime.

A task counts as stale when its recorded lease has expired, or when it is `running` with no lease
recorded at all — the latter is included deliberately, since a task orphaned before its lease was
written has the least evidence of ownership and would otherwise be the one left stuck forever.

Lease expiry is derived from the task's own execution timeout bound, not from the lease-duration
policy option — the two are unrelated numbers, and using the shorter lock duration would let the
sweeper reclaim a task that is still legitimately running, causing double execution.

A swept task returns to `queued` with its attempt count incremented and is retried like any other
attempt, bounded by the same max-attempts policy. Two cases are excluded from re-run: a task
belonging to a run that is already cancelled (marked `cancelled` instead, since cancellation only
updates the run record and leaves its tasks `running`), and a task with no attempts left (marked
abandoned). The sweep reports what it actually did per task rather than a bare count, so a sweep
that finds work and moves nothing is observable.

The worker's lease and its persisted `leaseUntil` share one bound (`max(timeoutMs,
leaseDurationMs) + grace`) so the two cannot disagree about when ownership ends; acquiring for the
lease duration alone would let the distributed lock expire mid-execution and let another worker
reclaim a task that is still running.

The sweep's writes are not transactional and the sweeper is exactly as mortal as the worker it
recovers after, so their order matters: attempt increment, then enqueue, then status to `queued`,
then lease cleared. Writing status before a message exists would leave a task `queued` with nothing
in the queue and no longer discoverable as stale. The attempt advances before the enqueue because
the message id derives from the attempt number, so a crash between the two burns an attempt rather
than producing a colliding id. The lease is written before the status for the same reason in
reverse: a sweeper observing `running` with no lease treats that shape as abandoned, so writing
status first would let a concurrent sweeper reclaim a task that was still in the middle of
starting.

The sweeper takes the same lease a worker would, because without it two idle workers could sweep
the same task concurrently — double-incrementing its attempt count toward `maxAttempts` and
producing two enqueue messages with the same id, which a primary-key-constrained queue rejects.

### Idle wait / queue wake-up

An optional idle-wait duration is passed through to the queue's dequeue call so adapters that
support long-polling can wake the worker immediately when a task is enqueued; adapters that do not
support it may ignore the value and return immediately. Worker-level polling loops should prefer
this over an external fixed sleep interval so downstream tasks start promptly.

### Timeout enforcement scope

Task timeout is enforced via an abort signal during execution. If the executor does not respect the
signal, the timeout has no effect — node implementations must cooperate with the abort signal for
timeout to be effective.

### Queue-scoped advancement ownership (RUNTIME-003)

Exactly one advancement actor exists per worker/queue composition, and only that actor invokes the
worker's single processing step — this guarantees at most one step is in flight per composition
even with multiple concurrent callers requesting either background advancement or observation of a
specific run's terminal state. Aborting or timing out an observer removes only that observer; it
never cancels the underlying DAG run, since run/task/node cancellation is a separate contract.
A step failure is treated as queue-wide rather than attributed to one run, so the actor logs, backs
off, and retries while demand exists; a query failure settles only the waiters for the queried run.

The actor's lifecycle is terminal (`created -> running -> stopping -> stopped`): starting or
stopping twice is idempotent, but starting after stop is rejected, and it will not restart. Stop
closes admission synchronously, wakes any idle backoff, settles pending observers, and waits only
for the current in-flight query or step — it does not wait for a run to become terminal, and does
not persist a cancelled run state.

## Extension points

- `ITaskExecutorPort`, `ILeasePort`, `IQueuePort` (from `dag-core`) — consumers implement these to
  define execution, leasing, and queueing mechanics.
- `IRunProgressEventReporter` (from `dag-core`) — optional reporter for task/run progress events.

Execution root is treated as required execution authority, not ordinary worker policy: it is
validated and canonicalized to an absolute real directory at construction and copied into every
task execution input; it is never read from `process.cwd()` or accepted from a queue message or DAG
definition.
