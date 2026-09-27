# DAG Worker

Task execution for the DAG engine: `WorkerLoopService` processes queued tasks and
`RunAdvancementCoordinator` is the single actor that advances runs for one queue.

`@robota-sdk/dag-worker` owns lease acquisition, timeouts, retries, the dead-letter queue
(`DlqReinjectService`), downstream task dispatch, crash recovery (`sweepStaleTaskRuns`) and run
finalization. It does not create or start runs — that is `dag-runtime` — and it reaches storage,
queues, leases and executors only through `dag-core` ports.

## Documents

- [SPEC.md](SPEC.md) — the contract: dispatch, leases and retries, cancellation and result
  precedence, crash recovery, composite child lineage, budgets and the advancement actor.
- [Package README](../README.md) — main exports and a usage example.
