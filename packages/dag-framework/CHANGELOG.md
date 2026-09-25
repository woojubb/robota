# @robota-sdk/dag-framework

## 1.0.0-beta.4

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

- cd848eb: Require host-selected storage and asset paths (or supplied ports) when composing the in-process DAG framework. The neutral factory no longer selects environment or Robota home-directory storage defaults; existing hosts can preserve their layout by passing the former paths explicitly.

  Require a host-selected database path for both SQLite adapters. Callers that used the implicit `./robota-dag.db` file can pass that path explicitly.

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

### Minor Changes

- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- 9eb7607: Provider DIP Stage C (ARCH-PROVIDER-004): extract the default DAG node catalog into a new
  entry-point-only `@robota-sdk/dag-nodes-default` aggregator. `@robota-sdk/dag-framework` no
  longer carries a hard dependency on any concrete node package — it loads the default catalog
  lazily (typed diagnostic on failure) or via injected `options.nodes` / `nodeRegistry`. The
  `createDefaultNodeRegistry` / `createDefaultNodeRegistrySync` functions moved out of
  `dag-framework` (no longer re-exported); import them from `@robota-sdk/dag-nodes-default`.

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

- 0214ff8: `FileStoragePort` now enforces its single-owner contract: it claims ownership of its storage root before
  any read or write, and a second live instance over the same root fails with a typed
  `FileStoreOwnerConflictError` naming the holder's pid, host and acquisition time, instead of silently
  losing the live owner's writes.

  Ownership is held as numbered epoch files in the storage root. Each epoch is claimed only by exclusive
  creation, so exactly one instance can win it, and an instance owns the root only while its epoch is the
  newest. A new epoch is claimed only over one that its holder released, whose holder on the same host is
  no longer running, or whose heartbeat lease has lapsed — the last covers other hosts and recreated
  containers, which never run exit handlers on SIGTERM/SIGKILL. The owner renews its lease on an interval
  and stops acting before its lease could look lapsed to anyone else; timing options that do not leave that
  margin (a refresh interval above a third of the lease timeout) are rejected at construction.

  Losing ownership — being superseded by a newer epoch or self-expiring — is permanent for that instance:
  every later read and write rejects with `FileStoreOwnerConflictError`, and using the root again means
  opening a new instance.

  `FileStoragePort` gains `close()`, which releases ownership. Closing is final: later operations reject
  with `FileStoragePortClosedError`, while work already queued before `close()` completes first.
  `createDagFramework`'s `stop()` closes the file storage it created itself, never a caller-supplied storage
  port. `IFileStoragePortOwnerLockOptions` is exported alongside `FileStoragePort`.

- 792b726: Stop `text-replace` from ever running a regex on the host's main thread. `createDagFramework`'s default executor now isolates the default regex operation the same way the local Node provider already does, and the node itself no longer falls back to inline `RegExp` execution when no isolated operation is supplied — a pathological pattern can no longer freeze the host process, including its own cancel and status endpoints.
- a58fc4b: Close the shared root credit authority when a participating DAG run's cancellation commits, so nested work cannot reserve new credits while active provider cleanup is still pending.
- a0eac8f: Use a neutral catalog category for custom nodes that omit one instead of projecting a Robota product category.
- 5a46402: Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.
- 78dcc65: Bound memory used by default regex text replacement when a global pattern has many matches, while preserving JavaScript replacement and UTF-8 byte-limit behavior.
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [eb71c83]
- Updated dependencies [0214ff8]
- Updated dependencies [f054c43]
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
- Updated dependencies [82736ee]
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
- Updated dependencies [34768aa]
- Updated dependencies [d6b9404]
- Updated dependencies [5a46402]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-runtime@3.0.0-beta.61
  - @robota-sdk/dag-worker@3.0.0-beta.61
  - @robota-sdk/dag-adapters-local@3.0.0-beta.61
  - @robota-sdk/dag-builder@0.1.0-beta.1
  - @robota-sdk/dag-api@3.0.0-beta.61
  - @robota-sdk/dag-cost@3.0.0-beta.61
  - @robota-sdk/dag-node@3.0.0-beta.61
  - @robota-sdk/dag-orchestration-client@3.0.0-beta.61
  - @robota-sdk/dag-projection@3.0.0-beta.61

## 0.1.0-beta.3

### Patch Changes

- @robota-sdk/dag-node-seedance-video@3.0.0-beta.63
- @robota-sdk/dag-node-text-to-image@3.0.0-beta.63
- @robota-sdk/dag-node-skill@3.0.0-beta.63
- @robota-sdk/dag-node-tool@3.0.0-beta.63

## 0.1.0-beta.2

### Patch Changes

- @robota-sdk/dag-node-seedance-video@3.0.0-beta.62
- @robota-sdk/dag-node-text-to-image@3.0.0-beta.62
- @robota-sdk/dag-node-skill@3.0.0-beta.62
- @robota-sdk/dag-node-tool@3.0.0-beta.62

## 0.1.0-beta.1
