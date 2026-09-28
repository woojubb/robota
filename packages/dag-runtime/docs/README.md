# DAG Runtime

Run orchestration for the DAG engine: creating runs from published definitions, dispatching entry
tasks, querying run status and cancelling runs, through `RunOrchestratorService`, `RunQueryService`
and `RunCancelService`.

`@robota-sdk/dag-runtime` depends only on `@robota-sdk/dag-core` and receives storage, queue and
clock as ports. It owns run-key idempotency, logical-date resolution and run and task state changes
(delegated to the `dag-core` state machines). Worker execution belongs to `dag-worker`, API transport
to `dag-api`, and read models to `dag-projection`.

## Documents

- [SPEC.md](SPEC.md) — purpose, boundaries and the contract for entry-task dispatch, run-key
  idempotency, snapshot budgets and cancellation.
- [Package README](../README.md) — main exports and a usage example.
