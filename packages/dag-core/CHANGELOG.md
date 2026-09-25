# @robota-sdk/dag-core

## 3.0.0-beta.61

### Major Changes

- fec722f: Carry a trusted canonical absolute execution root from DAG product composition through worker task
  input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
  of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

  BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
  `LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
  boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
  current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
  no longer advertises a browser export condition.

- caabd3c: **BREAKING (dag-core) — DAG-001: `running` was a terminal trap; the DAG subsystem now has a crash-recovery path.**

  A worker that died mid-node left its task and its run in `running` forever, silently. On the one queue
  adapter that redelivers, recovery was _guaranteed to fail_: the redelivered task hit `running:START`,
  which the transition table did not contain, so it errored and the message was acked and dropped — the
  only path that could have recovered destroyed the last record that the work was pending.

  `dag-core` owned the three things a recovery path needs and none of them could express recovery. All
  three change:

  - **`TaskRunStateMachine`** gains a `RECLAIM` event and the `running --RECLAIM--> queued` transition.
  - **`IStoragePort`** gains `setTaskRunLease(taskRunId, leaseOwner?, leaseUntil?)` and
    `listStaleRunningTaskRuns(asOfIso)`. **Any custom `IStoragePort` implementation must add both.**
  - **`ILeasePort.renew` is REMOVED.** It had zero production callers. A heartbeat is the design that
    would need it, and this is not that design: a task's lease expiry is derived from the time the task
    is allowed to run, which is known up front. **Any custom `ILeasePort` implementation may drop it.**

  `ITaskRun.leaseOwner` / `leaseUntil` are now actually written. They existed on the domain type and in
  the sqlite INSERT with nothing ever setting them.

  `@robota-sdk/dag-worker` gains `sweepStaleTaskRuns`, called from `WorkerLoopService.processOnce` when
  the queue is idle, so recovery also reaches adapters that never redeliver.

- 6238e38: Cost-limited DAG runs now reserve credits for each leased task attempt before execution. Successful output settlement converts the hold to a charge; failure, cancellation, and reclaim release it. Stored cumulative totals from successful legacy tasks remain the accounting floor when individual estimates are absent.

  Custom executors used with `createDagFramework` or `WorkerLoopService` must implement `estimateCost(input)` for cost-limited runs. It must return a finite, nonnegative estimate before `execute` starts; a missing or invalid estimate fails the task. Direct `commitExecution` callers must reserve credits before settling a successful task in a cost-limited run.

  Direct `createExecutionComposition` callers that wrap a `LifecycleTaskExecutorPort` must pass `lifecycleCreditAdmission: true` in the composition dependencies so the worker recognizes that the wrapped lifecycle reserves credits before execution.

### Minor Changes

- 5a46402: Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.

### Patch Changes

- eb71c83: Persist composite child run lineage (`IDagRun.lineage`) across restarts, so a restarted
  worker enforces composite depth/ancestry from the persisted run rather than an in-process default.

  - `dag-adapters-sqlite` adds migration v3 (`dag_runs.lineage_json`) and reads it back unvalidated —
    a corrupted or hand-edited value is handed through to the caller's decode step rather than
    thrown out of a plain `getDagRun`/`listDagRuns` read.
  - `dag-worker` decodes the persisted lineage before entering the executor and fails the task
    deterministically with `DAG_VALIDATION_RUN_LINEAGE_INVALID` on an undecodable value, leaving the
    worker loop free to keep processing other messages instead of crashing over one corrupted run.
  - `dag-runtime`'s run-key idempotency now also compares lineage: a duplicate run key whose
    requested composite lineage differs from the existing run's persisted lineage is rejected with
    `DAG_VALIDATION_RUN_KEY_LINEAGE_MISMATCH` instead of silently handing back the existing run.
  - A root lineage that only carries a depth cap remains valid for starting a fresh root run.

- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- 74bf844: Bound HTTP response body reads before materializing text and keep request timeouts active through body consumption.

## 3.0.0-beta.60

## 3.0.0-beta.59

## 3.0.0-beta.58

## 3.0.0-beta.57

## 3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

## 3.0.0-beta.54

## 3.0.0-beta.53

## 3.0.0-beta.52

## 3.0.0-beta.51

## 3.0.0-beta.50

## 3.0.0-beta.49

## 3.0.0-beta.48

## 3.0.0-beta.47

## 3.0.0-beta.46

## 3.0.0-beta.45

## 3.0.0-beta.44
