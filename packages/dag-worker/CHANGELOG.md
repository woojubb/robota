# @robota-sdk/dag-worker

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

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

- 6238e38: Cost-limited DAG runs now reserve credits for each leased task attempt before execution. Successful output settlement converts the hold to a charge; failure, cancellation, and reclaim release it. Stored cumulative totals from successful legacy tasks remain the accounting floor when individual estimates are absent.

  Custom executors used with `createDagFramework` or `WorkerLoopService` must implement `estimateCost(input)` for cost-limited runs. It must return a finite, nonnegative estimate before `execute` starts; a missing or invalid estimate fails the task. Direct `commitExecution` callers must reserve credits before settling a successful task in a cost-limited run.

  Direct `createExecutionComposition` callers that wrap a `LifecycleTaskExecutorPort` must pass `lifecycleCreditAdmission: true` in the composition dependencies so the worker recognizes that the wrapped lifecycle reserves credits before execution.

### Minor Changes

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

- 34768aa: **BREAKING — RUNTIME-003: make one queue-scoped coordinator the sole owner of DAG run
  advancement.**

  `dag-api` no longer exports the framework assembly result or the raw worker-step port. The
  framework-owned execution composition now exposes `runAdvancement` instead of `workerLoop`, and the
  legacy framework `WorkerLoopDriver` export is removed.

  `dag-worker` adds `RunAdvancementCoordinator`, its observer/lifecycle contracts, and the typed
  `RunAdvancementStoppedError`. Background demand and named-run observers share one actor, observer
  abort/deadline never cancels a run, and shutdown settles observers before draining the single
  in-flight step. Framework prompt jobs and local CLI/SDK execution now use that coordinator without
  floating promises or competing `processOnce()` loops.

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

- f054c43: Worker admission now checks a composite child task's persisted ancestry, not just its own run's
  status: if the run's persisted root or immediate parent run is committed `cancelled`, the task
  never reaches the executor. The worker also commits this run's own cancellation through the same
  state-transition path `RunCancelService` uses, so a queued task under a cancelled root or parent
  ends `cancelled` and its run does too, even across a worker restart or a separate process that
  never observed this run's own cancellation. A persisted root or parent id that resolves to no run
  is left alone rather than treated as a cancellation signal, since lineage is not always backed by a
  persisted ancestor row.
- 5a46402: Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [eb71c83]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [5a46402]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/dag-core@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.44
